/**
 * A-4.6: Confirm Payment
 *
 * Called after the client completes any gateway action (e.g. 3DS). Steps:
 *   1. Load session (→ 410 if missing)
 *   2. Validate preconditions: order, payment.gateway, and valid status
 *   3. Delegate to adapter.confirmPayment()
 *   4. Map result:
 *      - "succeeded": capture EP transaction, advance session to "complete"
 *      - "requires_action": escalate 3DS data, keep status unchanged
 *      - "failed": reset to "open" for retry
 *   5. Persist + return
 */
import { confirmPayment } from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
} from "../../../checkout/session/types";
import { createLogger } from "../../../utils/logger";

const log = createLogger("Confirm");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

export async function handleConfirm(
  req: SessionRequest,
  ctx: SessionHandlerContext
): Promise<SessionResponse> {
  const ttl = ctx.sessionTtlSeconds ?? 1800;

  // 1. Load session
  let session: CheckoutSession | null;
  try {
    session = await ctx.sessionStore.get("current", req);
  } catch (err) {
    log.error("Failed to read session from store", {
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 500,
      body: { success: false, error: { message: "Failed to read session", code: "STORE_ERROR" } },
    };
  }

  if (!session) {
    return {
      status: 410,
      body: { success: false, error: { message: "Session not found or has expired", code: "SESSION_GONE" } },
    };
  }

  // 2. Validate preconditions
  if (!session.order) {
    return {
      status: 400,
      body: {
        success: false,
        error: { message: "Session has no associated order", code: "NO_ORDER" },
      },
    };
  }

  if (!session.payment.gateway) {
    return {
      status: 400,
      body: {
        success: false,
        error: { message: "Session has no payment gateway", code: "NO_GATEWAY" },
      },
    };
  }

  const isConfirmable =
    session.status === "processing" ||
    session.payment.status === "requires_action";

  if (!isConfirmable) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: "Session is not in a confirmable state",
          code: "SESSION_NOT_CONFIRMABLE",
        },
      },
    };
  }

  // 3. Delegate to adapter
  const adapter = ctx.adapterRegistry.getAdapter(session.payment.gateway);
  if (!adapter) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: `Unknown payment gateway: ${session.payment.gateway}`,
          code: "UNKNOWN_GATEWAY",
        },
      },
    };
  }

  let adapterResult: Awaited<ReturnType<typeof adapter.confirmPayment>>;
  try {
    adapterResult = await adapter.confirmPayment(
      session,
      req.body as Record<string, unknown>
    );
  } catch (err) {
    log.error("Payment adapter confirmPayment threw", {
      gateway: session.payment.gateway,
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Payment adapter error", code: "ADAPTER_ERROR" },
      },
    };
  }

  // 4. Map result
  let finalSession: CheckoutSession;

  if (adapterResult.status === "succeeded") {
    // Capture the EP transaction
    const orderId = session.order.id;
    const transactionId = session.order.transactionId;

    if (!transactionId) {
      log.error("Cannot capture EP transaction — transactionId missing from session.order", {
        sessionId: session.id,
        orderId,
      } as Record<string, unknown>);
      return {
        status: 500,
        body: {
          success: false,
          error: { message: "Transaction ID missing from session", code: "MISSING_TRANSACTION_ID" },
        },
      };
    }

    // The EP SDK's Client<> type is complex; the settings-only object is the
    // documented lightweight pattern used throughout this codebase.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {
      settings: {
        application_id: ctx.epCredentials.clientId,
        host: ctx.epCredentials.apiBaseUrl,
      },
    } as any;

    try {
      await confirmPayment({
        client,
        path: { orderID: orderId, transactionID: transactionId },
        body: {
          data: {
            gateway: "manual",
            method: "capture",
            ...(adapterResult.gatewayOrderId
              ? { custom_reference: adapterResult.gatewayOrderId }
              : {}),
          },
        },
      });
    } catch (err) {
      log.error("EP confirmPayment (capture) failed", {
        orderId,
        transactionId,
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
      return {
        status: 502,
        body: {
          success: false,
          error: { message: "Failed to capture payment with EP", code: "EP_ERROR" },
        },
      };
    }

    finalSession = {
      ...session,
      status: "complete",
      payment: {
        ...session.payment,
        status: "succeeded",
        gatewayMetadata: {
          ...session.payment.gatewayMetadata,
          ...(adapterResult.gatewayMetadata ?? {}),
        },
      },
    };
  } else if (adapterResult.status === "requires_action") {
    // 3DS escalation — update actionData only
    finalSession = {
      ...session,
      payment: {
        ...session.payment,
        status: "requires_action",
        actionData: adapterResult.actionData ?? session.payment.actionData,
      },
    };
  } else {
    // failed — reset to open for retry
    finalSession = {
      ...session,
      status: "open",
      payment: {
        ...session.payment,
        status: "failed",
        actionData: null,
      },
    };
  }

  // 5. Persist and return
  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", finalSession, ttl, req);
  } catch (err) {
    log.error("Failed to persist session after confirm", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 500,
      body: { success: false, error: { message: "Failed to store session", code: "STORE_ERROR" } },
    };
  }

  log.info("Confirm handler completed", {
    sessionId: finalSession.id,
    adapterStatus: adapterResult.status,
    sessionStatus: finalSession.status,
  } as Record<string, unknown>);

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(finalSession) },
    },
    headers: setResult.headers,
  };
}
