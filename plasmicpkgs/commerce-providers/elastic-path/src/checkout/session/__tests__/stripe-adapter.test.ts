/**
 * Cart Payment Intent Adapter — server-side adapter that calls EP's
 * `createCartPaymentIntent` with `gateway: "elastic_path_payments_stripe"`,
 * `confirm: true`, and the client-supplied `confirmation_token`.
 *
 * EP holds the Stripe credentials. The host app no longer talks to Stripe
 * directly; the `stripe` npm package is no longer a runtime dependency.
 *
 * Slice 1 (this PR): cover the succeeded and failed branches. The
 * `requires_action` (3DS) branch ships in slice 2.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() to obtain the
 * mocked module reference so interception works regardless of import order.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createCartPaymentIntent: jest.fn(),
  createShopperClient: jest.fn(() => ({ client: {} })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  createCartPaymentIntent: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createStripeAdapter } = require("../adapters/stripe-adapter") as {
  createStripeAdapter: typeof import("../adapters/stripe-adapter").createStripeAdapter;
};

import type { CheckoutSession } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADAPTER_CONFIG = {
  host: "https://api.test.elasticpath.com",
  clientId: "test-client-id",
  getClientCredentialsToken: jest.fn(async () => "admin-token-abc"),
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
    totals: {
      subtotal: 5000,
      tax: 500,
      shipping: 800,
      total: 6300,
      currency: "usd",
    },
    payment: {
      gateway: "stripe",
      status: "idle",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: null,
    expiresAt: Date.now() + 1800_000,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("createStripeAdapter — Cart Payment Intent (EP-native)", () => {
  describe("initializePayment (single-shot confirm)", () => {
    it("posts EP createCartPaymentIntent with elastic_path_payments_stripe + purchase + confirm + token", async () => {
      // EP returns the Stripe PaymentIntent nested under
      // meta.payment_intent.payment_intent.
      epSdk.createCartPaymentIntent.mockResolvedValue({
        data: {
          data: { id: "cart_abc", payment_intent_id: "pi_test_001" },
          meta: {
            payment_intent: {
              payment_intent: { id: "pi_test_001", status: "succeeded" },
            },
          },
        },
      });

      const adapter = createStripeAdapter(ADAPTER_CONFIG);
      const result = await adapter.initializePayment(makeSession(), {
        confirmation_token: "ctoken_abc",
      });

      expect(result.status).toBe("succeeded");
      expect(result.gatewayOrderId).toBe("pi_test_001");
      expect(result.gatewayMetadata).toMatchObject({
        paymentIntentId: "pi_test_001",
      });

      expect(epSdk.createCartPaymentIntent).toHaveBeenCalledTimes(1);
      const call = epSdk.createCartPaymentIntent.mock.calls[0][0];
      expect(call.path).toEqual({ cartID: "cart_abc" });
      // Token sent as an explicit Authorization header (not via the SDK client).
      expect(call.headers.Authorization).toBe("Bearer admin-token-abc");
      expect(call.body.data.gateway).toBe("elastic_path_payments_stripe");
      expect(call.body.data.method).toBe("purchase");
      // payment_method_types is intentionally omitted — it conflicts with
      // automatic_payment_methods, which Stripe rejects.
      expect(call.body.data.payment_method_types).toBeUndefined();
      expect(call.body.data.options).toMatchObject({
        confirm: true,
        confirmation_token: "ctoken_abc",
        automatic_payment_methods: { enabled: true },
      });
    });

    it("uses the admin token resolver before posting (request-scoped auth)", async () => {
      epSdk.createCartPaymentIntent.mockResolvedValue({
        data: {
          data: {
            payment_intent: { id: "pi_x", status: "succeeded" },
          },
        },
      });

      const adapter = createStripeAdapter(ADAPTER_CONFIG);
      await adapter.initializePayment(makeSession(), {
        confirmation_token: "ctoken_abc",
      });

      expect(ADAPTER_CONFIG.getClientCredentialsToken).toHaveBeenCalledTimes(1);
    });

    it("returns failed when EP responds with a non-succeeded status", async () => {
      epSdk.createCartPaymentIntent.mockResolvedValue({
        data: {
          data: {
            payment_intent: {
              id: "pi_failed",
              status: "requires_payment_method",
            },
          },
        },
      });

      const adapter = createStripeAdapter(ADAPTER_CONFIG);
      const result = await adapter.initializePayment(makeSession(), {
        confirmation_token: "ctoken_abc",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toMatch(/requires_payment_method/);
      expect(result.gatewayMetadata).toMatchObject({
        paymentIntentId: "pi_failed",
      });
    });

    it("returns failed when EP response is missing the payment_intent block", async () => {
      epSdk.createCartPaymentIntent.mockResolvedValue({
        data: { data: {} },
      });

      const adapter = createStripeAdapter(ADAPTER_CONFIG);
      const result = await adapter.initializePayment(makeSession(), {
        confirmation_token: "ctoken_abc",
      });

      expect(result.status).toBe("failed");
    });

    it("does not import the stripe npm package", () => {
      const required = Object.keys(require.cache).filter((k) =>
        k.includes("/node_modules/stripe/")
      );
      expect(required).toEqual([]);
    });
  });
});
