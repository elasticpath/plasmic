import type {
  CheckoutSession,
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
