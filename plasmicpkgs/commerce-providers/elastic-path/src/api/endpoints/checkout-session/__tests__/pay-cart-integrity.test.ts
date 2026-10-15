/**
 * Checkout journeys through the real session handlers against an in-memory
 * Elastic Path store. Each browser keeps its session the way the cookie does:
 * a request sees the session as it was when the request was sent.
 */
const sdkImpl: Record<string, (...args: any[]) => any> = {};

jest.mock("@epcc-sdk/sdks-shopper", () => {
  const names = [
    "getACart",
    "manageCarts",
    "deleteACartItem",
    "updateACartItem",
    "updateACart",
    "deleteACart",
    "checkoutApi",
    "getAnOrder",
    "paymentSetup",
    "confirmOrder",
    "updateAnOrder",
    "deleteAllCartItems",
    "getByContextAllProducts",
  ];
  return {
    ...Object.fromEntries(
      names.map((name) => [
        name,
        (...args: unknown[]) => sdkImpl[name](...args),
      ])
    ),
    createShopperClient: jest.fn(
      require("../../../../checkout/session/__tests__/fake-shopper-client")
        .fakeShopperClient
    ),
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const { handleCreateSession } =
  require("../create-session") as typeof import("../create-session");
const { handleUpdateSession } =
  require("../update-session") as typeof import("../update-session");
const { handlePay } = require("../pay") as typeof import("../pay");
const { createAdapterRegistry } =
  require("../../../../checkout/session/adapter-registry") as typeof import("../../../../checkout/session/adapter-registry");
const { createManualAdapter } =
  require("../../../../checkout/session/adapters/manual-adapter") as typeof import("../../../../checkout/session/adapters/manual-adapter");
const { EP_SHIPPING_LINE_SKU } =
  require("../../../../checkout/session/set-shipping-line") as typeof import("../../../../checkout/session/set-shipping-line");
const { FakeEpStore } =
  require("../../../../checkout/session/__tests__/fake-ep-store") as typeof import("../../../../checkout/session/__tests__/fake-ep-store");
/* eslint-enable @typescript-eslint/no-var-requires */

import type {
  AdapterRegistry,
  CheckoutSession,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
  SessionShippingRate,
} from "../../../../checkout/session/types";

const RATE: SessionShippingRate = {
  id: "standard",
  name: "Standard",
  amount: 599,
  currency: "USD",
};
const ADDRESS = {
  firstName: "Walk",
  lastName: "Tester",
  line1: "1 Test St",
  city: "Boston",
  country: "US",
  postcode: "02110",
};

let ep: InstanceType<typeof FakeEpStore>;
let registry: AdapterRegistry;
let cartSeq = 0;

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class Browser {
  cookie: CheckoutSession | null = null;
  constructor(readonly cartId: string) {}

  private ctx(): SessionHandlerContext {
    const sent = clone(this.cookie);
    return {
      epCredentials: { clientId: "client", apiBaseUrl: "https://api.test.com" },
      adapterRegistry: registry,
      sessionStore: {
        get: async () => clone(sent),
        set: async (_id, session) => {
          this.cookie = clone(session);
          return { headers: { "Set-Cookie": "ep_cs=sealed; Path=/" } };
        },
        delete: async () => {
          this.cookie = null;
          return { headers: {} };
        },
      },
      shopperAccessToken: "shopper-token",
      sessionCartId: this.cartId,
      getClientCredentialsToken: async () => "admin-token",
      shippingRateResolver: () => [RATE],
    };
  }

  private req(body: Record<string, unknown>): SessionRequest {
    return { body, headers: {}, cookies: {} };
  }

  create(): Promise<SessionResponse> {
    return handleCreateSession(this.req({}), this.ctx());
  }

  update(body: Record<string, unknown>): Promise<SessionResponse> {
    return handleUpdateSession(this.req(body), this.ctx());
  }

  pay(
    body: Record<string, unknown>,
    pay = handlePay
  ): Promise<SessionResponse> {
    return pay(this.req(body), this.ctx());
  }

  shownTotal(): number | undefined {
    return this.cookie?.totals?.total;
  }
}

function newCart(
  lines = [
    {
      product_id: "p-plus",
      sku: "p-plus-sub",
      quantity: 1,
      unit_price: { amount: 2200 },
    },
  ]
): string {
  cartSeq += 1;
  const cartId = `cart-${cartSeq}`;
  ep.addCart(cartId, lines);
  return cartId;
}

async function readyToPay(browser: Browser): Promise<void> {
  expect((await browser.create()).status).toBe(201);
  await browser.update({
    customerInfo: { name: "Walk Tester", email: "walk@example.com" },
    billingAddress: ADDRESS,
    shippingAddress: ADDRESS,
  });
  const selected = await browser.update({ selectedShippingRateId: RATE.id });
  expect(selected.status).toBe(200);
}

function sessionIn(res: SessionResponse): any {
  return (res.body as any).data?.session;
}

beforeEach(() => {
  ep = new FakeEpStore();
  for (const key of Object.keys(sdkImpl)) {
    delete sdkImpl[key];
  }
  Object.assign(sdkImpl, ep.sdk());
  registry = createAdapterRegistry();
  registry.register("manual", createManualAdapter({ allow: () => true }));
  registry.register("stripe", {
    paymentSequence: "cart_payment_intent",
    initializePayment: async (s: CheckoutSession) => {
      const pi = await ep.chargeCart(s.cartId);
      return {
        status: "succeeded",
        gatewayOrderId: pi,
        gatewayMetadata: { paymentIntentId: pi },
      };
    },
  });
});

describe("a cart with nothing to buy", () => {
  it("is refused at pay when the shopper empties it after the session was created", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    const cart = ep.cart(browser.cartId);
    cart.lines = cart.lines.filter((l) => l.sku === EP_SHIPPING_LINE_SKU);

    const res = await browser.pay({ gateway: "manual" });

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("EMPTY_CART");
    expect(ep.orders).toEqual([]);
    expect(ep.charges).toEqual([]);
  });
});

describe("the total the shopper sees is the total pay charges", () => {
  it("refreshes the session total after a cart change, and the next pay charges that total", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    expect(browser.shownTotal()).toBe(2799);
    ep.cart(browser.cartId).lines[0].quantity = 2;

    const changed = await browser.pay({ gateway: "manual" });

    expect(changed.status).toBe(409);
    expect((changed.body as any).error.code).toBe("CART_MISMATCH");
    expect(sessionIn(changed).totals.total).toBe(4999);
    expect(browser.shownTotal()).toBe(4999);
    expect(ep.orders).toEqual([]);

    const paid = await browser.pay({ gateway: "manual" });

    expect(paid.status).toBe(200);
    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.paidOrders().map((o) => o.total)).toEqual([4999]);
  });

  it("refuses to charge a total the session never showed, and shows it instead", async () => {
    const browser = new Browser(newCart());
    expect((await browser.create()).status).toBe(201);
    await browser.update({
      customerInfo: { name: "Walk Tester", email: "walk@example.com" },
      billingAddress: ADDRESS,
      shippingAddress: ADDRESS,
    });
    const writeLine = sdkImpl.manageCarts;
    sdkImpl.manageCarts = async () => {
      sdkImpl.manageCarts = writeLine;
      throw new Error("Elastic Path unavailable");
    };
    await browser.update({ selectedShippingRateId: RATE.id });
    expect(browser.shownTotal()).toBe(2200);

    const first = await browser.pay({ gateway: "stripe" });

    expect(first.status).toBe(409);
    expect((first.body as any).error.code).toBe("TOTAL_CHANGED");
    expect(sessionIn(first).totals.total).toBe(2799);
    expect(ep.charges).toEqual([]);
    expect(ep.orders).toEqual([]);

    const second = await browser.pay({ gateway: "stripe" });

    expect(second.status).toBe(200);
    expect(ep.charges).toEqual([2799]);
    expect(ep.paidOrders().map((o) => o.total)).toEqual([2799]);
  });
});

