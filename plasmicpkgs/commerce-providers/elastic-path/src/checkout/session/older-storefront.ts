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
import { isShippingLine } from "./shipping-line-sku";
import type { ClientCheckoutSession, UpdateSessionRequest } from "./types";

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

/** The total the older storefront charges: its cart, shipping line included. */
export function olderStorefrontCartTotal(cart: Cart | null): number | undefined {
  const amount = cart?.meta?.display_price?.with_tax?.amount;
  return typeof amount === "number" ? amount : undefined;
}

/**
 * True when pay would write a shipping line the cart does not hold yet, so
 * would charge more than the total on the page.
 */
export function olderShippingLineMissing(
  session: ClientCheckoutSession,
  cart: Cart | null
): boolean {
  if (session.requiresShipping === false || !session.selectedShippingRateId) {
    return false;
  }
  const rate = session.availableShippingRates.find(
    (r) => r.id === session.selectedShippingRateId
  );
  if (!rate) return false;
  const inCart = (cart?.items ?? [])
    .filter(isShippingLine)
    .reduce(
      (sum, line) => sum + ((line as { value?: { amount?: number } }).value?.amount ?? 0),
      0
    );
  return inCart !== rate.amount;
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
