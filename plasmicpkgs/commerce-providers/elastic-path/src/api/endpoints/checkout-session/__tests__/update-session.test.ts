/**
 * A-10.5: handleUpdateSession tests
 *
 * Covers the merge semantics, 410 for missing sessions, 400 for non-open
 * sessions, and selective field merging (only provided fields are updated).
 *
 * Note: esbuild transform does not hoist jest.mock() above imports, so we
 * retrieve mock function references via jest.requireMock() inside tests.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: jest.fn(),
  checkoutApi: jest.fn(),
  paymentSetup: jest.fn(),
  confirmPayment: jest.fn(),
  manageCarts: jest.fn(),
  deleteACartItem: jest.fn(),
  createShopperClient: jest.fn(() => ({ client: {} })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  getACart: jest.Mock;
  manageCarts: jest.Mock;
  deleteACartItem: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleUpdateSession } = require("../update-session") as {
  handleUpdateSession: typeof import("../update-session").handleUpdateSession;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EP_SHIPPING_LINE_SKU } = require("../../../../checkout/session/set-shipping-line") as {
  EP_SHIPPING_LINE_SKU: string;
};
import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
  SessionAddress,
  SessionCustomerInfo,
  SessionShippingRate,
} from "../../../../checkout/session/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-1",
    status: "open",
    cartId: "cart-abc",
    cartHash: "hash-abc",
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

function createMockReq(body: Record<string, unknown> = {}): SessionRequest {
  return { body, headers: {}, cookies: {} };
}

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
// Tests
// ---------------------------------------------------------------------------

describe("handleUpdateSession", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("session not found", () => {
    it("returns 410 when no session exists", async () => {
      const res = await handleUpdateSession(
        createMockReq({ customerInfo: CUSTOMER_INFO }),
        createMockCtx(null)
      );
      expect(res.status).toBe(410);
      expect((res.body as any).error.code).toBe("SESSION_GONE");
    });

    it("response has success: false on 410", async () => {
      const res = await handleUpdateSession(
        createMockReq({}),
        createMockCtx(null)
      );
      expect((res.body as any).success).toBe(false);
    });
  });

  describe("session not open", () => {
    it("returns 400 when session status is 'processing'", async () => {
      const res = await handleUpdateSession(
        createMockReq({ customerInfo: CUSTOMER_INFO }),
        createMockCtx(makeSession({ status: "processing" }))
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("SESSION_NOT_OPEN");
    });

    it("returns 400 when session status is 'complete'", async () => {
      const res = await handleUpdateSession(
        createMockReq({ customerInfo: CUSTOMER_INFO }),
        createMockCtx(makeSession({ status: "complete" }))
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe("SESSION_NOT_OPEN");
    });

    it("returns 400 when session status is 'expired'", async () => {
      const res = await handleUpdateSession(
        createMockReq({}),
        createMockCtx(makeSession({ status: "expired" }))
      );
      expect(res.status).toBe(400);
    });
  });

  describe("success — field merging", () => {
    it("returns 200 on a valid update", async () => {
      const res = await handleUpdateSession(
        createMockReq({ customerInfo: CUSTOMER_INFO }),
        createMockCtx(makeSession())
      );
      expect(res.status).toBe(200);
    });

    it("merges customerInfo onto the session", async () => {
      const res = await handleUpdateSession(
        createMockReq({ customerInfo: CUSTOMER_INFO }),
        createMockCtx(makeSession())
      );
      const session = (res.body as any).data.session;
      expect(session.customerInfo).toEqual(CUSTOMER_INFO);
    });

    it("merges shippingAddress onto the session", async () => {
      const res = await handleUpdateSession(
        createMockReq({ shippingAddress: ADDRESS }),
        createMockCtx(makeSession())
      );
      expect((res.body as any).data.session.shippingAddress).toEqual(ADDRESS);
    });

    it("merges billingAddress onto the session", async () => {
      const res = await handleUpdateSession(
        createMockReq({ billingAddress: ADDRESS }),
        createMockCtx(makeSession())
      );
      expect((res.body as any).data.session.billingAddress).toEqual(ADDRESS);
    });

    it("merges selectedShippingRateId onto the session", async () => {
      const res = await handleUpdateSession(
        createMockReq({ selectedShippingRateId: "rate-xyz" }),
        createMockCtx(makeSession())
      );
      expect((res.body as any).data.session.selectedShippingRateId).toBe("rate-xyz");
    });

    it("preserves existing fields not present in the update", async () => {
      const existingInfo = CUSTOMER_INFO;
      const session = makeSession({ customerInfo: existingInfo });

      const res = await handleUpdateSession(
        createMockReq({ selectedShippingRateId: "rate-xyz" }),
        createMockCtx(session)
      );

      const updated = (res.body as any).data.session;
      expect(updated.customerInfo).toEqual(existingInfo);
      expect(updated.selectedShippingRateId).toBe("rate-xyz");
    });

    it("merges multiple fields at once", async () => {
      const res = await handleUpdateSession(
        createMockReq({
          customerInfo: CUSTOMER_INFO,
          shippingAddress: ADDRESS,
          billingAddress: ADDRESS,
        }),
        createMockCtx(makeSession())
      );
      const session = (res.body as any).data.session;
      expect(session.customerInfo).toEqual(CUSTOMER_INFO);
      expect(session.shippingAddress).toEqual(ADDRESS);
      expect(session.billingAddress).toEqual(ADDRESS);
    });

    it("client session does NOT expose cartHash", async () => {
      const res = await handleUpdateSession(
        createMockReq({ customerInfo: CUSTOMER_INFO }),
        createMockCtx(makeSession())
      );
      const session = (res.body as any).data.session;
      expect(Object.prototype.hasOwnProperty.call(session, "cartHash")).toBe(false);
    });

    it("response includes Set-Cookie header", async () => {
      const res = await handleUpdateSession(
        createMockReq({ customerInfo: CUSTOMER_INFO }),
        createMockCtx(makeSession())
      );
      expect(res.headers?.["Set-Cookie"]).toBeDefined();
    });

    it("calls sessionStore.set once with the merged session", async () => {
      const store = createMockStore(makeSession());
      await handleUpdateSession(
        createMockReq({ selectedShippingRateId: "rate-1" }),
        createMockCtx(null, { sessionStore: store })
      );
      expect(store.set).toHaveBeenCalledTimes(1);
      const persisted: CheckoutSession = store.set.mock.calls[0][1];
      expect(persisted.selectedShippingRateId).toBe("rate-1");
    });

    it("does not update a field when it is not present in the request body", async () => {
      const session = makeSession({ selectedShippingRateId: "rate-existing" });
      const res = await handleUpdateSession(
        createMockReq({ customerInfo: CUSTOMER_INFO }),
        createMockCtx(session)
      );
      // selectedShippingRateId should remain unchanged
      expect((res.body as any).data.session.selectedShippingRateId).toBe(
        "rate-existing"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Shipping selection → credentialed cart write (slice #3a).
//   Picking a rate id writes the SERVER-resolved cost into the cart so it shows
//   before pay. Best-effort: never the integrity boundary (pay re-asserts), so
//   it must not turn a valid update into a 4xx/5xx.
// ---------------------------------------------------------------------------

const RATES: SessionShippingRate[] = [
  { id: "rate-standard", name: "Standard", amount: 500, currency: "CHF", serviceLevel: "standard" },
  { id: "rate-express", name: "Express", amount: 1500, currency: "CHF", serviceLevel: "express" },
];

function cartFetch(items: Array<Record<string, unknown>> = []) {
  return {
    data: {
      data: { id: "cart-abc", type: "cart", meta: { display_price: { with_tax: { amount: 8000, currency: "CHF" } } } },
      included: { items },
    },
  };
}

describe("handleUpdateSession — shipping selection write", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    epSdk.getACart.mockResolvedValue(cartFetch([]));
    epSdk.manageCarts.mockResolvedValue({});
    epSdk.deleteACartItem.mockResolvedValue({});
  });

  function ctxWithAdmin(session: CheckoutSession) {
    return createMockCtx(session, {
      getClientCredentialsToken: jest.fn(async () => "ADMIN-TOKEN"),
    });
  }

  it("writes the resolved shipping line when a rate is selected and rates exist", async () => {
    const res = await handleUpdateSession(
      createMockReq({ selectedShippingRateId: "rate-express" }),
      ctxWithAdmin(makeSession({ availableShippingRates: RATES }))
    );

    expect(res.status).toBe(200);
    expect(epSdk.manageCarts).toHaveBeenCalledTimes(1);
    const body = epSdk.manageCarts.mock.calls[0][0].body.data;
    expect(body.sku).toBe(EP_SHIPPING_LINE_SKU);
    expect(body.price.amount).toBe(1500); // server amount for the selected id
  });

  it("does NOT write when no rates have been computed yet (selection before calculate-shipping)", async () => {
    const res = await handleUpdateSession(
      createMockReq({ selectedShippingRateId: "rate-express" }),
      ctxWithAdmin(makeSession({ availableShippingRates: [] }))
    );
    expect(res.status).toBe(200);
    expect(epSdk.manageCarts).not.toHaveBeenCalled();
  });

  it("does NOT write when the update carries no shipping selection", async () => {
    const res = await handleUpdateSession(
      createMockReq({ customerInfo: CUSTOMER_INFO }),
      ctxWithAdmin(makeSession({ availableShippingRates: RATES }))
    );
    expect(res.status).toBe(200);
    expect(epSdk.manageCarts).not.toHaveBeenCalled();
  });

  it("still returns 200 (best-effort) when the selected id is forged / un-offered — no line written", async () => {
    const res = await handleUpdateSession(
      createMockReq({ selectedShippingRateId: "rate-hacked" }),
      ctxWithAdmin(makeSession({ availableShippingRates: RATES }))
    );
    // The selection is still stored; the write simply can't resolve a price.
    expect(res.status).toBe(200);
    expect((res.body as any).data.session.selectedShippingRateId).toBe("rate-hacked");
    expect(epSdk.manageCarts).not.toHaveBeenCalled();
  });

  it("still returns 200 (best-effort) when the EP cart write fails — deferred to /pay", async () => {
    epSdk.manageCarts.mockRejectedValue(new Error("EP cart write rejected"));
    const res = await handleUpdateSession(
      createMockReq({ selectedShippingRateId: "rate-standard" }),
      ctxWithAdmin(makeSession({ availableShippingRates: RATES }))
    );
    expect(res.status).toBe(200);
    expect((res.body as any).data.session.selectedShippingRateId).toBe("rate-standard");
  });
});
