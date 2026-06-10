/**
 * A-10.6: handleCalculateShipping tests
 *
 * Covers: success path (shipping rates returned and stored), no session (410),
 * missing shipping address (400), EP API failure (502), store error (500),
 * rate normalization, and client session shape (cartHash stripped).
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
  getShippingOptions: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleCalculateShipping } = require("../calculate-shipping") as {
  handleCalculateShipping: typeof import("../calculate-shipping").handleCalculateShipping;
};

import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
  SessionAddress,
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
    ...overrides,
  };
}

function createMockReq(body: Record<string, unknown> = {}): SessionRequest {
  return { body, headers: {}, cookies: {} };
}

function makeShippingResponse(options: unknown[] = []) {
  return {
    data: { data: options },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCalculateShipping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    epSdk.getShippingOptions.mockReset();
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
    const SHIPPING_OPTIONS = [
      {
        id: "rate-1",
        name: "Standard Shipping",
        description: "5-7 business days",
        price: { amount: 599, currency: "USD" },
        delivery_time: "5-7 days",
        service_level: "standard",
        carrier: "USPS",
      },
      {
        id: "rate-2",
        name: "Express Shipping",
        description: "2-3 business days",
        price: { amount: 1299, currency: "USD" },
        delivery_time: "2-3 days",
        service_level: "express",
        carrier: "FedEx",
      },
    ];

    beforeEach(() => {
      epSdk.getShippingOptions.mockResolvedValue(
        makeShippingResponse(SHIPPING_OPTIONS) as any
      );
    });

    it("returns 200 on success", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
    });

    it("returns normalized shipping rates in the session", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const session = (res.body as any).data.session;
      expect(session.availableShippingRates).toHaveLength(2);
    });

    it("normalizes rate fields correctly", async () => {
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const rates = (res.body as any).data.session.availableShippingRates;
      expect(rates[0]).toEqual({
        id: "rate-1",
        name: "Standard Shipping",
        description: "5-7 business days",
        amount: 599,
        currency: "USD",
        deliveryTime: "5-7 days",
        serviceLevel: "standard",
        carrier: "USPS",
      });
    });

    it("stores updated session with rates via sessionStore.set", async () => {
      const store = createMockStore(makeSession());
      await handleCalculateShipping(
        createMockReq(),
        createMockCtx(null, { sessionStore: store })
      );
      expect(store.set).toHaveBeenCalledTimes(1);
      const persisted: CheckoutSession = store.set.mock.calls[0][1];
      expect(persisted.availableShippingRates).toHaveLength(2);
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

    it("passes EP client with correct credentials", async () => {
      await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      expect(epSdk.getShippingOptions).toHaveBeenCalledTimes(1);
      const callArgs = epSdk.getShippingOptions.mock.calls[0][0];
      expect(callArgs.client.settings.application_id).toBe("test-id");
      expect(callArgs.client.settings.host).toBe("https://api.test.com");
    });

    it("passes the session cartId as path parameter", async () => {
      await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession({ cartId: "my-cart-123" }))
      );
      const callArgs = epSdk.getShippingOptions.mock.calls[0][0];
      expect(callArgs.path.cartID).toBe("my-cart-123");
    });

    it("converts session address to EP address format", async () => {
      await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const callArgs = epSdk.getShippingOptions.mock.calls[0][0];
      const addr = callArgs.body.data.shipping_address;
      expect(addr.first_name).toBe("Jane");
      expect(addr.last_name).toBe("Doe");
      expect(addr.line_1).toBe("123 Main St");
      expect(addr.city).toBe("Springfield");
      expect(addr.country).toBe("US");
      expect(addr.postcode).toBe("62701");
    });
  });

  describe("empty shipping options", () => {
    it("returns empty availableShippingRates when EP returns no options", async () => {
      epSdk.getShippingOptions.mockResolvedValue(
        makeShippingResponse([]) as any
      );
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      expect((res.body as any).data.session.availableShippingRates).toEqual([]);
    });

    it("handles missing data array from EP gracefully", async () => {
      epSdk.getShippingOptions.mockResolvedValue({ data: {} } as any);
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      expect(res.status).toBe(200);
      expect((res.body as any).data.session.availableShippingRates).toEqual([]);
    });
  });

  describe("rate field defaults", () => {
    it("uses description as name fallback", async () => {
      epSdk.getShippingOptions.mockResolvedValue(
        makeShippingResponse([
          { id: "r1", description: "Ground", price: { amount: 500, currency: "USD" } },
        ]) as any
      );
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const rate = (res.body as any).data.session.availableShippingRates[0];
      expect(rate.name).toBe("Ground");
    });

    it("defaults name to 'Shipping' when both name and description are absent", async () => {
      epSdk.getShippingOptions.mockResolvedValue(
        makeShippingResponse([
          { id: "r1", price: { amount: 0, currency: "USD" } },
        ]) as any
      );
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const rate = (res.body as any).data.session.availableShippingRates[0];
      expect(rate.name).toBe("Shipping");
    });

    it("defaults amount to 0 when price is missing", async () => {
      epSdk.getShippingOptions.mockResolvedValue(
        makeShippingResponse([{ id: "r1", name: "Free" }]) as any
      );
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const rate = (res.body as any).data.session.availableShippingRates[0];
      expect(rate.amount).toBe(0);
    });

    it("defaults currency to USD when price.currency is missing", async () => {
      epSdk.getShippingOptions.mockResolvedValue(
        makeShippingResponse([{ id: "r1", name: "Basic", price: { amount: 100 } }]) as any
      );
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const rate = (res.body as any).data.session.availableShippingRates[0];
      expect(rate.currency).toBe("USD");
    });

    it("defaults serviceLevel to 'standard'", async () => {
      epSdk.getShippingOptions.mockResolvedValue(
        makeShippingResponse([{ id: "r1", name: "Basic" }]) as any
      );
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      const rate = (res.body as any).data.session.availableShippingRates[0];
      expect(rate.serviceLevel).toBe("standard");
    });
  });

  describe("EP API failure", () => {
    it("returns 502 when getShippingOptions throws", async () => {
      epSdk.getShippingOptions.mockRejectedValue(new Error("EP timeout"));
      const res = await handleCalculateShipping(
        createMockReq(),
        createMockCtx(makeSession())
      );
      expect(res.status).toBe(502);
      expect((res.body as any).success).toBe(false);
      expect((res.body as any).error.code).toBe("EP_ERROR");
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

    it("returns 500 when sessionStore.set throws after successful EP call", async () => {
      epSdk.getShippingOptions.mockResolvedValue(
        makeShippingResponse([{ id: "r1", name: "Standard" }]) as any
      );
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
