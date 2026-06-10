/**
 * A-4.3: Update Checkout Session
 *
 * Merges partial updates (customerInfo, shippingAddress, billingAddress,
 * selectedShippingRateId) onto the existing session. Only permitted when the
 * session is in "open" status. Returns 410 if no session exists.
 */
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
  UpdateSessionRequest,
} from "../../../checkout/session/types";
import { createLogger } from "../../../utils/logger";

const log = createLogger("UpdateSession");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

export async function handleUpdateSession(
  req: SessionRequest,
  ctx: SessionHandlerContext
): Promise<SessionResponse> {
  const ttl = ctx.sessionTtlSeconds ?? 1800;

  let session: CheckoutSession | null;
  try {
    session = await ctx.sessionStore.get("current", req);
  } catch (err) {
    log.error("Failed to read session from store", {
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 500,
      body: {
        success: false,
        error: { message: "Failed to read session", code: "STORE_ERROR" },
      },
    };
  }

  if (!session) {
    return {
      status: 410,
      body: {
        success: false,
        error: { message: "Session not found or has expired", code: "SESSION_GONE" },
      },
    };
  }

  if (session.status !== "open") {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: "Session is not open",
          code: "SESSION_NOT_OPEN",
        },
      },
    };
  }

  const update = req.body as UpdateSessionRequest;

  const updated: CheckoutSession = {
    ...session,
    ...(update.customerInfo !== undefined && { customerInfo: update.customerInfo }),
    ...(update.shippingAddress !== undefined && { shippingAddress: update.shippingAddress }),
    ...(update.billingAddress !== undefined && { billingAddress: update.billingAddress }),
    ...(update.selectedShippingRateId !== undefined && {
      selectedShippingRateId: update.selectedShippingRateId,
    }),
    ...(update.requiresShipping !== undefined && {
      requiresShipping: update.requiresShipping,
    }),
    // customAttributes merge (not replace) so partial updates accumulate the
    // extra fields + consent flags a single-page form collects.
    ...(update.customAttributes !== undefined && {
      customAttributes: {
        ...(session.customAttributes ?? {}),
        ...update.customAttributes,
      },
    }),
  };

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", updated, ttl, req);
  } catch (err) {
    log.error("Failed to persist updated session", {
      sessionId: session.id,
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

  log.info("Session updated", {
    sessionId: updated.id,
    fields: Object.keys(update).filter((k) => (update as Record<string, unknown>)[k] !== undefined),
  } as Record<string, unknown>);

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(updated) },
    },
    headers: setResult.headers,
  };
}
