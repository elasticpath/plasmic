/**
 * A-10.7: handlePay tests
 *
 * The most critical handler. Tests cover all guard conditions, cart-hash
 * mismatch (409), EP checkout / paymentSetup failures (502), and the full
 * mapping of adapter result statuses to session fields.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() to obtain the
 * mocked module reference so interception works regardless of import order.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: jest.fn(),
  checkoutApi: jest.fn(),
  paymentSetup: jest.fn(),
  confirmPayment: jest.fn(),
  getShippingOptions: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  getACart: jest.Mock;
  checkoutApi: jest.Mock;
  paymentSetup: jest.Mock;
  confirmPayment: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handlePay } = require("../pay") as {
  handlePay: typeof import("../pay").handlePay;
};

import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
  PaymentAdapter,
  PaymentAdapterResult,
  SessionAddress,
  SessionCustomerInfo,
  AdapterRegistry,
  SessionStore,
} from "../../../../checkout/session/types";
import { hashCart } from "../../../../checkout/session/cart-hash";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CUSTOMER_INFO: SessionCustomerInfo = {
  name: "Jane Doe",
  email: "jane@example.com",
};

const ADDRESS: SessionAddress = {
  firstName: "Jane",
  lastName: "Doe",
  line1: "123 Main St",
  city: "Springfield",
  country: "US",
  postcode: "12345",
};

const CART_ITEMS = [
  { id: "item-1", quantity: 2, unit_price: { amount: 1500 } },
  { id: "item-2", quantity: 1, unit_price: { amount: 2400 } },
];

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-pay",
    status: "open",
    cartId: "cart-abc",
    cartHash: hashCart(CART_ITEMS),
    customerInfo: CUSTOMER_INFO,
    shippingAddress: ADDRESS,
    billingAddress: ADDRESS,
    selectedShippingRateId: "rate-standard",
    availableShippingRates: [],
    totals: null,
    payment: {
      gateway: null,
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

function createMockStore(session: CheckoutSession | null = null): SessionStore {
  return {
    get: jest.fn().mockResolvedValue(session),
    set: jest.fn().mockResolvedValue({ headers: { "Set-Cookie": "ep_cs=test; Path=/" } }),
    delete: jest.fn().mockResolvedValue({ headers: { "Set-Cookie": "ep_cs=; Max-Age=0" } }),
  };
}

function createMockAdapter(
  initResult: PaymentAdapterResult = { status: "ready" }
): PaymentAdapter {
  return {
    initializePayment: jest.fn().mockResolvedValue(initResult),
    confirmPayment: jest.fn().mockResolvedValue({ status: "succeeded", gatewayOrderId: "gw-123" }),
  };
}

function createMockRegistry(adapter?: PaymentAdapter): AdapterRegistry {
  return {
    register: jest.fn(),
    getAdapter: jest.fn().mockReturnValue(adapter),
  };
}

function createMockCtx(
  session: CheckoutSession | null,
  adapter?: PaymentAdapter,
  overrides: Partial<SessionHandlerContext> = {}
): SessionHandlerContext {
  return {
    epCredentials: {
      clientId: "test-id",
      clientSecret: "test-secret",
      apiBaseUrl: "https://api.test.com",
    },
    adapterRegistry: createMockRegistry(adapter),
    sessionStore: createMockStore(session),
    ...overrides,
  };
}

function createMockReq(body: Record<string, unknown> = {}): SessionRequest {
  return { body, headers: {}, cookies: {} };
}

function makeCartResponse(items: unknown[] = []) {
  return { data: { included: { items } } };
}

function makeCheckoutResponse(orderId = "order-1") {
  return {
    data: {
      data: {
        id: orderId,
        meta: {
          display_price: {
            with_tax: { amount: 9000, currency: "USD" },
            without_tax: { amount: 8000, currency: "USD" },
            tax: { amount: 1000 },
            shipping: { amount: 500 },
          },
        },
      },
    },
  };
}

function makePaymentSetupResponse(txId = "tx-1") {
  return { data: { data: { id: txId } } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handlePay", () => {
  beforeEach(() => {
    epSdk.getACart.mockReset();
    epSdk.checkoutApi.mockReset();
    epSdk.paymentSetup.mockReset();
    epSdk.confirmPayment.mockReset();

    // Default: all EP calls succeed
    epSdk.getACart.mockResolvedValue(makeCartResponse(CART_ITEMS) as any);
    epSdk.checkoutApi.mockResolvedValue(makeCheckoutResponse() as any);
    epSdk.paymentSetup.mockResolvedValue(makePaymentSetupResponse() as any);
  });

  // -------------------------------------------------------------------------
  // Guard conditions
  // -------------------------------------------------------------------------

  describe("guard: session not found", () => {
    it("returns 410 when session store returns null", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(null, createMockAdapter())
      );
      expect(res.status).toBe(410);
      expect((res.body as any).error.code).toBe("SESSION_GONE");
    });
  });

  describe("guard: double-submit protection", () => {
    it("returns 400 when session status is 'processing'", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession({ status: "processing" }), createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("SESSION_NOT_OPEN");
    });

    it("returns 400 when session status is 'complete'", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession({ status: "complete" }), createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("SESSION_NOT_OPEN");
    });
  });

  describe("guard: gateway validation", () => {
    it("returns 400 when gateway is missing from request body", async () => {
      const res = await handlePay(
        createMockReq({}),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when gateway is not a string", async () => {
      const res = await handlePay(
        createMockReq({ gateway: 42 }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 with UNKNOWN_GATEWAY when adapter not registered", async () => {
      const ctx = createMockCtx(makeSession(), undefined, {
        adapterRegistry: createMockRegistry(undefined),
      });
      const res = await handlePay(
        createMockReq({ gateway: "nonexistent" }),
        ctx
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("UNKNOWN_GATEWAY");
      expect((res.body as any).error.message).toContain("nonexistent");
    });
  });

  describe("guard: missing required checkout fields", () => {
    it("returns 400 with MISSING_FIELDS when customerInfo is absent", async () => {
      const session = makeSession({ customerInfo: null });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("MISSING_FIELDS");
      expect((res.body as any).error.message).toContain("customerInfo");
    });

    it("returns 400 with MISSING_FIELDS when shippingAddress is absent", async () => {
      const session = makeSession({ shippingAddress: null });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("MISSING_FIELDS");
    });

    it("returns 400 when billingAddress is absent", async () => {
      const session = makeSession({ billingAddress: null });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("MISSING_FIELDS");
    });

    it("returns 400 when selectedShippingRateId is absent", async () => {
      const session = makeSession({ selectedShippingRateId: null });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("MISSING_FIELDS");
    });

    it("lists all missing fields in the error message", async () => {
      const session = makeSession({
        customerInfo: null,
        shippingAddress: null,
        billingAddress: null,
        selectedShippingRateId: null,
      });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter())
      );
      const msg = (res.body as any).error.message as string;
      expect(msg).toContain("customerInfo");
      expect(msg).toContain("shippingAddress");
      expect(msg).toContain("billingAddress");
      expect(msg).toContain("selectedShippingRateId");
    });
  });

  // -------------------------------------------------------------------------
  // Cart hash mismatch
  // -------------------------------------------------------------------------

  describe("cart hash mismatch", () => {
    it("returns 409 when cart has changed since session creation", async () => {
      const differentItems = [
        { id: "item-1", quantity: 99, unit_price: { amount: 1500 } },
      ];
      epSdk.getACart.mockResolvedValue(makeCartResponse(differentItems) as any);

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );

      expect(res.status).toBe(409);
      expect((res.body as any).error.code).toBe("CART_MISMATCH");
    });

    it("409 response contains a refreshed session", async () => {
      const differentItems = [
        { id: "item-1", quantity: 99, unit_price: { amount: 1500 } },
      ];
      epSdk.getACart.mockResolvedValue(makeCartResponse(differentItems) as any);

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );

      expect((res.body as any).data?.session).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // EP failures
  // -------------------------------------------------------------------------

  describe("EP failures", () => {
    it("returns 502 when getACart throws during hash re-check", async () => {
      epSdk.getACart.mockRejectedValue(new Error("EP unavailable"));

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect(res.status).toBe(502);
      expect((res.body as any).error.code).toBe("EP_ERROR");
    });

    it("returns 502 when checkoutApi (cart→order) fails", async () => {
      epSdk.checkoutApi.mockRejectedValue(new Error("Checkout failed"));

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect(res.status).toBe(502);
      expect((res.body as any).error.code).toBe("EP_ERROR");
    });

    it("returns 502 when checkoutApi response has no order ID", async () => {
      epSdk.checkoutApi.mockResolvedValue({ data: { data: {} } } as any);

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect(res.status).toBe(502);
    });

    it("returns 502 when paymentSetup (authorize) fails", async () => {
      epSdk.paymentSetup.mockRejectedValue(new Error("Auth failed"));

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect(res.status).toBe(502);
      expect((res.body as any).error.code).toBe("EP_ERROR");
    });

    it("returns 502 when paymentSetup response has no transaction ID", async () => {
      epSdk.paymentSetup.mockResolvedValue({ data: { data: {} } } as any);

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect(res.status).toBe(502);
    });
  });

  // -------------------------------------------------------------------------
  // Adapter result mapping
  // -------------------------------------------------------------------------

  describe("adapter result: 'ready'", () => {
    it("returns 200 on successful adapter 'ready' result", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter({ status: "ready" }))
      );
      expect(res.status).toBe(200);
    });

    it("session status becomes 'processing' on 'ready'", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter({ status: "ready" }))
      );
      expect((res.body as any).data.session.status).toBe("processing");
    });

    it("payment.status becomes 'pending' on 'ready'", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter({ status: "ready" }))
      );
      expect((res.body as any).data.session.payment.status).toBe("pending");
    });

    it("session contains order id after successful checkout", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter({ status: "ready" }))
      );
      expect((res.body as any).data.session.order?.id).toBe("order-1");
    });

    it("adapter clientToken is propagated to session.payment.clientToken", async () => {
      const adapter = createMockAdapter({
        status: "ready",
        clientToken: "pi_test_secret",
      });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), adapter)
      );
      expect((res.body as any).data.session.payment.clientToken).toBe("pi_test_secret");
    });
  });

  describe("adapter result: 'requires_action'", () => {
    it("returns 200 with requires_action payment status", async () => {
      const adapter = createMockAdapter({
        status: "requires_action",
        actionData: { redirectUrl: "https://3ds.example.com" },
      });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), adapter)
      );
      expect(res.status).toBe(200);
      expect((res.body as any).data.session.payment.status).toBe("requires_action");
    });

    it("actionData is set on payment for 'requires_action'", async () => {
      const actionData = { redirectUrl: "https://3ds.example.com" };
      const adapter = createMockAdapter({ status: "requires_action", actionData });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), adapter)
      );
      expect((res.body as any).data.session.payment.actionData).toEqual(actionData);
    });
  });

  describe("adapter result: 'failed'", () => {
    it("returns 200 even when adapter reports 'failed'", async () => {
      const adapter = createMockAdapter({
        status: "failed",
        errorMessage: "Card declined",
      });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), adapter)
      );
      expect(res.status).toBe(200);
    });

    it("session status remains 'open' on 'failed' to allow retry", async () => {
      const adapter = createMockAdapter({ status: "failed" });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), adapter)
      );
      expect((res.body as any).data.session.status).toBe("open");
    });

    it("payment.status is 'failed' on adapter 'failed'", async () => {
      const adapter = createMockAdapter({ status: "failed" });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), adapter)
      );
      expect((res.body as any).data.session.payment.status).toBe("failed");
    });

    it("paymentError is included in response body when errorMessage is set", async () => {
      const adapter = createMockAdapter({
        status: "failed",
        errorMessage: "Card declined",
      });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), adapter)
      );
      expect((res.body as any).paymentError).toBe("Card declined");
    });

    it("paymentError is absent when adapter 'failed' has no errorMessage", async () => {
      const adapter = createMockAdapter({ status: "failed" });
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), adapter)
      );
      expect((res.body as any).paymentError).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // EP order retry — reuse existing order on payment retry
  // -------------------------------------------------------------------------

  describe("EP order retry", () => {
    it("skips checkoutApi when session already has an order (retry path)", async () => {
      const session = makeSession({
        order: { id: "existing-order", transactionId: "old-tx" },
        totals: { subtotal: 8000, tax: 1000, shipping: 500, total: 9000, currency: "USD" },
      });

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter({ status: "ready" }))
      );

      expect(res.status).toBe(200);
      // checkoutApi should NOT have been called — the order already exists
      expect(epSdk.checkoutApi).not.toHaveBeenCalled();
      // paymentSetup SHOULD have been called on the existing order
      expect(epSdk.paymentSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { orderID: "existing-order" },
        })
      );
    });

    it("preserves existing totals on retry (no order meta to extract from)", async () => {
      const existingTotals = { subtotal: 5000, tax: 500, shipping: 300, total: 5800, currency: "USD" };
      const session = makeSession({
        order: { id: "existing-order", transactionId: "old-tx" },
        totals: existingTotals,
      });

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter({ status: "ready" }))
      );

      expect(res.status).toBe(200);
      const returnedTotals = (res.body as any).data.session.totals;
      expect(returnedTotals).toEqual(existingTotals);
    });

    it("uses new transactionId from re-authorization on retry", async () => {
      epSdk.paymentSetup.mockResolvedValue(makePaymentSetupResponse("new-tx-retry") as any);

      const session = makeSession({
        order: { id: "existing-order", transactionId: "old-tx" },
        totals: { subtotal: 8000, tax: 1000, shipping: 500, total: 9000, currency: "USD" },
      });

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter({ status: "ready" }))
      );

      expect(res.status).toBe(200);
      expect(
        (res.body as any).data.session.payment.gatewayMetadata.epTransactionId
      ).toBe("new-tx-retry");
      expect((res.body as any).data.session.order.id).toBe("existing-order");
    });

    it("still validates cart hash on retry", async () => {
      const differentItems = [
        { id: "item-1", quantity: 99, unit_price: { amount: 1500 } },
      ];
      epSdk.getACart.mockResolvedValue(makeCartResponse(differentItems) as any);

      const session = makeSession({
        order: { id: "existing-order", transactionId: "old-tx" },
        totals: { subtotal: 8000, tax: 1000, shipping: 500, total: 9000, currency: "USD" },
      });

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter())
      );

      expect(res.status).toBe(409);
      expect((res.body as any).error.code).toBe("CART_MISMATCH");
    });

    it("returns 502 when re-authorization fails on retry", async () => {
      epSdk.paymentSetup.mockRejectedValue(new Error("Auth failed on retry"));

      const session = makeSession({
        order: { id: "existing-order", transactionId: "old-tx" },
        totals: { subtotal: 8000, tax: 1000, shipping: 500, total: 9000, currency: "USD" },
      });

      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(session, createMockAdapter())
      );

      expect(res.status).toBe(502);
      expect((res.body as any).error.code).toBe("EP_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Response invariants
  // -------------------------------------------------------------------------

  describe("response invariants", () => {
    it("client session does NOT expose cartHash", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      const session = (res.body as any).data.session;
      expect(Object.prototype.hasOwnProperty.call(session, "cartHash")).toBe(false);
    });

    it("response includes Set-Cookie header on success", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect(res.headers?.["Set-Cookie"]).toBeDefined();
    });

    it("gateway name is stored on session.payment.gateway", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect((res.body as any).data.session.payment.gateway).toBe("stripe");
    });

    it("EP transactionId is stored in payment.gatewayMetadata", async () => {
      const res = await handlePay(
        createMockReq({ gateway: "stripe" }),
        createMockCtx(makeSession(), createMockAdapter())
      );
      expect(
        (res.body as any).data.session.payment.gatewayMetadata.epTransactionId
      ).toBe("tx-1");
    });
  });
});
