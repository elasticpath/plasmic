/**
 * Session State Transition — pure helpers that produce the next session
 * given the previous session and a transition event.
 *
 * Slice 1: open → complete on payment succeeded; open → open (with
 * payment.status=failed) on payment failed. Slices 2+ add the
 * requires_action (3DS) + expired branches.
 */
import type { CheckoutSession } from "./types";

export interface PaymentSucceededEvent {
  orderId: string;
  paymentIntentId: string;
  gatewayMetadata?: Record<string, unknown>;
}

export interface PaymentFailedEvent {
  errorMessage?: string;
  gatewayMetadata?: Record<string, unknown>;
}

export function applyPaymentSucceeded(
  session: CheckoutSession,
  event: PaymentSucceededEvent
): CheckoutSession {
  return {
    ...session,
    status: "complete",
    order: { id: event.orderId },
    payment: {
      ...session.payment,
      status: "succeeded",
      gatewayMetadata: {
        ...session.payment.gatewayMetadata,
        paymentIntentId: event.paymentIntentId,
        ...(event.gatewayMetadata ?? {}),
      },
    },
  };
}

export function applyPaymentFailed(
  session: CheckoutSession,
  event: PaymentFailedEvent
): CheckoutSession {
  return {
    ...session,
    status: "open",
    order: null,
    payment: {
      ...session.payment,
      status: "failed",
      gatewayMetadata: {
        ...session.payment.gatewayMetadata,
        ...(event.gatewayMetadata ?? {}),
      },
    },
  };
}
