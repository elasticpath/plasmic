/**
 * A-10.6: handleCalculateShipping tests
 *
 * Rates are sourced from a SERVER-side `ctx.shippingRateResolver` (#374 / #371)
 * — never an EP endpoint and never a client-supplied list — so the amounts are
 * trusted by `resolveShippingRate` and the /pay re-assertion.
 *
 * Covers: no session (410), missing shipping address (400), success (rates
 * resolved + stored + returned), empty rates, resolver-not-configured
 * (graceful empty), resolver failure (502), and store errors (500).
 */

import { handleCalculateShipping } from "../calculate-shipping";
import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
  SessionAddress,
  SessionShippingRate,
} from "../../../../checkout/session/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHIPPING_ADDRESS: SessionAddress = {
  firstName: "Jane",
  lastName: "Doe",
  line1: "123 Main St",
  line2: "Apt 4B",
  city: "Springfield",
  county: "IL",
  country: "US",
  postcode: "62701",
};

const RATES: SessionShippingRate[] = [
  {
    id: "rate-1",
    name: "Standard Shipping",
    description: "5-7 business days",
    amount: 599,
    currency: "USD",
    deliveryTime: "5-7 days",
    serviceLevel: "standard",
    carrier: "USPS",
  },
  {
    id: "rate-2",
    name: "Express Shipping",
    description: "2-3 business days",
    amount: 1299,
    currency: "USD",
    deliveryTime: "2-3 days",
    serviceLevel: "express",
    carrier: "FedEx",
  },
];

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-1",
    status: "open",
    cartId: "cart-abc",
    cartHash: "hash-abc",
    customerInfo: null,
    shippingAddress: SHIPPING_ADDRESS,
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
    shippingRateResolver: jest.fn().mockResolvedValue(RATES),
    ...overrides,
  };
}

function createMockReq(body: Record<string, unknown> = {}): SessionRequest {
  return { body, headers: {}, cookies: {} };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCalculateShipping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("no session", () => {
    it("returns 410 when no session exists", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(null)
      );
      expect(res.status).toBe(410);
      expect((res.body as any).success).toBe(false);
      expect((res.body as any).error.code).toBe("SESSION_GONE");
    });
  });

  describe("missing shipping address", () => {
    it("returns 400 when session has no shipping address", async () => {
      const session = makeSession({ shippingAddress: null });
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(session)
      );
      expect(res.status).toBe(400);
      expect((res.body as any).success).toBe(false);
      expect((res.body as any).error.code).toBe("MISSING_SHIPPING_ADDRESS");
    });
  });

  describe("success path", () => {
    it("returns 200 on success", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
    });

    it("returns the resolver's rates in the session", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const session = (res.body as any).data.session;
      expect(session.availableShippingRates).toEqual(RATES);
    });

    it("invokes the resolver with the current session", async () => {
      const resolver = jest.fn().mockResolvedValue(RATES);
      const session = makeSession({ cartId: "my-cart-123" });
      await handleCalculateShipping(
        createMockReq(),
        createMockCtx(session, { shippingRateResolver: resolver })
      );
      expect(resolver).toHaveBeenCalledTimes(1);
      const passed = resolver.mock.calls[0][0] as CheckoutSession;
      expect(passed.cartId).toBe("my-cart-123");
      expect(passed.shippingAddress).toEqual(SHIPPING_ADDRESS);
    });

    it("accepts a synchronous resolver", async () => {
      const resolver = jest.fn().mockReturnValue(RATES);
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession(), { shippingRateResolver: resolver })
      );
      expect(res.status).toBe(200);
      expect((res.body as any).data.session.availableShippingRates).toEqual(RATES);
    });

    it("stores the updated session with rates via sessionStore.set", async () => {
      const store = createMockStore(makeSession());
      await handleCalculateShipping(
        createMockReq(),
        createMockCtx(null, { sessionStore: store })
      );
      expect(store.set).toHaveBeenCalledTimes(1);
      const persisted: CheckoutSession = store.set.mock.calls[0][1];
      expect(persisted.availableShippingRates).toEqual(RATES);
    });

    it("response includes Set-Cookie header", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      expect(res.headers?.["Set-Cookie"]).toBeDefined();
    });

    it("client session does NOT expose cartHash", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const session = (res.body as any).data.session;
      expect(Object.prototype.hasOwnProperty.call(session, "cartHash")).toBe(false);
    });
  });

  describe("empty rates", () => {
    it("returns empty availableShippingRates when the resolver returns none", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession(), {
          shippingRateResolver: jest.fn().mockResolvedValue([]),
        })
      );
      expect(res.status).toBe(200);
      expect((res.body as any).data.session.availableShippingRates).toEqual([]);
    });

    it("coerces a non-array resolver result to an empty list", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession(), {
          shippingRateResolver: jest.fn().mockResolvedValue(undefined as any),
        })
      );
      expect(res.status).toBe(200);
      expect((res.body as any).data.session.availableShippingRates).toEqual([]);
    });
  });

  describe("resolver not configured", () => {
    it("returns 200 with empty rates when no resolver is wired", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession(), { shippingRateResolver: undefined })
      );
      expect(res.status).toBe(200);
      expect((res.body as any).data.session.availableShippingRates).toEqual([]);
    });
  });

  describe("resolver failure", () => {
    it("returns 502 when the resolver throws", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession(), {
          shippingRateResolver: jest.fn().mockRejectedValue(new Error("carrier timeout")),
        })
      );
      expect(res.status).toBe(502);
      expect((res.body as any).success).toBe(false);
      expect((res.body as any).error.code).toBe("SHIPPING_ERROR");
    });

    it("does NOT persist a session when the resolver throws", async () => {
      const store = createMockStore(makeSession());
      await handleCalculateShipping(
        createMockReq(),
        createMockCtx(null, {
          sessionStore: store,
          shippingRateResolver: jest.fn().mockRejectedValue(new Error("carrier timeout")),
        })
      );
      expect(store.set).not.toHaveBeenCalled();
    });
  });

  describe("store errors", () => {
    it("returns 500 when sessionStore.get throws", async () => {
      const store = createMockStore();
      store.get.mockRejectedValue(new Error("Decrypt error"));
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(null, { sessionStore: store })
      );
      expect(res.status).toBe(500);
      expect((res.body as any).error.code).toBe("STORE_ERROR");
    });

    it("returns 500 when sessionStore.set throws after resolving rates", async () => {
      const store = createMockStore(makeSession());
      store.set.mockRejectedValue(new Error("Encrypt error"));
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(null, { sessionStore: store })
      );
      expect(res.status).toBe(500);
      expect((res.body as any).error.code).toBe("STORE_ERROR");
    });
  });
});