describe("pay settles at most one order per checkout", () => {
  it.each(["manual", "stripe"])(
    "two simultaneous %s pays from one browser settle one order at the shown total",
    async (gateway) => {
      const browser = new Browser(newCart());
      await readyToPay(browser);

      const [a, b] = await Promise.all([
        browser.pay({ gateway }),
        browser.pay({ gateway }),
      ]);

      expect([a.status, b.status]).toEqual([200, 200]);
      expect(sessionIn(a).status).toBe("complete");
      expect(sessionIn(b).order.id).toBe(sessionIn(a).order.id);
      expect(ep.orders).toHaveLength(1);
      expect(ep.paidOrders().map((o) => o.total)).toEqual([2799]);
      expect(
        ep.orders[0].lines.filter((l) => l.sku === EP_SHIPPING_LINE_SKU)
      ).toEqual([{ sku: EP_SHIPPING_LINE_SKU, quantity: 1, amount: 599 }]);
      if (gateway === "stripe") {
        expect(ep.charges).toEqual([2799]);
      }
    }
  );

  it("refuses a second checkout session's pay for the same cart while one is settling", async () => {
    const cartId = newCart();
    const first = new Browser(cartId);
    const second = new Browser(cartId);
    await readyToPay(first);
    await readyToPay(second);

    const [a, b] = await Promise.all([
      first.pay({ gateway: "manual" }),
      second.pay({ gateway: "manual" }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(409);
    expect((b.body as any).error.code).toBe("CHECKOUT_IN_PROGRESS");
    expect(JSON.stringify(b.body)).not.toContain("walk@example.com");
    expect(ep.paidOrders()).toHaveLength(1);
  });

  it("refuses a session change while pay is settling, and charges the shown total", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const paying = browser.pay({ gateway: "manual" });
    const change = await browser.update({ selectedShippingRateId: RATE.id });
    const paid = await paying;

    expect(change.status).toBe(409);
    expect((change.body as any).error.code).toBe("CHECKOUT_IN_PROGRESS");
    expect(paid.status).toBe(200);
    expect(ep.paidOrders().map((o) => o.total)).toEqual([2799]);
  });

  it("refuses a pay sent with the pre-payment session after the order settled", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    const stale = clone(browser.cookie);
    expect((await browser.pay({ gateway: "manual" })).status).toBe(200);
    browser.cookie = stale;

    const again = await browser.pay({ gateway: "manual" });

    expect(again.status).not.toBe(200);
    expect(ep.orders).toHaveLength(1);
  });
});

describe("the shipping line", () => {
  it("stays one line at quantity 1 when two rate selections race", async () => {
    const browser = new Browser(newCart());
    expect((await browser.create()).status).toBe(201);
    await browser.update({
      customerInfo: { name: "Walk Tester", email: "walk@example.com" },
      billingAddress: ADDRESS,
      shippingAddress: ADDRESS,
    });

    await Promise.all([
      browser.update({ selectedShippingRateId: RATE.id }),
      browser.update({ selectedShippingRateId: RATE.id }),
    ]);

    const lines = ep.linesWithSku(browser.cartId, EP_SHIPPING_LINE_SKU);
    expect(lines.map((l) => l.quantity)).toEqual([1]);
    expect(ep.total(browser.cartId)).toBe(2799);
    expect(browser.shownTotal()).toBe(2799);
  });

  it("stays one line at quantity 1 when two server instances take the same pay", async () => {
    let otherInstance: typeof handlePay = handlePay;
    jest.isolateModules(() => {
      otherInstance = (require("../pay") as typeof import("../pay")).handlePay;
    });
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const results = await Promise.all([
      browser.pay({ gateway: "manual" }),
      browser.pay({ gateway: "manual" }, otherInstance),
    ]);

    expect(results.some((r) => r.status === 200)).toBe(true);
    for (const order of ep.orders) {
      expect(order.total).toBe(2799);
      expect(order.lines.filter((l) => l.sku === EP_SHIPPING_LINE_SKU)).toEqual(
        [{ sku: EP_SHIPPING_LINE_SKU, quantity: 1, amount: 599 }]
      );
    }
  });
});
