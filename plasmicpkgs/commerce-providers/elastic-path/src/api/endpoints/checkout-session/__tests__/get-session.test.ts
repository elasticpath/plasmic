/**
 * A-10.4: handleGetSession tests
 *
 * Covers: session found (200 with session), no session (200 with null),
 * store error (500), and client-visible shape (cartHash stripped).
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: jest.fn(),
  checkoutApi: jest.fn(),
  paymentSetup: jest.fn(),
  confirmPayment: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleGetSession } = require("../get-session") as {
  handleGetSession: typeof import("../get-session").handleGetSession;
};

import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
} from "../../../../checkout/session/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-1",
    status: "open",
    cartId: "cart-abc",
    cartHash: "hash-abc-64chars-padded000000000000000000000000000000000000000",
    customerInfo: null,
    shippingAddress: null,
    billingAddress: null,
    selectedShippingRateId: null,
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

function createMockStore(session: CheckoutSession | null = null) {
  return {
    get: jest.fn().mockResolvedValue(session),
    set: jest.fn().mockResolvedValue({ headers: { "Set-Cookie": "ep_cs=test; Path=/" } }),
    delete: jest.fn().mockResolvedValue({ headers: { "Set-Cookie": "ep_cs=; Max-Age=0" } }),
  };
}

function createMockCtx(
  session: CheckoutSession | null,
  overrides: Partial<SessionHandlerContext> = {}
): SessionHandlerContext {
  return {
    epCredentials: {
      clientId: "test-id",
      apiBaseUrl: "https://api.test.com",
    },
    adapterRegistry: {
      register: jest.fn(),
      getAdapter: jest.fn().mockReturnValue(undefined),
    },
    sessionStore: createMockStore(session),
    ...overrides,
  };
}

function createMockReq(): SessionRequest {
  return { body: {}, headers: {}, cookies: {} };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleGetSession", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("no session exists", () => {
    it("returns 200 with session: null when store returns null", async () => {
      const res = await handleGetSession(createMockReq(), createMockCtx(null));
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect((res.body as any).data.session).toBeNull();
    });
  });

  describe("session found", () => {
    it("returns 200 with session data", async () => {
      const session = makeSession();
      const res = await handleGetSession(createMockReq(), createMockCtx(session));
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
    });

    it("returns the session object with correct id", async () => {
      const session = makeSession({ id: "sess-42" });
      const res = await handleGetSession(createMockReq(), createMockCtx(session));
      expect((res.body as any).data.session.id).toBe("sess-42");
    });

    it("returns the session with correct status", async () => {
      const session = makeSession({ status: "processing" });
      const res = await handleGetSession(createMockReq(), createMockCtx(session));
      expect((res.body as any).data.session.status).toBe("processing");
    });

    it("returns the session with correct cartId", async () => {
      const session = makeSession({ cartId: "cart-xyz" });
      const res = await handleGetSession(createMockReq(), createMockCtx(session));
      expect((res.body as any).data.session.cartId).toBe("cart-xyz");
    });

    it("returns session with payment info", async () => {
      const session = makeSession({
        payment: {
          gateway: "stripe",
          status: "pending",
          clientToken: "pi_secret_abc",
          gatewayMetadata: { paymentIntentId: "pi_123" },
          actionData: null,
        },
      });
      const res = await handleGetSession(createMockReq(), createMockCtx(session));
      const s = (res.body as any).data.session;
      expect(s.payment.gateway).toBe("stripe");
      expect(s.payment.status).toBe("pending");
      expect(s.payment.clientToken).toBe("pi_secret_abc");
    });

    it("client session does NOT expose cartHash", async () => {
      const session = makeSession({ cartHash: "secret-hash-value" });
      const res = await handleGetSession(createMockReq(), createMockCtx(session));
      const s = (res.body as any).data.session;
      expect(Object.prototype.hasOwnProperty.call(s, "cartHash")).toBe(false);
    });

    it("preserves customerInfo in response", async () => {
      const session = makeSession({
        customerInfo: { name: "Jane Doe", email: "jane@example.com" },
      });
      const res = await handleGetSession(createMockReq(), createMockCtx(session));
      expect((res.body as any).data.session.customerInfo).toEqual({
        name: "Jane Doe",
        email: "jane@example.com",
      });
    });

    it("preserves order data in response", async () => {
      const session = makeSession({
        status: "complete",
        order: { id: "order-123" },
      });
      const res = await handleGetSession(createMockReq(), createMockCtx(session));
      expect((res.body as any).data.session.order).toEqual({ id: "order-123" });
    });
  });

  describe("store error", () => {
    it("returns 500 when sessionStore.get throws", async () => {
      const store = createMockStore();
      store.get.mockRejectedValue(new Error("Crypto failure"));
      const res = await handleGetSession(
        createMockReq(),
        createMockCtx(null, { sessionStore: store })
      );
      expect(res.status).toBe(500);
      expect((res.body as any).success).toBe(false);
      expect((res.body as any).error.code).toBe("STORE_ERROR");
    });
  });

  describe("store interactions", () => {
    it("calls sessionStore.get exactly once", async () => {
      const store = createMockStore(makeSession());
      await handleGetSession(
        createMockReq(),
        createMockCtx(null, { sessionStore: store })
      );
      expect(store.get).toHaveBeenCalledTimes(1);
    });

    it("passes the request to sessionStore.get", async () => {
      const store = createMockStore(makeSession());
      const req = createMockReq();
      await handleGetSession(req, createMockCtx(null, { sessionStore: store }));
      expect(store.get).toHaveBeenCalledWith("current", req);
    });

    it("does not call sessionStore.set", async () => {
      const store = createMockStore(makeSession());
      await handleGetSession(
        createMockReq(),
        createMockCtx(null, { sessionStore: store })
      );
      expect(store.set).not.toHaveBeenCalled();
    });
  });
});
