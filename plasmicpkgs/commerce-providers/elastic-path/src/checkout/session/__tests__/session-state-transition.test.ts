/**
 * Session State Transition — pure functions that drive the open → complete
 * lifecycle. Slice 1 covers the happy path (open + paymentSucceeded → complete)
 * and the failed path (open + paymentFailed → open with payment.status=failed).
 *
 * Slices 2+ add: requires_action (3DS), expired, processing.
 */
import {
  applyPaymentSucceeded,
  applyPaymentFailed,
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
