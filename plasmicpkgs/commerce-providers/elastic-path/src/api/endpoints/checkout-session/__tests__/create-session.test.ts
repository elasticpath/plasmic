/**
 * A-10.3: handleCreateSession tests
 *
 * Covers the success path (201 with session), missing-cartId validation (400),
 * EP cart fetch failure (502), and session shape invariants (cartHash present
 * internally, stripped from client response).
 *
 * Note: esbuild does not hoist jest.mock(). We use jest.spyOn on the
 * required module object so interception works regardless of import order.
 */

// Register the mock factory BEFORE the module under test is imported.
// esbuild CJS transform means jest.mock() runs at call-site order, but the
// factory is still registered in the module registry so require() picks it up.
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: jest.fn(),
  checkoutApi: jest.fn(),
  paymentSetup: jest.fn(),
  confirmPayment: jest.fn(),
  getShippingOptions: jest.fn(),
}));

// We must use require() here (not ES import) to obtain the mocked module
// object that was already injected by the jest.mock() call above.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  getACart: jest.Mock;
  checkoutApi: jest.Mock;
  paymentSetup: jest.Mock;
  confirmPayment: jest.Mock;
};

// Import the handler AFTER the mock is established
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleCreateSession } = require("../create-session") as {
  handleCreateSession: typeof import("../create-session").handleCreateSession;
};

import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
} from "../../../../checkout/session/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStore(session: CheckoutSession | null = null) {
  return {
    get: jest.fn().mockResolvedValue(session),
    set: jest.fn().mockResolvedValue({ headers: { "Set-Cookie": "ep_cs=test; Path=/" } }),
    delete: jest.fn().mockResolvedValue({ headers: { "Set-Cookie": "ep_cs=; Max-Age=0" } }),
  };
}

function createMockCtx(
  overrides: Partial<SessionHandlerContext> = {}
): SessionHandlerContext {
  return {
    epCredentials: {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      apiBaseUrl: "https://api.test.com",
    },
    adapterRegistry: {
      register: jest.fn(),
      getAdapter: jest.fn().mockReturnValue(undefined),
    },
    sessionStore: createMockStore(),
    ...overrides,
  };
}

function createMockReq(body: Record<string, unknown> = {}): SessionRequest {
  return { body, headers: {}, cookies: {} };
}

function makeCartResponse(items: unknown[] = []) {
  return {
    data: {
      data: { id: "cart-abc", type: "cart" },
      included: { items },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCreateSession", () => {
  beforeEach(() => {
    epSdk.getACart.mockReset();
    epSdk.checkoutApi.mockReset();
    epSdk.paymentSetup.mockReset();
    epSdk.confirmPayment.mockReset();
  });

  describe("input validation", () => {
    it("returns 400 when cartId is missing from body", async () => {
      const res = await handleCreateSession(createMockReq({}), createMockCtx());
      expect(res.status).toBe(400);
      expect((res.body as any).success).toBe(false);
      expect((res.body as any).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when cartId is not a string", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: 42 }),
        createMockCtx()
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when cartId is an empty string", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "" }),
        createMockCtx()
      );
      expect(res.status).toBe(400);
    });
  });

  describe("EP cart fetch failure", () => {
    it("returns 502 when getACart throws", async () => {
      epSdk.getACart.mockRejectedValue(new Error("Network error"));

      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );

      expect(res.status).toBe(502);
      expect((res.body as any).success).toBe(false);
      expect((res.body as any).error.code).toBe("EP_ERROR");
    });
  });

  describe("success path", () => {
    const CART_ITEMS = [
      { id: "item-1", quantity: 2, unit_price: { amount: 1500 } },
      { id: "item-2", quantity: 1, unit_price: { amount: 2400 } },
    ];

    beforeEach(() => {
      epSdk.getACart.mockResolvedValue(makeCartResponse(CART_ITEMS) as any);
    });

    it("returns 201 on success", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );
      expect(res.status).toBe(201);
    });

    it("response body has success: true", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );
      expect((res.body as any).success).toBe(true);
    });

    it("response body contains a session object", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );
      const session = (res.body as any).data.session;
      expect(session).toBeDefined();
    });

    it("session has status 'open'", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );
      expect((res.body as any).data.session.status).toBe("open");
    });

    it("session has the correct cartId", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );
      expect((res.body as any).data.session.cartId).toBe("cart-abc");
    });

    it("client session does NOT expose cartHash", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );
      const session = (res.body as any).data.session;
      expect(Object.prototype.hasOwnProperty.call(session, "cartHash")).toBe(false);
    });

    it("session has a string id", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );
      expect(typeof (res.body as any).data.session.id).toBe("string");
      expect((res.body as any).data.session.id.length).toBeGreaterThan(0);
    });

    it("session has payment.status 'idle'", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );
      expect((res.body as any).data.session.payment.status).toBe("idle");
    });

    it("response includes Set-Cookie header", async () => {
      const res = await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx()
      );
      expect(res.headers?.["Set-Cookie"]).toBeDefined();
    });

    it("calls sessionStore.set once", async () => {
      const store = createMockStore();
      await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx({ sessionStore: store })
      );
      expect(store.set).toHaveBeenCalledTimes(1);
    });

    it("stores the session with cartHash computed from items", async () => {
      const store = createMockStore();
      await handleCreateSession(
        createMockReq({ cartId: "cart-abc" }),
        createMockCtx({ sessionStore: store })
      );
      const storedSession: CheckoutSession = store.set.mock.calls[0][1];
      expect(typeof storedSession.cartHash).toBe("string");
      expect(storedSession.cartHash.length).toBe(64); // SHA-256 hex
    });
  });

  describe("empty cart", () => {
    it("creates session with a consistent hash for an empty cart", async () => {
      epSdk.getACart.mockResolvedValue(makeCartResponse([]) as any);
      const store = createMockStore();

      await handleCreateSession(
        createMockReq({ cartId: "empty-cart" }),
        createMockCtx({ sessionStore: store })
      );

      const storedSession: CheckoutSession = store.set.mock.calls[0][1];
      expect(typeof storedSession.cartHash).toBe("string");
    });
  });
});
