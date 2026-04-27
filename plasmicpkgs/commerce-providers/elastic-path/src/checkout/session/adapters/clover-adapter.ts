/**
 * Clover PaymentAdapter — server-side adapter for Clover payment processing.
 *
 * WHY: The session model needs a gateway-agnostic way to charge cards and
 * handle 3DS flows. This adapter translates between the PaymentAdapter interface
 * and Clover's charge + finalize_payment APIs.
 *
 * Key behaviors:
 * - initializePayment: charges Clover with idempotency, inspects 3DS status
 * - confirmPayment: finalizes 3DS (method or challenge), handles escalation
 * - One retry on network errors with same idempotency key (safe due to idempotency)
 * - Card declined (402) → "failed" with user-friendly message
 */
import type { PaymentAdapter, PaymentAdapterResult, CheckoutSession } from "../types";
import type { CloverChargeResponse } from "./clover-types";
import { chargeClover, finalizeCloverPayment, deriveIdempotencyKey } from "./clover-api";

export interface CloverAdapterConfig {
  apiKey: string;
  apiBase: string;
}

export function createCloverAdapter(config: CloverAdapterConfig): PaymentAdapter {
  const { apiKey, apiBase } = config;

  return {
    async initializePayment(
      session: CheckoutSession,
      gatewayData: Record<string, unknown>
    ): Promise<PaymentAdapterResult> {
      const token = gatewayData.token as string | undefined;
      if (!token) {
        return { status: "failed", errorMessage: "Missing Clover token" };
      }

      const orderId = session.order?.id;
      if (!orderId) {
        return { status: "failed", errorMessage: "No order ID in session" };
      }

      const total = session.totals?.total;
      const currency = session.totals?.currency;
      if (total == null || !currency) {
        return { status: "failed", errorMessage: "Missing totals in session" };
      }

      const idempotencyKey = deriveIdempotencyKey(orderId);

      let chargeResponse: CloverChargeResponse;
      try {
        chargeResponse = await chargeCloverWithRetry(
          token, total, currency, orderId, idempotencyKey, apiKey, apiBase
        );
      } catch (err: any) {
        if (err.code === "card_declined") {
          return { status: "failed", errorMessage: "Your card was declined" };
        }
        return {
          status: "failed",
          errorMessage: err.message || "Payment failed",
        };
      }

      const chargeId = chargeResponse.id;
      const threeDsStatus = chargeResponse.threeDsData?.status ?? null;

      // No 3DS required
      if (!threeDsStatus) {
        return {
          status: "ready",
          gatewayMetadata: { chargeId },
          gatewayOrderId: chargeId,
        };
      }

      // 3DS Method flow
      if (threeDsStatus === "METHOD_FLOW") {
        const methodData = chargeResponse.threeDsData!.methodData!;
        return {
          status: "requires_action",
          gatewayMetadata: { chargeId },
          actionData: {
            type: "3ds_method",
            chargeId,
            _3DSServerTransId: methodData._3DSServerTransId,
            acsMethodUrl: methodData.acsMethodUrl,
            methodNotificationUrl: methodData.methodNotificationUrl,
          },
        };
      }

      // 3DS Challenge flow
      if (threeDsStatus === "CHALLENGE") {
        const challengeData = chargeResponse.threeDsData!.challengeData!;
        return {
          status: "requires_action",
          gatewayMetadata: { chargeId },
          actionData: {
            type: "3ds_challenge",
            chargeId,
            messageVersion: challengeData.messageVersion,
            acsTransID: challengeData.acsTransID,
            acsUrl: challengeData.acsUrl,
            threeDSServerTransID: challengeData.threeDSServerTransID,
          },
        };
      }

      // Unknown 3DS status — treat as ready (defensive)
      return {
        status: "ready",
        gatewayMetadata: { chargeId },
        gatewayOrderId: chargeId,
      };
    },

    async confirmPayment(
      _session: CheckoutSession,
      confirmData: Record<string, unknown>
    ): Promise<PaymentAdapterResult> {
      const chargeId = confirmData.chargeId as string | undefined;
      const flowStatus = confirmData.flowStatus as string | undefined;

      if (!chargeId || !flowStatus) {
        return {
          status: "failed",
          errorMessage: "Missing chargeId or flowStatus for 3DS confirmation",
        };
      }

      let finalizeResponse: CloverChargeResponse;
      try {
        finalizeResponse = await finalizeCloverPayment(
          chargeId, flowStatus, apiKey, apiBase
        );
      } catch (err: any) {
        return {
          status: "failed",
          errorMessage: err.message || "Payment finalization failed",
        };
      }

      const finalStatus = finalizeResponse.threeDsData?.status ?? null;

      // Authentication failed
      if (finalStatus === "AUTHENTICATION_FAILED") {
        return {
          status: "failed",
          errorMessage: "3D Secure authentication failed",
        };
      }

      // Challenge escalation (method → challenge)
      if (finalStatus === "CHALLENGE") {
        const challengeData = finalizeResponse.threeDsData!.challengeData!;
        return {
          status: "requires_action",
          gatewayMetadata: { chargeId: finalizeResponse.id },
          actionData: {
            type: "3ds_challenge",
            chargeId: finalizeResponse.id,
            messageVersion: challengeData.messageVersion,
            acsTransID: challengeData.acsTransID,
            acsUrl: challengeData.acsUrl,
            threeDSServerTransID: challengeData.threeDSServerTransID,
          },
        };
      }

      // Success
      return {
        status: "succeeded",
        gatewayOrderId: finalizeResponse.id,
        gatewayMetadata: { chargeId: finalizeResponse.id },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Retry helper — one retry on network errors (safe due to idempotency key)
// ---------------------------------------------------------------------------

async function chargeCloverWithRetry(
  token: string,
  amount: number,
  currency: string,
  orderId: string,
  idempotencyKey: string,
  apiKey: string,
  apiBase: string
): Promise<CloverChargeResponse> {
  try {
    return await chargeClover(
      token, amount, currency, orderId, idempotencyKey, apiKey, apiBase
    );
  } catch (err: any) {
    // Don't retry card declines or other business errors
    if (err.code === "card_declined") throw err;

    // Check for network/timeout errors — retry once
    const isNetworkError =
      err.name === "TypeError" || // fetch network error
      err.message?.includes("fetch") ||
      err.message?.includes("network") ||
      err.message?.includes("timeout");

    if (isNetworkError) {
      return chargeClover(
        token, amount, currency, orderId, idempotencyKey, apiKey, apiBase
      );
    }

    throw err;
  }
}
