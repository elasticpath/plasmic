/**
 * Manual OrderFirstAdapter — host-configurable purchase / authorize setup body.
 */

import { createManualAdapter } from "../adapters/manual-adapter";
import type { CheckoutSession } from "../types";

function makeSession(): CheckoutSession {
  return {
    id: "sess_123",
    status: "open",
    cartId: "cart_abc",
    cartHash: "hash_abc",
    customerInfo: { name: "Jane Doe", email: "jane@example.com" },
    shippingAddress: {
      firstName: "Jane",
      lastName: "Doe",
      line1: "123 Main St",
      city: "Springfield",
      country: "US",
      postcode: "62701",
    },
    billingAddress: {
      firstName: "Jane",
      lastName: "Doe",
      line1: "123 Main St",
      city: "Springfield",
      country: "US",
      postcode: "62701",
    },
    selectedShippingRateId: "rate_1",
    availableShippingRates: [],
    totals: {
      subtotal: 5000,
      tax: 500,
      shipping: 800,
      total: 6300,
      currency: "usd",
    },
    payment: {
      gateway: "manual",
      status: "idle",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: { id: "order-1" },
    expiresAt: Date.now() + 1800_000,
  };
}

describe("createManualAdapter", () => {
  it("declares paymentSequence === order_first", () => {
    const adapter = createManualAdapter();
    expect(adapter.paymentSequence).toBe("order_first");
    expect(adapter).not.toHaveProperty("initializePayment");
    expect(adapter).not.toHaveProperty("confirmPayment");
  });

  it("defaults buildPaymentSetup to Manual purchase", () => {
    const adapter = createManualAdapter();
    expect(adapter.buildPaymentSetup(makeSession(), {})).toEqual({
      gateway: "manual",
      method: "purchase",
    });
  });

  it("buildPaymentSetup returns explicit purchase when configured", () => {
    const adapter = createManualAdapter({ method: "purchase" });
    expect(adapter.buildPaymentSetup(makeSession(), {})).toEqual({
      gateway: "manual",
      method: "purchase",
    });
  });

  it("buildPaymentSetup returns authorize when configured", () => {
    const adapter = createManualAdapter({ method: "authorize" });
    expect(adapter.buildPaymentSetup(makeSession(), {})).toEqual({
      gateway: "manual",
      method: "authorize",
    });
  });
});
