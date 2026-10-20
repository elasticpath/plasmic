/**
 * A storefront on the 0.8.0 package, met by newer checkout components after a
 * hostless publish. Its checkout session still carries the cart id; this
 * release never sends one to the browser.
 *
 * On such a storefront GET does not requote, pay does not take the shown
 * total, a failed shipping-line write leaves the total without shipping until
 * pay writes the line, and its refusals carry developer text.
 */
import type { Cart } from "../../types/cart";
import { shopperCartTotals } from "../../utils/cart-totals";
import { hasPurchasableItem } from "./purchasable-items";
import type {
  ClientCheckoutSession,
  SessionTotals,
  UpdateSessionRequest,
} from "./types";

export const EMPTY_CART_COPY = "Your cart is empty";

export const CART_CHANGED_COPY =
  "Your cart changed. Check the new total, then place your order again.";

export const CART_UNREAD_COPY =
  "We couldn't check your cart. Please try again.";

const GENERIC_COPY = "Checkout could not continue. Please try again.";

const EXPIRED_COPY = "Your checkout has expired. Refresh the page to start again.";

const ERROR_COPY: Record<string, string> = {
  MISSING_FIELDS: "Please complete your details and choose a delivery option.",
  MISSING_SHIPPING_ADDRESS: "Enter your shipping address first.",
  SHIPPING_RATE_UNRESOLVABLE:
    "That delivery option is no longer available. Choose another one.",
  SESSION_GONE: EXPIRED_COPY,
  SESSION_NOT_OPEN: EXPIRED_COPY,
};

interface SessionResponseLike {
  success?: boolean;
  error?: { message?: string; code?: string };
}

export function isOlderStorefrontSession(session: unknown): boolean {
  return !!session && typeof session === "object" && "cartId" in session;
}

/** The 0.8.0 create refusal for a visitor who has no cart. */
export function isOlderNoCartRefusal(resp: SessionResponseLike | undefined): boolean {
  return (
    resp?.success === false &&
    resp.error?.code === "VALIDATION_ERROR" &&
    /^cartId is required/.test(resp.error.message ?? "")
  );
}

/** A refusal from the older storefront, with shopper copy for its message. */
export function withShopperCopy<T extends SessionResponseLike>(resp: T): T {
  if (!resp || resp.success !== false || !resp.error) return resp;
  const code = resp.error.code;
  return {
    ...resp,
    error: {
      ...resp.error,
      message: (code && ERROR_COPY[code]) || GENERIC_COPY,
    },
  };
}

/** Changes whenever the older storefront may have written the cart for the session. */
export function olderSessionKey(session: ClientCheckoutSession): string {
  return JSON.stringify([
    session.id,
    session.selectedShippingRateId ?? null,
    session.requiresShipping ?? null,
    session.totals?.total ?? null,
  ]);
}

export interface OlderCheckoutView {
  /** The cart holds nothing to buy. */
  empty: boolean;
  /**
   * What the older storefront's pay charges, as rows that add up: Elastic
   * Path's own figures for the cart, read with `withoutShipping`. Null when
   * that is not known yet: a rate is chosen and its line is not in the cart.
   */
  totals: SessionTotals | null;
  /** The session's own total is the cart's: pay takes it without a restart. */
  inSync: boolean;
}

function amountOf(price: { amount?: unknown } | undefined): number | null {
  return typeof price?.amount === "number" ? price.amount : null;
}

/**
 * The older storefront's checkout session read against its live cart.
 *
 * Its session totals count a shipping line already in the cart as goods, keep
 * one a new rate replaces, and never follow the cart. Its pay charges the live
 * cart once the chosen rate's line is in it, or the cart without the line when
 * nothing ships. So the rows come from the cart: goods from
 * `withoutShipping`, shipping from the line.
 */
export function olderCheckoutView(
  session: ClientCheckoutSession,
  cart: Cart | null
): OlderCheckoutView {
  if (!cart || !hasPurchasableItem(cart.items)) {
    return { empty: true, totals: null, inSync: false };
  }
  const all = cart.meta?.display_price;
  const goods = shopperCartTotals(cart);
  const cartTotal = amountOf(all?.with_tax);
  const goodsTotal = amountOf(goods?.with_tax);
  if (cartTotal === null || goodsTotal === null) {
    return { empty: false, totals: null, inSync: false };
  }
  const tax = amountOf(goods?.tax) ?? 0;
  const currency = goods?.with_tax?.currency || session.totals?.currency || "";
  const ships =
    session.requiresShipping !== false && !!session.selectedShippingRateId;
  if (!ships) {
    return {
      empty: false,
      totals: { subtotal: goodsTotal - tax, tax, shipping: 0, total: goodsTotal, currency },
      inSync: true,
    };
  }
  const rate = session.availableShippingRates.find(
    (r) => r.id === session.selectedShippingRateId
  );
  const listed =
    (amountOf(all?.without_discount) ?? cartTotal) -
    (amountOf(goods?.without_discount) ?? goodsTotal);
  if (!rate || listed !== rate.amount) {
    return { empty: false, totals: null, inSync: false };
  }
  const shipping = cartTotal - goodsTotal;
  return {
    empty: false,
    totals: { subtotal: goodsTotal - tax, tax, shipping, total: cartTotal, currency },
    inSync: session.totals?.total === cartTotal,
  };
}

/** What the shopper already entered, to carry into a new checkout session. */
export function enteredDetails(
  session: ClientCheckoutSession
): UpdateSessionRequest | null {
  const details: UpdateSessionRequest = {};
  if (session.customerInfo) details.customerInfo = session.customerInfo;
  if (session.billingAddress) details.billingAddress = session.billingAddress;
  if (session.shippingAddress) details.shippingAddress = session.shippingAddress;
  if (typeof session.requiresShipping === "boolean") {
    details.requiresShipping = session.requiresShipping;
  }
  return Object.keys(details).length > 0 ? details : null;
}
