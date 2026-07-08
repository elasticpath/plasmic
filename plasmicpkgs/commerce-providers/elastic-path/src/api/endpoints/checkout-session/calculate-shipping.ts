/**
 * A-4.4: Calculate Shipping Rates
 *
 * Sources the session's available shipping rates from the SERVER-side
 * `ctx.shippingRateResolver` (#374 / #371) — a tenant's own server logic (e.g. a
 * carrier-rate fetch authored as a Studio server query), wired at route setup.
 * EP has no shopper "shipping options / rates" endpoint, and a rate list is
 * NEVER accepted from the browser, so the resolved amounts are trusted by
 * `resolveShippingRate` and the /pay re-assertion (the client only *selects* a
 * rate id — see ADR-0013).
 *
 * Persists the resolved rates into `session.availableShippingRates` and returns
 * the updated session. When no resolver is wired the store does not support
 * server-computed shipping: the rate list is empty and a shipping-required
 * checkout fails closed at /pay.
 */
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
  SessionShippingRate,
} from "../../../checkout/session/types";
import { createLogger } from "../../../utils/logger";

const log = createLogger("CalculateShipping");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

export async function handleCalculateShipping(
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

  if (!session.shippingAddress) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: "Session does not have a shipping address",
          code: "MISSING_SHIPPING_ADDRESS",
        },
      },
    };
  }

  // Source the rates from the tenant's server-side resolver. No resolver wired
  // → the store doesn't offer server-computed shipping (empty list). The
  // resolver owns the SessionShippingRate shape; we only defend against a
  // non-array result so downstream (resolveShippingRate) always sees a list.
  let shippingRates: SessionShippingRate[] = [];
  if (ctx.shippingRateResolver) {
    try {
      const resolved = await ctx.shippingRateResolver(session);
      shippingRates = Array.isArray(resolved) ? resolved : [];
    } catch (err) {
      log.error("Shipping rate resolver failed", {
        cartId: session.cartId,
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
      return {
        status: 502,
        body: {
          success: false,
          error: { message: "Failed to retrieve shipping options", code: "SHIPPING_ERROR" },
        },
      };
    }
  }

  const updated: CheckoutSession = {
    ...session,
    availableShippingRates: shippingRates,
  };

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", updated, ttl, req);
  } catch (err) {
    log.error("Failed to persist session after shipping calculation", {
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

  log.info("Shipping rates calculated", {
    sessionId: updated.id,
    cartId: updated.cartId,
    rateCount: shippingRates.length,
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
