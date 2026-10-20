/**
 * A-10.3: handleCreateSession tests
 *
 * Covers the success path (201 with session), the session cart (409 without one),
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
  createShopperClient: jest.fn(
    require("../../../../checkout/session/__tests__/fake-shopper-client")
      .fakeShopperClient
  ),
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EP_SHIPPING_LINE_SKU } = require("../../../../checkout/session/set-shipping-line") as typeof import("../../../../checkout/session/set-shipping-line");

import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
} from "../../../../checkout/session/types";
import { hashCart } from "../../../../checkout/session/cart-hash";
import { EP_ACCOUNT_TOKEN_HEADER } from "../../../../auth/ep-plugin/envelope";
import { headersSentBy } from "../../../../checkout/session/__tests__/fake-shopper-client";

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
      apiBaseUrl: "https://api.test.com",
    },
    adapterRegistry: {
      register: jest.fn(),
      getAdapter: jest.fn().mockReturnValue(undefined),
    },
    sessionStore: createMockStore(),
    sessionCartId: "cart-abc",
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

  describe("the cart comes from the shopper's session", () => {
    beforeEach(() => {
      epSdk.getACart.mockResolvedValue(
        makeCartResponse([{ id: "item-1", quantity: 1, unit_price: { amount: 1500 } }]) as any
      );
    });

    it("checks out the session cart, not a cart id the browser sends", async () => {
      const store = createMockStore();
      const res = await handleCreateSession(
        createMockReq({ cartId: "someone-elses-cart" }),
        createMockCtx({ sessionCartId: "session-cart", sessionStore: store })
      );

      expect(res.status).toBe(201);
      expect(epSdk.getACart).toHaveBeenCalledTimes(1);
      expect(epSdk.getACart.mock.calls[0][0].path).toEqual({
        cartID: "session-cart",
      });
      const stored: CheckoutSession = store.set.mock.calls[0][1];
      expect(stored.cartId).toBe("session-cart");
    });

    it("refuses when the shopper has no session cart, whatever the browser sends", async () => {
      const store = createMockStore();
      const res = await handleCreateSession(
        createMockReq({ cartId: "someone-elses-cart" }),
        createMockCtx({ sessionCartId: undefined, sessionStore: store })
      );

      expect(res.status).toBe(409);
      expect((res.body as any).error.code).toBe("NO_CART");
      expect(epSdk.getACart).not.toHaveBeenCalled();
      expect(store.set).not.toHaveBeenCalled();
    });
  });

  describe("EP cart fetch failure", () => {
    it("returns 502 when getACart throws", async () => {
      epSdk.getACart.mockRejectedValue(new Error("Network error"));

      const res = await handleCreateSession(
        createMockReq(),
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
        createMockReq(),
        createMockCtx()
      );
      expect(res.status).toBe(201);
    });

    it("response body has success: true", async () => {
      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx()
      );
      expect((res.body as any).success).toBe(true);
    });

    it("response body contains a session object", async () => {
      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx()
      );
      const session = (res.body as any).data.session;
      expect(session).toBeDefined();
    });

    it("session has status 'open'", async () => {
      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx()
      );
      expect((res.body as any).data.session.status).toBe("open");
    });

    it("keeps the cart id out of the response", async () => {
      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx()
      );
      expect(JSON.stringify(res.body)).not.toContain("cart-abc");
    });

    it("client session does NOT expose cartHash", async () => {
      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx()
      );
      const session = (res.body as any).data.session;
      expect(Object.prototype.hasOwnProperty.call(session, "cartHash")).toBe(false);
    });

    it("session has a string id", async () => {
      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx()
      );
      expect(typeof (res.body as any).data.session.id).toBe("string");
      expect((res.body as any).data.session.id.length).toBeGreaterThan(0);
    });

    it("session has payment.status 'idle'", async () => {
      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx()
      );
      expect((res.body as any).data.session.payment.status).toBe("idle");
    });

    it("response includes Set-Cookie header", async () => {
      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx()
      );
      expect(res.headers?.["Set-Cookie"]).toBeDefined();
    });

    it("calls sessionStore.set once", async () => {
      const store = createMockStore();
      await handleCreateSession(
        createMockReq(),
        createMockCtx({ sessionStore: store })
      );
      expect(store.set).toHaveBeenCalledTimes(1);
    });

    it("stores the session with cartHash computed from items", async () => {
      const store = createMockStore();
      await handleCreateSession(
        createMockReq(),
        createMockCtx({ sessionStore: store })
      );
      const storedSession: CheckoutSession = store.set.mock.calls[0][1];
      expect(typeof storedSession.cartHash).toBe("string");
      expect(storedSession.cartHash.length).toBe(64); // SHA-256 hex
    });

    it("requests include: ['items'] so EP returns cart lines", async () => {
      await handleCreateSession(
        createMockReq(),
        createMockCtx()
      );
      expect(epSdk.getACart).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { cartID: "cart-abc" },
          query: { include: ["items"] },
        })
      );
    });

    it("excludes the managed shipping line from the cart hash", async () => {
      const shopperItems = [
        {
          id: "item-1",
          type: "cart_item",
          sku: "sandle",
          product_id: "prod-sandle",
          quantity: 1,
          unit_price: { amount: 1400 },
        },
      ];
      epSdk.getACart.mockResolvedValue(
        makeCartResponse([
          ...shopperItems,
          {
            id: "ship-1",
            type: "custom_item",
            sku: EP_SHIPPING_LINE_SKU,
            quantity: 1,
            unit_price: { amount: 599 },
          },
        ]) as any
      );
      const store = createMockStore();
      await handleCreateSession(
        createMockReq(),
        createMockCtx({ sessionStore: store })
      );
      const storedSession: CheckoutSession = store.set.mock.calls[0][1];
      expect(storedSession.cartHash).toBe(hashCart(shopperItems));
      expect(storedSession.cartHash).not.toBe(
        hashCart([
          ...shopperItems,
          {
            id: "ship-1",
            quantity: 1,
            unit_price: { amount: 599 },
          },
        ])
      );
    });
  });

  describe("a cart with nothing to buy", () => {
    it.each([
      ["no lines", []],
      [
        "only the shipping line",
        [{ id: "ship-1", type: "custom_item", sku: EP_SHIPPING_LINE_SKU, quantity: 1, unit_price: { amount: 599 } }],
      ],
      [
        "only a promotion line",
        [{ id: "promo-1", type: "promotion_item", sku: "TEST1", quantity: 1, unit_price: { amount: -500 } }],
      ],
    ])("refuses a cart with %s and stores no session", async (_label, items) => {
      epSdk.getACart.mockResolvedValue(makeCartResponse(items) as any);
      const store = createMockStore();

      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx({ sessionCartId: "empty-cart", sessionStore: store })
      );

      expect(res.status).toBe(409);
      expect((res.body as any).error.code).toBe("EMPTY_CART");
      expect(store.set).not.toHaveBeenCalled();
    });
  });

  describe("the shopper's locale and currency", () => {
    function pricedIn(currency: string, amount: number) {
      return {
        data: {
          data: {
            id: "cart-abc",
            type: "cart",
            meta: {
              display_price: {
                with_tax: { amount, currency },
                without_tax: { amount, currency },
                tax: { amount: 0, currency },
              },
            },
          },
          included: {
            items: [{ id: "item-1", quantity: 1, unit_price: { amount } }],
          },
        },
      };
    }

    beforeEach(() => {
      epSdk.getACart.mockImplementation(async ({ headers }) =>
        headers?.["X-Moltin-Currency"] === "EUR"
          ? pricedIn("EUR", 900)
          : pricedIn("USD", 1000)
      );
    });

    it("totals the checkout in the currency the cart shows", async () => {
      const res = await handleCreateSession(
        createMockReq(),
        createMockCtx({ locale: "fr-FR", currency: "EUR" })
      );

      expect((res.body as any).data.session.totals).toEqual({
        subtotal: 900,
        tax: 0,
        shipping: 0,
        total: 900,
        currency: "EUR",
      });
      expect(epSdk.getACart.mock.calls[0][0].headers).toEqual({
        "Accept-Language": "fr-FR",
        "X-Moltin-Currency": "EUR",
      });
    });
  });

  describe("selected account", () => {
    beforeEach(() => {
      epSdk.getACart.mockResolvedValue(makeCartResponse([]) as any);
    });

    it("reads the cart with the selected account's credential", async () => {
      await handleCreateSession(
        createMockReq(),
        createMockCtx({
          shopperAccessToken: "shopper-token",
          accountToken: "account-token",
          accountId: "account-1",
        })
      );

      const { client } = epSdk.getACart.mock.calls[0][0];
      expect(client.token).toBe("shopper-token");
      expect((await headersSentBy(client)).get(EP_ACCOUNT_TOKEN_HEADER)).toBe(
        "account-token"
      );
    });

    it("reads the cart with no account credential when none is selected", async () => {
      await handleCreateSession(
        createMockReq(),
        createMockCtx({ shopperAccessToken: "shopper-token" })
      );

      const { client } = epSdk.getACart.mock.calls[0][0];
      expect((await headersSentBy(client)).has(EP_ACCOUNT_TOKEN_HEADER)).toBe(
        false
      );
    });

    it("sends no account credential on the client_credentials fallback read", async () => {
      await handleCreateSession(
        createMockReq(),
        createMockCtx({
          accountToken: "account-token",
          accountId: "account-1",
          getClientCredentialsToken: jest.fn(async () => "admin-token"),
        })
      );

      const { client } = epSdk.getACart.mock.calls[0][0];
      expect(client.token).toBe("admin-token");
      expect((await headersSentBy(client)).has(EP_ACCOUNT_TOKEN_HEADER)).toBe(
        false
      );
    });
  });
});
