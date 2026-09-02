/**
 * Session State Transition — pure functions that drive the open → complete
 * lifecycle. Slice 1 covers the happy path (open + paymentSucceeded → complete)
 * and the failed path (open + paymentFailed → open with payment.status=failed).
 *
 * Stripe 3DS: open → open with payment.status=requires_action (no order).
 */
import {
  applyPaymentFailed,
  applyPaymentRequiresAction,
  applyPaymentSucceeded,
} from "../session-state-transition";
import type { CheckoutSession } from "../types";

function makeSession(overrides?: Partial<CheckoutSession>): CheckoutSession {
  return {
    id: "sess_1",
    status: "open",
    cartId: "cart_1",
    cartHash: "h",
    customerInfo: { name: "Jane", email: "jane@example.com" },
    shippingAddress: null,
    billingAddress: null,
    selectedShippingRateId: null,
    availableShippingRates: [],
    totals: null,
    payment: {
      gateway: "stripe",
      status: "idle",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: null,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("applyPaymentSucceeded", () => {
  it("transitions open → complete and stamps order + payment metadata", () => {
    const result = applyPaymentSucceeded(makeSession(), {
      orderId: "order_xyz",
      paymentIntentId: "pi_abc",
    });

    expect(result.status).toBe("complete");
    expect(result.order).toEqual({ id: "order_xyz" });
    expect(result.payment.status).toBe("succeeded");
    expect(result.payment.gatewayMetadata).toMatchObject({
      paymentIntentId: "pi_abc",
    });
  });

  it("preserves customerInfo and addresses unchanged", () => {
    const before = makeSession();
    const after = applyPaymentSucceeded(before, {
      orderId: "order_1",
      paymentIntentId: "pi_1",
    });
    expect(after.customerInfo).toBe(before.customerInfo);
  });
});

describe("applyPaymentFailed", () => {
  it("keeps status open and marks payment failed (retryable)", () => {
    const result = applyPaymentFailed(makeSession(), {
      errorMessage: "card_declined",
    });

    expect(result.status).toBe("open");
    expect(result.payment.status).toBe("failed");
    expect(result.order).toBeNull();
  });

  it("does not create an order on failure", () => {
    const result = applyPaymentFailed(makeSession(), {
      errorMessage: "card_declined",
    });
    expect(result.order).toBeNull();
  });
});

describe("applyPaymentRequiresAction", () => {
  it("keeps status open and marks payment requires_action (no order)", () => {
    const result = applyPaymentRequiresAction(makeSession(), {
      clientToken: "pi_abc_secret_xyz",
      actionData: { type: "stripe_3ds", paymentIntentId: "pi_abc" },
      gatewayMetadata: { paymentIntentId: "pi_abc" },
    });

    expect(result.status).toBe("open");
    expect(result.payment.status).toBe("requires_action");
    expect(result.order).toBeNull();
    expect(result.payment.clientToken).toBe("pi_abc_secret_xyz");
    expect(result.payment.actionData).toEqual({
      type: "stripe_3ds",
      paymentIntentId: "pi_abc",
    });
    expect(result.payment.gatewayMetadata).toMatchObject({
      paymentIntentId: "pi_abc",
    });
  });

  it("does not mark the payment failed", () => {
    const result = applyPaymentRequiresAction(makeSession(), {
      clientToken: "pi_secret",
      actionData: { type: "stripe_3ds", paymentIntentId: "pi_1" },
    });
    expect(result.payment.status).not.toBe("failed");
    expect(result.payment.status).toBe("requires_action");
  });

  it("preserves customerInfo and addresses unchanged", () => {
    const before = makeSession();
    const after = applyPaymentRequiresAction(before, {
      clientToken: "pi_secret",
      actionData: { type: "stripe_3ds", paymentIntentId: "pi_1" },
    });
    expect(after.customerInfo).toBe(before.customerInfo);
    expect(after.shippingAddress).toBe(before.shippingAddress);
    expect(after.billingAddress).toBe(before.billingAddress);
  });

  it("clears a stale clientToken when the event carries none", () => {
    const first = applyPaymentRequiresAction(makeSession(), {
      clientToken: "pi_1_secret_old",
      actionData: { type: "stripe_3ds", paymentIntentId: "pi_1" },
      gatewayMetadata: { paymentIntentId: "pi_1" },
    });

    const second = applyPaymentRequiresAction(first, {
      clientToken: null,
      actionData: null,
      gatewayMetadata: { paymentIntentId: "pi_2" },
    });

    expect(second.payment.clientToken).toBeNull();
    expect(second.payment.actionData).toBeNull();
    expect(second.payment.gatewayMetadata).toMatchObject({
      paymentIntentId: "pi_2",
    });
  });

  it("preserves an existing unpaid order (resume retry)", () => {
    const withOrder = makeSession({ order: { id: "order-unpaid" } });
    const result = applyPaymentRequiresAction(withOrder, {
      clientToken: "pi_secret",
      actionData: { type: "stripe_3ds", paymentIntentId: "pi_1" },
    });
    expect(result.order).toEqual({ id: "order-unpaid" });
    expect(result.status).toBe("open");
    expect(result.payment.status).toBe("requires_action");
  });
});
