/**
 * C-4.1: Stripe adapter tests
 *
 * Covers: PaymentIntent creation, confirmation with status check, metadata
 * validation (cross-session attack prevention), missing config, card declined,
 * StripeCardError handling, missing totals/orderId, and requires_action status.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() to obtain the
 * mocked module reference so interception works regardless of import order.
 */

// Mock the stripe module with a factory that returns a mock Stripe constructor
const mockPaymentIntentsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();

jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      retrieve: mockPaymentIntentsRetrieve,
    },
  }));
}, { virtual: true });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createStripeAdapter } = require("../adapters/stripe-adapter") as {
  createStripeAdapter: typeof import("../adapters/stripe-adapter").createStripeAdapter;
};

import type { CheckoutSession } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADAPTER_CONFIG = {
  secretKey: "sk_test_123456",
};

function makeSession(overrides?: Partial<CheckoutSession>): CheckoutSession {
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
    totals: { subtotal: 5000, tax: 500, shipping: 800, total: 6300, currency: "usd" },
    payment: {
      gateway: "stripe",
      status: "idle",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: { id: "order_xyz", transactionId: "txn_123" },
    expiresAt: Date.now() + 1800_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createStripeAdapter", () => {
  const adapter = createStripeAdapter(ADAPTER_CONFIG);

  beforeEach(() => jest.clearAllMocks());

  describe("initializePayment", () => {
    it("creates PaymentIntent and returns ready with clientToken", async () => {
      mockPaymentIntentsCreate.mockResolvedValue({
        id: "pi_test_001",
        client_secret: "pi_test_001_secret_abc",
        status: "requires_payment_method",
      });

      const result = await adapter.initializePayment(makeSession(), {});

      expect(result.status).toBe("ready");
      expect(result.clientToken).toBe("pi_test_001_secret_abc");
      expect(result.gatewayMetadata).toEqual({ paymentIntentId: "pi_test_001" });
      expect(result.gatewayOrderId).toBe("pi_test_001");
      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
        amount: 6300,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          order_id: "order_xyz",
          source: "ep-checkout-session",
        },
      });
    });

    it("returns failed when client_secret is missing", async () => {
      mockPaymentIntentsCreate.mockResolvedValue({
        id: "pi_test_002",
        client_secret: null,
      });

      const result = await adapter.initializePayment(makeSession(), {});

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Failed to create payment intent");
    });

    it("returns failed with user-friendly message on StripeCardError", async () => {
      const err = new Error("Your card has insufficient funds");
      (err as any).type = "StripeCardError";
      mockPaymentIntentsCreate.mockRejectedValue(err);

      const result = await adapter.initializePayment(makeSession(), {});

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Your card was declined");
    });

    it("returns failed with error message on generic Stripe error", async () => {
      mockPaymentIntentsCreate.mockRejectedValue(
        new Error("Stripe API rate limit exceeded")
      );

      const result = await adapter.initializePayment(makeSession(), {});

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Stripe API rate limit exceeded");
    });

    it("returns failed when order ID is missing", async () => {
      const session = makeSession({ order: null });
      const result = await adapter.initializePayment(session, {});
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("No order ID in session");
    });

    it("returns failed when totals are missing", async () => {
      const session = makeSession({ totals: null });
      const result = await adapter.initializePayment(session, {});
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Missing totals in session");
    });

    it("lowercases currency before sending to Stripe", async () => {
      mockPaymentIntentsCreate.mockResolvedValue({
        id: "pi_test_003",
        client_secret: "pi_test_003_secret",
      });

      const session = makeSession({
        totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: "USD" },
      });
      await adapter.initializePayment(session, {});

      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "usd" })
      );
    });
  });

  describe("confirmPayment", () => {
    it("returns succeeded when PaymentIntent status is succeeded", async () => {
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_test_001",
        status: "succeeded",
        metadata: { order_id: "order_xyz" },
      });

      const result = await adapter.confirmPayment(makeSession(), {
        paymentIntentId: "pi_test_001",
      });

      expect(result.status).toBe("succeeded");
      expect(result.gatewayOrderId).toBe("pi_test_001");
      expect(result.gatewayMetadata).toEqual({ paymentIntentId: "pi_test_001" });
      expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith("pi_test_001");
    });

    it("returns failed when metadata order_id doesn't match session", async () => {
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_test_001",
        status: "succeeded",
        metadata: { order_id: "order_DIFFERENT" },
      });

      const result = await adapter.confirmPayment(makeSession(), {
        paymentIntentId: "pi_test_001",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Payment intent does not match order");
    });

    it("returns requires_action when PaymentIntent needs further action", async () => {
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_test_001",
        status: "requires_action",
        metadata: { order_id: "order_xyz" },
      });

      const result = await adapter.confirmPayment(makeSession(), {
        paymentIntentId: "pi_test_001",
      });

      expect(result.status).toBe("requires_action");
      expect(result.gatewayMetadata).toEqual({ paymentIntentId: "pi_test_001" });
    });

    it("returns failed when PaymentIntent requires_payment_method", async () => {
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_test_001",
        status: "requires_payment_method",
        metadata: { order_id: "order_xyz" },
      });

      const result = await adapter.confirmPayment(makeSession(), {
        paymentIntentId: "pi_test_001",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe(
        "Payment failed. Please try a different card."
      );
    });

    it("returns failed with status message for unknown PaymentIntent status", async () => {
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_test_001",
        status: "canceled",
        metadata: { order_id: "order_xyz" },
      });

      const result = await adapter.confirmPayment(makeSession(), {
        paymentIntentId: "pi_test_001",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe(
        "Payment not completed. Status: canceled"
      );
    });

    it("returns failed when paymentIntentId is missing", async () => {
      const result = await adapter.confirmPayment(makeSession(), {});

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe(
        "Missing paymentIntentId for Stripe confirmation"
      );
    });

    it("returns failed when Stripe retrieve throws", async () => {
      mockPaymentIntentsRetrieve.mockRejectedValue(
        new Error("No such payment_intent: pi_invalid")
      );

      const result = await adapter.confirmPayment(makeSession(), {
        paymentIntentId: "pi_invalid",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe(
        "No such payment_intent: pi_invalid"
      );
    });
  });
});
