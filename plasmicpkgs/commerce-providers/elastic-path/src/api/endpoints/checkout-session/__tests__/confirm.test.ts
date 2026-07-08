/**
 * A-10.8: handleConfirm tests
 *
 * Covers the full lifecycle: missing session (410), missing order / gateway
 * preconditions (400), non-confirmable state (400), adapter-delegated success
 * path (200 + complete), 3DS escalation (requires_action), retry reset
 * (failed → open), and EP capture failure (502).
 *
 * Note: esbuild does not hoist jest.mock(). We use require() to obtain the
 * mocked module reference so interception works regardless of import order.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: jest.fn(),
  checkoutApi: jest.fn(),
  paymentSetup: jest.fn(),
  confirmPayment: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  getACart: jest.Mock;
  checkoutApi: jest.Mock;
  paymentSetup: jest.Mock;
  confirmPayment: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleConfirm } = require("../confirm") as {
  handleConfirm: typeof import("../confirm").handleConfirm;
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-confirm",
    status: "processing",
    cartId: "cart-abc",
    cartHash: "hash-abc",
    customerInfo: CUSTOMER_INFO,
    shippingAddress: ADDRESS,
    billingAddress: ADDRESS,
    selectedShippingRateId: "rate-standard",
    availableShippingRates: [],
    totals: { subtotal: 8000, tax: 1000, shipping: 500, total: 9500, currency: "USD" },
    payment: {
      gateway: "stripe",
      status: "pending",
      clientToken: "pi_test_secret",
      gatewayMetadata: { epTransactionId: "tx-1" },
      actionData: null,
    },
    order: { id: "order-1", transactionId: "tx-1" },
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
  confirmResult: PaymentAdapterResult = {
    status: "succeeded",
    gatewayOrderId: "gw-order-123",
  }
): PaymentAdapter {
  return {
    initializePayment: jest.fn().mockResolvedValue({ status: "ready" }),
    confirmPayment: jest.fn().mockResolvedValue(confirmResult),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleConfirm", () => {
  beforeEach(() => {
    epSdk.getACart.mockReset();
    epSdk.checkoutApi.mockReset();
    epSdk.paymentSetup.mockReset();
    epSdk.confirmPayment.mockReset();

    // Default: EP capture succeeds
    epSdk.confirmPayment.mockResolvedValue({} as any);
  });

  // -------------------------------------------------------------------------
  // Precondition guards
  // -------------------------------------------------------------------------

  describe("guard: session not found", () => {
    it("returns 410 when no session exists", async () => {
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(null, createMockAdapter())
      );
      expect(res.status).toBe(410);
      expect((res.body as any).error.code).toBe("SESSION_GONE");
    });
  });

  describe("guard: no order on session", () => {
    it("returns 400 when session.order is null", async () => {
      const session = makeSession({ order: null });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("NO_ORDER");
    });
  });

  describe("guard: no payment gateway on session", () => {
    it("returns 400 when session.payment.gateway is null", async () => {
      const session = makeSession({
        payment: {
          gateway: null,
          status: "pending",
          clientToken: null,
          gatewayMetadata: {},
          actionData: null,
        },
      });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("NO_GATEWAY");
    });
  });

  describe("guard: session not confirmable", () => {
    it("returns 400 when status is 'open' and payment.status is 'idle'", async () => {
      const session = makeSession({
        status: "open",
        payment: {
          gateway: "stripe",
          status: "idle",
          clientToken: null,
          gatewayMetadata: {},
          actionData: null,
        },
      });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("SESSION_NOT_CONFIRMABLE");
    });

    it("returns 400 when status is 'complete'", async () => {
      const session = makeSession({ status: "complete" });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("SESSION_NOT_CONFIRMABLE");
    });

    it("accepts session when status is 'processing'", async () => {
      const session = makeSession({ status: "processing" });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).not.toBe(400);
    });

    it("accepts session when payment.status is 'requires_action'", async () => {
      const session = makeSession({
        status: "open",
        payment: {
          gateway: "stripe",
          status: "requires_action",
          clientToken: "pi_secret",
          gatewayMetadata: {},
          actionData: { redirectUrl: "https://3ds.example.com" },
        },
      });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(session, createMockAdapter())
      );
      expect(res.status).not.toBe(400);
    });
  });

  describe("guard: unknown adapter", () => {
    it("returns 400 when the gateway adapter is not registered", async () => {
      const ctx = createMockCtx(makeSession(), undefined, {
        adapterRegistry: createMockRegistry(undefined),
      });
      const res = await handleConfirm(createMockReq({}), ctx);
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("UNKNOWN_GATEWAY");
    });
  });

  // -------------------------------------------------------------------------
  // Adapter result: 'succeeded'
  // -------------------------------------------------------------------------

  describe("adapter result: 'succeeded'", () => {
    it("returns 200 on successful confirmation", async () => {
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(
          makeSession(),
          createMockAdapter({ status: "succeeded", gatewayOrderId: "gw-123" })
        )
      );
      expect(res.status).toBe(200);
    });

    it("session status becomes 'complete'", async () => {
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(
          makeSession(),
          createMockAdapter({ status: "succeeded", gatewayOrderId: "gw-123" })
        )
      );
      expect((res.body as any).data.session.status).toBe("complete");
    });

    it("payment.status becomes 'succeeded'", async () => {
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(
          makeSession(),
          createMockAdapter({ status: "succeeded", gatewayOrderId: "gw-123" })
        )
      );
      expect((res.body as any).data.session.payment.status).toBe("succeeded");
    });

    it("calls EP confirmPayment (capture) once", async () => {
      await handleConfirm(
        createMockReq({}),
        createMockCtx(
          makeSession(),
          createMockAdapter({ status: "succeeded", gatewayOrderId: "gw-123" })
        )
      );
      expect(epSdk.confirmPayment).toHaveBeenCalledTimes(1);
    });

    it("passes the correct orderId and transactionId to EP confirmPayment", async () => {
      await handleConfirm(
        createMockReq({}),
        createMockCtx(
          makeSession(),
          createMockAdapter({ status: "succeeded", gatewayOrderId: "gw-123" })
        )
      );
      const callArgs = epSdk.confirmPayment.mock.calls[0][0];
      expect(callArgs.path.orderID).toBe("order-1");
      expect(callArgs.path.transactionID).toBe("tx-1");
    });

    it("returns 500 when session.order.transactionId is missing", async () => {
      const session = makeSession({
        order: { id: "order-1" }, // no transactionId
      });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(session, createMockAdapter({ status: "succeeded" }))
      );
      expect(res.status).toBe(500);
      expect((res.body as any).error.code).toBe("MISSING_TRANSACTION_ID");
    });

    it("returns 502 when EP confirmPayment (capture) fails", async () => {
      epSdk.confirmPayment.mockRejectedValue(new Error("EP capture failed"));

      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(
          makeSession(),
          createMockAdapter({ status: "succeeded", gatewayOrderId: "gw-123" })
        )
      );
      expect(res.status).toBe(502);
      expect((res.body as any).error.code).toBe("EP_ERROR");
    });

    it("response includes Set-Cookie header", async () => {
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(
          makeSession(),
          createMockAdapter({ status: "succeeded", gatewayOrderId: "gw-123" })
        )
      );
      expect(res.headers?.["Set-Cookie"]).toBeDefined();
    });

    it("client session does NOT expose cartHash", async () => {
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(
          makeSession(),
          createMockAdapter({ status: "succeeded", gatewayOrderId: "gw-123" })
        )
      );
      const session = (res.body as any).data.session;
      expect(Object.prototype.hasOwnProperty.call(session, "cartHash")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Adapter result: 'requires_action' (3DS escalation)
  // -------------------------------------------------------------------------

  describe("adapter result: 'requires_action'", () => {
    it("returns 200 with requires_action payment status", async () => {
      const actionData = { redirectUrl: "https://3ds.bank.com/auth" };
      const adapter = createMockAdapter({
        status: "requires_action",
        actionData,
      });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(makeSession(), adapter)
      );
      expect(res.status).toBe(200);
      expect((res.body as any).data.session.payment.status).toBe("requires_action");
    });

    it("updates payment.actionData with the escalated action", async () => {
      const actionData = { redirectUrl: "https://3ds.bank.com/auth" };
      const adapter = createMockAdapter({ status: "requires_action", actionData });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(makeSession(), adapter)
      );
      expect((res.body as any).data.session.payment.actionData).toEqual(actionData);
    });

    it("does NOT call EP confirmPayment (capture) for requires_action", async () => {
      const adapter = createMockAdapter({
        status: "requires_action",
        actionData: {},
      });
      await handleConfirm(
        createMockReq({}),
        createMockCtx(makeSession(), adapter)
      );
      expect(epSdk.confirmPayment).not.toHaveBeenCalled();
    });

    it("session status is unchanged for requires_action", async () => {
      const adapter = createMockAdapter({
        status: "requires_action",
        actionData: {},
      });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(makeSession({ status: "processing" }), adapter)
      );
      expect((res.body as any).data.session.status).toBe("processing");
    });
  });

  // -------------------------------------------------------------------------
  // Adapter result: 'failed'
  // -------------------------------------------------------------------------

  describe("adapter result: 'failed'", () => {
    it("returns 200 even when adapter confirms 'failed'", async () => {
      const adapter = createMockAdapter({ status: "failed" });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(makeSession(), adapter)
      );
      expect(res.status).toBe(200);
    });

    it("resets session status to 'open' to allow retry", async () => {
      const adapter = createMockAdapter({ status: "failed" });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(makeSession(), adapter)
      );
      expect((res.body as any).data.session.status).toBe("open");
    });

    it("sets payment.status to 'failed'", async () => {
      const adapter = createMockAdapter({ status: "failed" });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(makeSession(), adapter)
      );
      expect((res.body as any).data.session.payment.status).toBe("failed");
    });

    it("clears payment.actionData on failed", async () => {
      const session = makeSession({
        payment: {
          gateway: "stripe",
          status: "requires_action",
          clientToken: null,
          gatewayMetadata: {},
          actionData: { redirectUrl: "https://old-3ds.example.com" },
        },
      });
      const adapter = createMockAdapter({ status: "failed" });
      const res = await handleConfirm(
        createMockReq({}),
        createMockCtx(session, adapter)
      );
      expect((res.body as any).data.session.payment.actionData).toBeNull();
    });

    it("does NOT call EP confirmPayment on adapter failure", async () => {
      const adapter = createMockAdapter({ status: "failed" });
      await handleConfirm(
        createMockReq({}),
        createMockCtx(makeSession(), adapter)
      );
      expect(epSdk.confirmPayment).not.toHaveBeenCalled();
    });
  });
});
