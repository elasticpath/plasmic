/**
 * A-4.3: Update Checkout Session
 *
 * Merges partial updates (customerInfo, shippingAddress, billingAddress,
 * selectedShippingRateId) onto the existing session. A changed shipping address
 * requotes through the shipping rate resolver in the same write. Only permitted
 * when the session is in "open" status. Returns 410 if no session exists, and
 * 400 INVALID_EMAIL for a customer email Elastic Path would refuse at checkout.
 */
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  SessionShippingRate,
  UpdateSessionRequest,
} from "../../../checkout/session/types";
import { filterAllowedCustomAttributes } from "../../../checkout/session/custom-attributes-allowlist";
import { ShippingResolutionError } from "../../../checkout/session/apply-shipping-selection";
import { priceShippingSelection } from "../../../checkout/session/shipping-line-scope";
import {
  totalsFromCart,
  totalsWithoutShipping,
} from "../../../checkout/session/session-totals";
import { sessionAddressesEquivalent } from "../../../checkout/session/address-utils";
import { createLogger } from "../../../utils/logger";
import { toClientSession } from "../../../checkout/session/client-session";
import { isSettling } from "../../../checkout/session/settle-once";
import { invalidEmail, isCheckoutEmail } from "../../../checkout/session/checkout-email";
import {
  awaitsCartPaymentChallenge,
  paymentActionPending,
} from "../../../checkout/session/payment-challenge";

const log = createLogger("UpdateSession");

/** Rates for a changed address; empty when the resolver is missing or fails. */
async function requote(
  session: CheckoutSession,
  ctx: SessionHandlerContext
): Promise<SessionShippingRate[]> {
  if (!ctx.shippingRateResolver) return [];
  try {
    const resolved = await ctx.shippingRateResolver(session);
    return Array.isArray(resolved) ? resolved : [];
  } catch (err) {
    log.error("Shipping rate resolver failed", {
      sessionId: session.id,
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
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
    });
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

  if (awaitsCartPaymentChallenge(session, ctx)) {
    return paymentActionPending(session);
  }

  if (isSettling(session.cartId)) {
    return {
      status: 409,
      body: {
        success: false,
        error: {
          message: "Payment for this checkout is in progress",
          code: "CHECKOUT_IN_PROGRESS",
        },
      },
    };
  }

  const update = req.body as UpdateSessionRequest;

  if (update.customerInfo != null && !isCheckoutEmail(update.customerInfo.email)) {
    return invalidEmail();
  }

  // customAttributes are client-supplied. Gate them against the server-side
  // allow-list at this boundary so forged keys never enter session state.
  // Fail closed: with no allow-list configured, nothing survives. (Defence in
  // depth: /pay re-applies the same filter before the privileged EP writes.)
  let nextCustomAttributes: CheckoutSession["customAttributes"] =
    session.customAttributes;
  if (update.customAttributes !== undefined) {
    const merged = {
      // Merge (not replace) so partial updates accumulate the extra fields +
      // consent flags a single-page form collects.
      ...(session.customAttributes ?? {}),
      ...update.customAttributes,
    };
    const { allowed, dropped } = filterAllowedCustomAttributes(
      merged,
      ctx.allowedCustomAttributeKeys
    );
    nextCustomAttributes = allowed;
    if (dropped.length > 0) {
      // Keys only — never the values (they may be PII).
      log.warn("Dropped customAttribute keys not on the allow-list", {
        sessionId: session.id,
        dropped: dropped.join(","),
        allowListConfigured: ctx.allowedCustomAttributeKeys !== undefined,
      });
    }
  }

  const shippingAddressChanged =
    update.shippingAddress !== undefined &&
    !sessionAddressesEquivalent(session.shippingAddress, update.shippingAddress);

  let updated: CheckoutSession = {
    ...session,
    ...(update.customerInfo !== undefined && { customerInfo: update.customerInfo }),
    ...(update.shippingAddress !== undefined && { shippingAddress: update.shippingAddress }),
    ...(update.billingAddress !== undefined && { billingAddress: update.billingAddress }),
    ...(update.requiresShipping !== undefined && {
      requiresShipping: update.requiresShipping,
    }),
    ...(update.customAttributes !== undefined && {
      customAttributes: nextCustomAttributes,
    }),
    ...(shippingAddressChanged
      ? {
          availableShippingRates: [],
          selectedShippingRateId: null,
          totals: totalsWithoutShipping(session.totals),
        }
      : update.selectedShippingRateId !== undefined
        ? { selectedShippingRateId: update.selectedShippingRateId }
        : {}),
  };

  if (shippingAddressChanged) {
    updated = { ...updated, availableShippingRates: await requote(updated, ctx) };
  }

  // When the shopper picks a shipping rate (an id only — never an amount),
  // Elastic Path prices the SERVER-resolved cost with the cart, and the line
  // comes out of the cart again (shipping-line-scope.ts). /pay re-asserts the
  // line (ADR-0013). A forged/un-offered id fails to resolve and writes no
  // line. A rate Elastic Path could not price is not chosen, so the page never
  // shows a total without the rate it shows chosen. Skip when no rates have
  // been computed yet (selection before calculate-shipping).
  let notApplied = false;
  if (
    !shippingAddressChanged &&
    update.selectedShippingRateId !== undefined &&
    updated.availableShippingRates.length > 0
  ) {
    try {
      const pricedCart = await priceShippingSelection(ctx, updated);
      const fresh = totalsFromCart(pricedCart);
      if (fresh) {
        updated = {
          ...updated,
          totals: {
            ...fresh,
            currency: fresh.currency || updated.totals?.currency || "",
          },
        };
      }
    } catch (err) {
      log.warn("Could not price the selected shipping rate", {
        sessionId: updated.id,
        rateId: updated.selectedShippingRateId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!(err instanceof ShippingResolutionError)) {
        notApplied = true;
        updated = {
          ...updated,
          selectedShippingRateId: null,
          totals: totalsWithoutShipping(session.totals),
        };
      }
    }
  }

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", updated, ttl, req);
  } catch (err) {
    log.error("Failed to persist updated session", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
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
  });

  if (notApplied) {
    return {
      status: 502,
      body: {
        success: false,
        error: {
          message: "That delivery option could not be added. Please choose it again.",
          code: "SHIPPING_NOT_APPLIED",
        },
        data: { session: toClientSession(updated) },
      },
      headers: setResult.headers,
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(updated) },
    },
    headers: setResult.headers,
  };
}
