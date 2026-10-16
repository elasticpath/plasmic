/**
 * One reading of Stripe PaymentIntent statuses and Elastic Path order payment
 * states for the whole checkout: server adapters, resume, and the browser
 * payment component.
 *
 * `processing` is not settled. Elastic Path's confirm on a PaymentIntent in
 * `processing` records a pending transaction and leaves the order unpaid, and
 * the order cannot take that PaymentIntent once it succeeds; so an order is
 * confirmed only after Stripe reports the money collected.
 */

/** The payment was taken (or, for `requires_capture`, authorised). */
export const SETTLED_PAYMENT_INTENT_STATUSES: ReadonlySet<string> = new Set([
  "succeeded",
  "requires_capture",
]);

/** Not finished yet: a challenge is open, or the money is still on its way. */
export const PENDING_PAYMENT_INTENT_STATUSES: ReadonlySet<string> = new Set([
  "requires_action",
  "requires_source_action",
  "requires_confirmation",
  "processing",
]);

/** Can no longer take the payment. */
export const FAILED_PAYMENT_INTENT_STATUSES: ReadonlySet<string> = new Set([
  "requires_payment_method",
  "requires_source",
  "canceled",
  "cancelled",
]);

export type PaymentIntentPhase = "settled" | "pending" | "failed" | "unknown";

export function paymentIntentPhase(status: unknown): PaymentIntentPhase {
  if (typeof status !== "string") return "unknown";
  if (SETTLED_PAYMENT_INTENT_STATUSES.has(status)) return "settled";
  if (PENDING_PAYMENT_INTENT_STATUSES.has(status)) return "pending";
  if (FAILED_PAYMENT_INTENT_STATUSES.has(status)) return "failed";
  return "unknown";
}

/** Elastic Path `OrderResponse.payment` values that mean the order is paid for. */
export function isOrderPaid(payment: unknown): boolean {
  return payment === "paid" || payment === "authorized";
}
