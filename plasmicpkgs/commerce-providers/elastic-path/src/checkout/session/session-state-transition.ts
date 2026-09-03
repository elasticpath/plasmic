/**
 * Session State Transition — pure helpers that produce the next session
 * given the previous session and a transition event.
 *
 * Slice 1: open → complete on payment succeeded; open → open (with
 * payment.status=failed) on payment failed. An existing unpaid order
 * (resume after checkoutApi) is kept; /pay failure has no order yet.
 * Stripe 3DS: open → open with payment.status=requires_action.
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

export interface PaymentRequiresActionEvent {
  clientToken?: string | null;
  actionData?: Record<string, unknown> | null;
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
    order: session.order,
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

/** Persist a 3DS / SCA challenge. Session stays open and retryable.
 *  Does not create an order; an existing unpaid order (resume retry) is kept. */
export function applyPaymentRequiresAction(
  session: CheckoutSession,
  event: PaymentRequiresActionEvent
): CheckoutSession {
  return {
    ...session,
    status: "open",
    order: session.order,
    payment: {
      ...session.payment,
      status: "requires_action",
      clientToken: event.clientToken ?? null,
      actionData: event.actionData ?? null,
      gatewayMetadata: {
        ...session.payment.gatewayMetadata,
        ...(event.gatewayMetadata ?? {}),
      },
    },
  };
}
