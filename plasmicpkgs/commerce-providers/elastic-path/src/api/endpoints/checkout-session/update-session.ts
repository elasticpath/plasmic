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
  SessionTotals,
  UpdateSessionRequest,
} from "../../../checkout/session/types";
import type { Cart } from "../../../types/cart";
import { filterAllowedCustomAttributes } from "../../../checkout/session/custom-attributes-allowlist";
import { applyShippingSelection } from "../../../checkout/session/apply-shipping-selection";
import { resolveShippingRate } from "../../../checkout/session/cart-shipping";
import { buildAdminEpClient } from "../../../checkout/session/admin-client";
import { sessionAddressesEquivalent } from "../../../checkout/session/address-utils";
import { createLogger } from "../../../utils/logger";

const log = createLogger("UpdateSession");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

/** Authoritative cart total from a normalized Cart (minor units), or null. */
function cartWithTaxAmount(cart: Cart): number | null {
  const amount = cart.meta?.display_price?.with_tax?.amount;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
}

function totalsWithoutShipping(totals: SessionTotals | null): SessionTotals | null {
  if (!totals) return totals;
  return {
    ...totals,
    shipping: 0,
    total: totals.subtotal + totals.tax,
  };
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
      } as Record<string, unknown>);
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

  // When the shopper picks a shipping rate (an id only — never an amount), write
  // the SERVER-resolved cost into the cart credentialed so the cart shows it
  // before pay. Best-effort: this is a UX convenience, NOT the integrity
  // boundary — /pay re-asserts the shipping line authoritatively (ADR-0013), so
  // a write hiccup here is non-fatal and a forged/un-offered id simply fails to
  // resolve (no line written). Skip when no rates have been computed yet
  // (selection before calculate-shipping): nothing to resolve against.
  if (
    !shippingAddressChanged &&
    update.selectedShippingRateId !== undefined &&
    updated.availableShippingRates.length > 0
  ) {
    try {
      const client = await buildAdminEpClient(ctx);
      // setCartShippingLine returns the re-priced cart — reuse it (no extra GET).
      const pricedCart = await applyShippingSelection(ctx, updated, { client });
      const rate = resolveShippingRate(
        updated.availableShippingRates,
        updated.selectedShippingRateId ?? ""
      );
      const freshTotal = cartWithTaxAmount(pricedCart);
      if (freshTotal != null) {
        updated = {
          ...updated,
          totals: {
            subtotal: updated.totals?.subtotal ?? 0,
            tax: updated.totals?.tax ?? 0,
            shipping: rate.amount,
            total: freshTotal,
            currency: updated.totals?.currency || rate.currency,
          },
        };
      }
    } catch (err) {
      log.warn("Could not write shipping line on selection (deferred to /pay)", {
        sessionId: updated.id,
        rateId: updated.selectedShippingRateId,
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
    }
  }

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
