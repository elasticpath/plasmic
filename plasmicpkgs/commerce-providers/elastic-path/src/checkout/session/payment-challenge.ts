import type {
  CheckoutSession,
  PaymentIntentReadKeys,
  SessionHandlerContext,
  SessionResponse,
} from "./types";
import { isCartPaymentIntentAdapter } from "./payment-sequence";
import { toClientSession } from "./client-session";

/**
 * True while the session's cart PaymentIntent waits for the shopper's 3DS
 * challenge. Its order is already held; only resume or abandon may move it on.
 */
export function awaitsCartPaymentChallenge(
  session: CheckoutSession,
  ctx: SessionHandlerContext
): boolean {
  if (session.status !== "open") return false;
  if (session.payment.status !== "requires_action") return false;
  const adapter = session.payment.gateway
    ? ctx.adapterRegistry.getAdapter(session.payment.gateway)
    : undefined;
  return !!adapter && isCartPaymentIntentAdapter(adapter);
}

const PUBLISHABLE_KEY = /^pk_(test|live)_[A-Za-z0-9]+$/;
const CONNECTED_ACCOUNT = /^acct_[A-Za-z0-9]+$/;

/**
 * The PaymentIntent read keys a resume or abandon request carries, when well
 * formed. The server only uses them to ask Stripe about the session's own
 * PaymentIntent, so a key from the browser cannot change the answer.
 */
export function readKeysFrom(body: unknown): PaymentIntentReadKeys | undefined {
  const b = body as Record<string, unknown> | undefined;
  const publishableKey = b?.publishableKey;
  const stripeAccount = b?.stripeAccount;
  if (typeof publishableKey !== "string" || !PUBLISHABLE_KEY.test(publishableKey)) {
    return undefined;
  }
  if (stripeAccount !== undefined && stripeAccount !== null && stripeAccount !== "") {
    if (typeof stripeAccount !== "string" || !CONNECTED_ACCOUNT.test(stripeAccount)) {
      return undefined;
    }
    return { publishableKey, stripeAccount };
  }
  return { publishableKey };
}

/** 409 with the open challenge, so the client can finish or cancel it. */
export function paymentActionPending(session: CheckoutSession): SessionResponse {
  return {
    status: 409,
    body: {
      success: false,
      error: {
        message: "Finish or cancel the card check before changing this checkout",
        code: "PAYMENT_ACTION_PENDING",
      },
      data: { session: toClientSession(session) },
    },
  };
}
