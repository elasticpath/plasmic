/**
 * Shared tail for paid checkout once the EP order exists and the gateway
 * PaymentIntent is synced (or /pay confirm failed after the charge succeeded).
 *
 * For cart_payment_intent gateways, clears cart payment_intent_id before
 * best-effort cart deletion so a surviving cart cannot reattach a paid PI —
 * but only when confirmOrder reconciliation succeeded. When
 * reconciliationError is set, the Cart PI link is left in place.
 * Cart cleanup failures (and detach failures after a successful charge) are
 * logged and never turn a completed order into a retryable payment failure.
 * Callers handle order custom-field writes themselves so /pay can write them
 * before confirmOrder.
 */
import { createShopperClient } from "@epcc-sdk/sdks-shopper";
import type {
  CheckoutSession,
  ClientCheckoutSession,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
} from "./types";
import { applyPaymentSucceeded } from "./session-state-transition";
import { runCartCleanup } from "./cart-cleanup";
import { clearCartPaymentIntentId } from "./clear-cart-payment-intent";
import { isCartPaymentIntentAdapter } from "./payment-sequence";
import { createLogger } from "../../utils/logger";

const log = createLogger("FinalizePaidSession");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

function buildEpClient(
  ctx: SessionHandlerContext,
  token: string
): unknown {
  const { client } = createShopperClient(
    { baseUrl: ctx.epCredentials.apiBaseUrl },
    {
      clientId: ctx.epCredentials.clientId,
      storage: {
        get: () => token,
        set: () => {},
      },
    }
  );
  return client;
}

async function detachCartPaymentIntentIfNeeded(
  ctx: SessionHandlerContext,
  gateway: string,
  cartId: string
): Promise<void> {
  const adapter = ctx.adapterRegistry.getAdapter(gateway);
  if (!adapter || !isCartPaymentIntentAdapter(adapter)) {
    return;
  }
  if (!cartId) return;

  // Prefer client_credentials (same as cart delete). A present-but-expired
  // shopper token must not block success cleanup when admin credentials exist.
  let token = "";
  if (ctx.getClientCredentialsToken) {
    try {
      token = await ctx.getClientCredentialsToken();
    } catch (err) {
      log.warn(
        "Cart PaymentIntent detach — could not mint admin token after successful payment; trying shopper token",
        {
          cartId,
          gateway,
          error: err instanceof Error ? err.message : String(err),
        } as Record<string, unknown>
      );
    }
  }
  if (!token) {
    token = ctx.shopperAccessToken ?? "";
  }
  if (!token) {
    log.warn(
      "Cart PaymentIntent detach skipped — no shopper or admin token after successful payment",
      { cartId, gateway } as Record<string, unknown>
    );
    return;
  }

  const result = await clearCartPaymentIntentId({
    client: buildEpClient(ctx, token),
    cartId,
  });
  if (!result.ok) {
    // Order/payment already succeeded — do not fail the response (retry is dangerous).
    log.warn(
      "Failed to clear cart payment_intent_id after successful payment (non-fatal)",
      {
        cartId,
        gateway,
        error: result.errorMessage,
      } as Record<string, unknown>
    );
  }
}

export interface FinalizePaidSessionParams {
  ctx: SessionHandlerContext;
  req: SessionRequest;
  ttl: number;
  session: CheckoutSession;
  gateway: string;
  orderId: string;
  paymentIntentId?: string;
  transactionId?: string;
  gatewayMetadata?: Record<string, unknown>;
  reconciliationError?: string | null;
}

export async function finalizePaidSession(
  params: FinalizePaidSessionParams
): Promise<SessionResponse> {
  const {
    ctx,
    req,
    ttl,
    session,
    gateway,
    orderId,
    paymentIntentId,
    transactionId,
    gatewayMetadata,
    reconciliationError = null,
  } = params;

  // Keep the Cart PI association when confirmOrder reconciliation failed —
  // ops may still need the link. Clear only after a clean reconcile.
  if (reconciliationError == null) {
    await detachCartPaymentIntentIfNeeded(ctx, gateway, session.cartId);
  }

  if (ctx.getClientCredentialsToken) {
    await runCartCleanup({
      host: ctx.epCredentials.apiBaseUrl,
      clientId: ctx.epCredentials.clientId,
      getClientCredentialsToken: ctx.getClientCredentialsToken,
      cartId: session.cartId,
    });
  }

  const completeSession = applyPaymentSucceeded(
    { ...session, payment: { ...session.payment, gateway } },
    {
      orderId,
      paymentIntentId,
      transactionId,
      gatewayMetadata: {
        ...(gatewayMetadata ?? {}),
        ...(reconciliationError ? { needsReconciliation: true } : {}),
      },
    }
  );

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", completeSession, ttl, req);
  } catch (err) {
    log.error("Failed to persist complete session", {
      sessionId: completeSession.id,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 500,
      body: {
        success: false,
        error: { message: "Failed to store session", code: "STORE_ERROR" },
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(completeSession) },
      ...(reconciliationError ? { reconciliationPending: true } : {}),
    },
    headers: setResult.headers,
  };
}
