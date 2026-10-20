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
    "getOrderItems",
    "getOrderTransactions",
    "cancelATransaction",
    "getCartItems",
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
const { handleGetSession } =
  require("../get-session") as typeof import("../get-session");
const { handlePay } = require("../pay") as typeof import("../pay");
const { handleResumePayment } =
  require("../resume-payment") as typeof import("../resume-payment");
const { handleAbandonPayment } =
  require("../abandon-payment") as typeof import("../abandon-payment");
const { createAdapterRegistry } =
  require("../../../../checkout/session/adapter-registry") as typeof import("../../../../checkout/session/adapter-registry");
const { createManualAdapter } =
  require("../../../../checkout/session/adapters/manual-adapter") as typeof import("../../../../checkout/session/adapters/manual-adapter");
const { EP_SHIPPING_LINE_SKU } =
  require("../../../../checkout/session/set-shipping-line") as typeof import("../../../../checkout/session/set-shipping-line");
const { FakeEpStore } =
  require("../../../../checkout/session/__tests__/fake-ep-store") as typeof import("../../../../checkout/session/__tests__/fake-ep-store");
const { checkoutContextFromSession } =
  require("../../../../checkout/session/checkout-account") as typeof import("../../../../checkout/session/checkout-account");
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
  /** The shopper's identity on the next request (selected account, member). */
  identity: Partial<SessionHandlerContext> = {};
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
      ...this.identity,
    };
  }

  private req(body: Record<string, unknown>): SessionRequest {
    return { body, headers: {}, cookies: {} };
  }

  create(): Promise<SessionResponse> {
    return handleCreateSession(this.req({}), this.ctx());
  }

  get(): Promise<SessionResponse> {
    return handleGetSession(this.req({}), this.ctx());
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

  resume(): Promise<SessionResponse> {
    return handleResumePayment(this.req({}), this.ctx());
  }

  abandon(): Promise<SessionResponse> {
    return handleAbandonPayment(this.req({}), this.ctx());
  }

  pendingPaymentIntent(): string {
    return this.cookie!.payment.gatewayMetadata!.paymentIntentId as string;
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

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  ep = new FakeEpStore();
  global.fetch = ep.fetch as typeof fetch;
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
        gatewayMetadata: { paymentIntentId: pi, amount: ep.paymentIntents.get(pi)!.amount },
      };
    },
  });
  // A cart write from outside the storefront lands after the charge and
  // before the order is created.
  registry.register("stripeLateWrite", {
    paymentSequence: "cart_payment_intent",
    initializePayment: async (s: CheckoutSession) => {
      const pi = await ep.chargeCart(s.cartId);
      ep.cart(s.cartId).lines.push({
        id: "line-late",
        type: "custom_item",
        sku: "late-write",
        quantity: 1,
        unit_price: { amount: 100 },
        value: { amount: 100 },
      });
      return {
        status: "succeeded",
        gatewayOrderId: pi,
        gatewayMetadata: { paymentIntentId: pi, amount: ep.paymentIntents.get(pi)!.amount },
      };
    },
  });
  const challengeAdapter = {
    paymentSequence: "cart_payment_intent" as const,
    initializePayment: async (s: CheckoutSession) => {
      try {
        const pi = await ep.startChallenge(s.cartId);
        return {
          status: "requires_action" as const,
          clientToken: `${pi.id}_secret`,
          gatewayMetadata: { paymentIntentId: pi.id },
          actionData: { type: "stripe_3ds", paymentIntentId: pi.id },
        };
      } catch (err) {
        return { status: "failed" as const, errorMessage: (err as Error).message };
      }
    },
  };
  registry.register("stripe3ds", {
    ...challengeAdapter,
    readPaymentIntentState: async (s: CheckoutSession) => {
      const pi = ep.paymentIntents.get(
        s.payment.gatewayMetadata?.paymentIntentId as string
      );
      if (!pi) return "unreadable";
      if (pi.status === "succeeded") return "settled";
      if (pi.status === "requires_action") return "awaiting_action";
      return "failed";
    },
  });
  registry.register("stripe3dsUnverified", challengeAdapter);
  registry.register("stripe3dsBlind", {
    ...challengeAdapter,
    readPaymentIntentState: async () => "unreadable",
  });
});

function heldOrder() {
  return ep.orders[ep.orders.length - 1];
}

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

  it("charges nothing for a rate whose price did not reach the cart, and charges the total shown once it is chosen", async () => {
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
    expect(browser.cookie?.selectedShippingRateId).toBeNull();

    const first = await browser.pay({ gateway: "stripe", shownTotal: 2200 });

    expect(first.status).toBe(400);
    expect((first.body as any).error.code).toBe("MISSING_FIELDS");
    expect(ep.charges).toEqual([]);
    expect(ep.orders).toEqual([]);

    await browser.update({ selectedShippingRateId: RATE.id });
    const second = await browser.pay({ gateway: "stripe", shownTotal: browser.shownTotal() });

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
  it("shows one shipping charge and leaves no line in the cart when two rate selections race", async () => {
    const browser = new Browser(newCart());
    expect((await browser.create()).status).toBe(201);
    await browser.update({
      customerInfo: { name: "Walk Tester", email: "walk@example.com" },
      billingAddress: ADDRESS,
      shippingAddress: ADDRESS,
    });

    const results = await Promise.all([
      browser.update({ selectedShippingRateId: RATE.id }),
      browser.update({ selectedShippingRateId: RATE.id }),
    ]);

    expect(results.map((r) => sessionIn(r).totals.total)).toEqual([2799, 2799]);
    expect(ep.linesWithSku(browser.cartId, EP_SHIPPING_LINE_SKU)).toEqual([]);
    expect(ep.total(browser.cartId)).toBe(2200);
    expect(browser.shownTotal()).toBe(2799);

    const paid = await browser.pay({ gateway: "manual", shownTotal: 2799 });

    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.paidOrders()[0].lines.filter((l) => l.sku === EP_SHIPPING_LINE_SKU)).toEqual([
      { sku: EP_SHIPPING_LINE_SKU, quantity: 1, amount: 599 },
    ]);
  });

  it("charges only an order with one shipping line when two server instances take the same pay", async () => {
    let otherInstance: typeof handlePay = handlePay;
    jest.isolateModules(() => {
      otherInstance = (require("../pay") as typeof import("../pay")).handlePay;
    });
    const browser = new Browser(newCart());
    await readyToPay(browser);

    await Promise.all([
      browser.pay({ gateway: "manual" }),
      browser.pay({ gateway: "manual" }, otherInstance),
    ]);

    for (const order of ep.orders.filter((o) => o.payment !== "unpaid")) {
      expect(order.total).toBe(2799);
      expect(order.lines.filter((l) => l.sku === EP_SHIPPING_LINE_SKU)).toEqual(
        [{ sku: EP_SHIPPING_LINE_SKU, quantity: 1, amount: 599 }]
      );
    }
    for (const order of ep.orders.filter((o) => o.payment === "unpaid")) {
      expect(order.status).toBe("cancelled");
    }
    if (ep.paidOrders().length === 0) {
      await browser.get();
      let again = await browser.pay({ gateway: "manual", shownTotal: browser.shownTotal() });
      if ((again.body as any).error?.code === "TOTAL_CHANGED") {
        expect(browser.shownTotal()).toBe(2799);
        again = await browser.pay({ gateway: "manual", shownTotal: 2799 });
      }
      expect(sessionIn(again).status).toBe("complete");
    }
    expect(ep.paidOrders().map((o) => o.total)).toEqual([2799]);
  });
});

describe("a card that needs a 3DS challenge", () => {
  async function challenged(browser: Browser): Promise<SessionResponse> {
    await readyToPay(browser);
    const res = await browser.pay({ gateway: "stripe3ds" });
    expect(res.status).toBe(200);
    expect(sessionIn(res).payment.status).toBe("requires_action");
    return res;
  }

  it("settles one order when the browser sends three resumes at once", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    ep.passChallenge(browser.pendingPaymentIntent());

    const results = await Promise.all([
      browser.resume(),
      browser.resume(),
      browser.resume(),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const ids = results.map((r) => sessionIn(r).order.id);
    expect(new Set(ids).size).toBe(1);
    expect(ep.charges).toEqual([2799]);
    expect(ep.chargedOrders().map((o) => [o.payment, o.total])).toEqual([
      ["paid", 2799],
    ]);
  });

  it("settles one order when a pay and a resume from one browser arrive together", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    ep.passChallenge(browser.pendingPaymentIntent());

    await Promise.all([browser.resume(), browser.pay({ gateway: "stripe3ds" })]);

    expect(ep.chargedOrders()).toHaveLength(1);
    expect(ep.paidOrders().map((o) => o.total)).toEqual([2799]);
  });

  it("answers a resume replayed with the pre-resume session with the same order and leaves the next cart alone", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    ep.passChallenge(browser.pendingPaymentIntent());
    const stale = clone(browser.cookie);
    const first = await browser.resume();
    expect(sessionIn(first).status).toBe("complete");
    ep.addCart(browser.cartId, [
      { product_id: "p-next", sku: "p-next", quantity: 1, unit_price: { amount: 1000 } },
    ]);
    browser.cookie = stale;

    const replay = await browser.resume();

    expect(replay.status).toBe(200);
    expect(sessionIn(replay).order.id).toBe(sessionIn(first).order.id);
    expect(ep.orders).toHaveLength(1);
    expect(ep.total(browser.cartId)).toBe(1000);
  });

  it("orders exactly what was charged when the cart changes while the challenge is open", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    ep.cart(browser.cartId).lines.push({
      id: "line-added",
      type: "cart_item",
      sku: "p-extra",
      product_id: "p-extra",
      quantity: 1,
      unit_price: { amount: 2200 },
      value: { amount: 2200 },
    });
    ep.passChallenge(browser.pendingPaymentIntent());

    const res = await browser.resume();

    expect(res.status).toBe(200);
    expect(sessionIn(res).status).toBe("complete");
    expect(ep.charges).toEqual([2799]);
    expect(ep.chargedOrders().map((o) => [o.payment, o.total])).toEqual([
      ["paid", 2799],
    ]);
    expect(ep.orders[0].lines.map((l) => l.sku)).not.toContain("p-extra");
  });

  it("answers a pay sent while the challenge is open with the open challenge, and takes no new payment", async () => {
    const browser = new Browser(newCart());
    const first = await challenged(browser);

    const again = await browser.pay({ gateway: "stripe3ds" });

    expect(again.status).toBe(409);
    expect((again.body as any).error.code).toBe("PAYMENT_ACTION_PENDING");
    expect(sessionIn(again).payment.status).toBe("requires_action");
    expect(sessionIn(again).payment.clientToken).toBe(
      sessionIn(first).payment.clientToken
    );
    ep.passChallenge(browser.pendingPaymentIntent());
    const resumed = await browser.resume();
    expect(sessionIn(resumed).status).toBe("complete");
    expect(ep.charges).toEqual([2799]);
    expect(ep.paidOrders().map((o) => o.total)).toEqual([2799]);
  });

  it("refuses a checkout change while the challenge is open", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);

    const change = await browser.update({ selectedShippingRateId: RATE.id });

    expect(change.status).toBe(409);
    expect((change.body as any).error.code).toBe("PAYMENT_ACTION_PENDING");
  });

  it("lets the shopper pay again after a failed challenge, and settles one order", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    ep.failChallenge(browser.pendingPaymentIntent());

    const abandoned = await browser.abandon();
    expect(abandoned.status).toBe(200);
    const paid = await browser.pay({ gateway: "stripe" });

    expect(paid.status).toBe(200);
    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.charges).toEqual([2799]);
    expect(ep.chargedOrders().map((o) => [o.payment, o.total])).toEqual([
      ["paid", 2799],
    ]);
  });

  it("does not start a challenge when the cart changes before its order is held", async () => {
    registry.register("stripe3dsRace", {
      paymentSequence: "cart_payment_intent",
      initializePayment: async (s: CheckoutSession) => {
        const pi = await ep.startChallenge(s.cartId);
        ep.cart(s.cartId).lines[0].quantity += 1;
        return {
          status: "requires_action",
          clientToken: `${pi.id}_secret`,
          gatewayMetadata: { paymentIntentId: pi.id },
        };
      },
    });
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const res = await browser.pay({ gateway: "stripe3dsRace" });

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain("_secret");
    expect(browser.cookie?.payment.status).not.toBe("requires_action");
    expect(ep.cart(browser.cartId).paymentIntentId).toBeUndefined();
    expect(ep.charges).toEqual([]);
  });

  it("refuses a resume sent before the challenge is passed, and settles the order after it is", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);

    const early = await browser.resume();

    expect(early.status).toBe(409);
    expect((early.body as any).error.code).toBe("PAYMENT_STILL_REQUIRES_ACTION");
    expect(sessionIn(early).payment.status).toBe("requires_action");
    ep.passChallenge(browser.pendingPaymentIntent());
    const done = await browser.resume();
    expect(sessionIn(done).status).toBe("complete");
    expect(ep.charges).toEqual([2799]);
    expect(ep.chargedOrders().map((o) => [o.payment, o.total])).toEqual([
      ["paid", 2799],
    ]);
  });

  it("refuses to confirm when the gateway cannot report the payment's state, and the order can still settle", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    await browser.pay({ gateway: "stripe3dsUnverified" });
    ep.passChallenge(browser.pendingPaymentIntent());

    const res = await browser.resume();

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("PAYMENT_STATUS_UNVERIFIED");
    expect((res.body as any).error.message).toBeTruthy();
    expect(ep.orders[0].payment).toBe("unpaid");
    expect(ep.orders[0].paymentIntentId).toBe(browser.pendingPaymentIntent());
  });

  it("refuses to abandon a challenge that was passed, and the order still settles", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    ep.passChallenge(browser.pendingPaymentIntent());

    const abandoned = await browser.abandon();

    expect(abandoned.status).toBe(409);
    expect((abandoned.body as any).error.code).toBe("PAYMENT_ALREADY_TAKEN");
    expect(ep.cart(browser.cartId).paymentIntentId).toBe(browser.pendingPaymentIntent());
    const done = await browser.resume();
    expect(sessionIn(done).status).toBe("complete");
    expect(ep.paidOrders().map((o) => o.total)).toEqual([2799]);
  });

  it("drops the order and frees the cart when the challenge failed", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    ep.failChallenge(browser.pendingPaymentIntent());

    const res = await browser.resume();

    expect(sessionIn(res).payment.status).toBe("failed");
    expect(sessionIn(res).order).toBeNull();
    const paid = await browser.pay({ gateway: "stripe" });
    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.chargedOrders().map((o) => o.total)).toEqual([2799]);
  });

  it("keeps the lines the shopper added during the challenge in the cart after the order completes", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    const cart = ep.cart(browser.cartId);
    cart.lines.find((l) => l.sku === "p-plus-sub")!.quantity += 1;
    cart.lines.push({
      id: "line-added",
      type: "cart_item",
      sku: "p-extra",
      product_id: "p-extra",
      quantity: 2,
      unit_price: { amount: 1000 },
      value: { amount: 2000 },
    });
    ep.passChallenge(browser.pendingPaymentIntent());

    const res = await browser.resume();

    expect(sessionIn(res).status).toBe("complete");
    expect(ep.paidOrders().map((o) => o.total)).toEqual([2799]);
    const left = ep.cart(browser.cartId);
    expect(
      left.lines.map((l) => [l.sku, l.quantity]).sort()
    ).toEqual([
      ["p-extra", 2],
      ["p-plus-sub", 1],
    ]);
    expect(left.paymentIntentId).toBeUndefined();
  });

  it("deletes the cart after the order completes when nothing was added", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    ep.passChallenge(browser.pendingPaymentIntent());

    await browser.resume();

    expect(ep.carts.get(browser.cartId)!.deleted).toBe(true);
  });
});

describe("a 3DS checkout always reaches an end the shopper can move on from", () => {
  async function challenged(browser: Browser, gateway = "stripe3ds"): Promise<void> {
    await readyToPay(browser);
    const res = await browser.pay({ gateway });
    expect(sessionIn(res).payment.status).toBe("requires_action");
  }

  function addExtraLine(cartId: string) {
    ep.cart(cartId).lines.push({
      id: "line-added",
      type: "cart_item",
      sku: "p-extra",
      product_id: "p-extra",
      quantity: 1,
      unit_price: { amount: 1000 },
      value: { amount: 1000 },
    });
  }

  it("finishes the cart cleanup when the order was paid by a resume that never finished", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    addExtraLine(browser.cartId);
    ep.passChallenge(browser.pendingPaymentIntent());
    ep.confirm(heldOrder().id);

    const res = await browser.resume();

    expect(sessionIn(res).status).toBe("complete");
    const cart = ep.cart(browser.cartId);
    expect(cart.paymentIntentId).toBeUndefined();
    expect(cart.lines.map((l) => l.sku)).toEqual(["p-extra"]);
    expect(ep.paidOrders()).toHaveLength(1);
  });

  it("completes for reconciliation when the order can no longer take a payment Stripe reports taken", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    const piId = browser.pendingPaymentIntent();
    ep.confirm(heldOrder().id);
    ep.passChallenge(piId);

    const res = await browser.resume();

    expect(res.status).toBe(200);
    expect(sessionIn(res).status).toBe("complete");
    expect((res.body as any).reconciliationPending).toBe(true);
    expect(heldOrder().externalRef).toContain(piId);
    expect(ep.carts.get(browser.cartId)!.deleted).toBe(true);
    expect((await browser.pay({ gateway: "stripe3ds" })).status).toBe(400);
  });

  it("ends a challenge started without a held order, when the cart changed and the payment was taken, without ordering uncharged items", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);
    const piId = browser.pendingPaymentIntent();
    browser.cookie = { ...browser.cookie!, order: null };
    const ordersBefore = ep.orders.length;
    addExtraLine(browser.cartId);
    ep.passChallenge(piId);

    const res = await browser.resume();

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("PAYMENT_NEEDS_REVIEW");
    expect((res.body as any).error.message).toMatch(/payment/i);
    expect((res.body as any).reconciliationPending).toBe(true);
    expect(sessionIn(res).status).toBe("complete");
    expect(ep.orders).toHaveLength(ordersBefore);
    expect(ep.cart(browser.cartId).paymentIntentId).toBeUndefined();
    expect(ep.cart(browser.cartId).lines.map((l) => l.sku)).toContain("p-extra");
    expect((await browser.pay({ gateway: "stripe3ds" })).status).toBe(400);
    expect((await browser.abandon()).status).toBe(400);
    expect((await browser.resume()).status).toBe(400);
  });

  it.each([
    ["stripe3dsBlind", 502, "PAYMENT_STATUS_UNKNOWN"],
    ["stripe3dsUnverified", 409, "PAYMENT_STATUS_UNVERIFIED"],
  ])("does not abandon a payment %s cannot read", async (gateway, status, code) => {
    const browser = new Browser(newCart());
    await challenged(browser, gateway);
    const piId = browser.pendingPaymentIntent();

    const res = await browser.abandon();

    expect(res.status).toBe(status);
    expect((res.body as any).error.code).toBe(code);
    expect(ep.cart(browser.cartId).paymentIntentId).toBe(piId);
    expect(browser.cookie?.payment.status).toBe("requires_action");
  });

  it("abandons a challenge that is still open", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);

    const res = await browser.abandon();

    expect(res.status).toBe(200);
    expect(ep.cart(browser.cartId).paymentIntentId).toBeUndefined();
  });

  describe("deletes the whole cart rather than leave a paid line in it", () => {
    async function paidWithExtraLine(breakIt: () => void) {
      const browser = new Browser(newCart());
      await challenged(browser);
      addExtraLine(browser.cartId);
      ep.passChallenge(browser.pendingPaymentIntent());
      breakIt();
      const res = await browser.resume();
      expect(sessionIn(res).status).toBe("complete");
      return browser;
    }

    it("when an order item does not name its cart line", async () => {
      const browser = await paidWithExtraLine(() => {
        ep.orderItemsWithoutCartLines = true;
      });
      expect(ep.carts.get(browser.cartId)!.deleted).toBe(true);
    });

    it("when removing an ordered line fails", async () => {
      const browser = await paidWithExtraLine(() => {
        sdkImpl.deleteACartItem = async () => ({
          error: { errors: [{ status: 500, detail: "unavailable" }] },
        });
      });
      expect(ep.carts.get(browser.cartId)!.deleted).toBe(true);
    });

    it("when unlinking the PaymentIntent from the cart fails", async () => {
      const browser = await paidWithExtraLine(() => {
        const update = sdkImpl.updateACart;
        sdkImpl.updateACart = async (args: any) =>
          args?.body?.data?.payment_intent_id === ""
            ? { error: { errors: [{ status: 500, detail: "unavailable" }] } }
            : update(args);
      });
      expect(ep.carts.get(browser.cartId)!.deleted).toBe(true);
    });
  });

  it("shows the held order's total when it differs, cancels that order, and the next submit succeeds", async () => {
    registry.register("stripe3dsRace", {
      paymentSequence: "cart_payment_intent",
      initializePayment: async (s: CheckoutSession) => {
        const pi = await ep.startChallenge(s.cartId);
        if (ep.orders.length === 0) ep.cart(s.cartId).lines[0].quantity += 1;
        return {
          status: "requires_action",
          clientToken: `${pi.id}_secret`,
          gatewayMetadata: { paymentIntentId: pi.id },
        };
      },
      readPaymentIntentState: async () => "settled",
    });
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const first = await browser.pay({ gateway: "stripe3dsRace" });

    expect(first.status).toBe(409);
    expect((first.body as any).error.code).toBe("ORDER_TOTAL_CHANGED");
    expect(sessionIn(first).totals.total).toBe(4999);
    expect(ep.orders[0].status).toBe("cancelled");
    const second = await browser.pay({ gateway: "stripe3dsRace" });
    expect(second.status).toBe(200);
    expect(sessionIn(second).payment.status).toBe("requires_action");
    expect(heldOrder().total).toBe(4999);
  });

  it("shows the order-first order's total when it differs, and the next submit succeeds", async () => {
    let bumped = false;
    registry.register(
      "manualRace",
      createManualAdapter({
        allow: () => {
          if (!bumped) {
            bumped = true;
            ep.cart(cartSeqId()).lines[0].quantity += 1;
          }
          return true;
        },
      })
    );
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const first = await browser.pay({ gateway: "manualRace" });

    expect(first.status).toBe(409);
    expect((first.body as any).error.code).toBe("ORDER_TOTAL_CHANGED");
    expect(sessionIn(first).totals.total).toBe(4999);
    expect(ep.orders[0].status).toBe("cancelled");
    const second = await browser.pay({ gateway: "manualRace" });
    expect(sessionIn(second).status).toBe("complete");
    expect(ep.paidOrders().map((o) => o.total)).toEqual([4999]);
  });
});

function cartSeqId(): string {
  return `cart-${cartSeq}`;
}

describe("after a paid order, the ordered lines leave the cart", () => {
  function remainingLines(cartId: string): string[] {
    const cart = ep.carts.get(cartId);
    return !cart || cart.deleted ? [] : cart.lines.map((l) => `${l.sku}x${l.quantity}`);
  }

  it.each([
    ["manual", async (b: Browser) => b.pay({ gateway: "manual" })],
    ["stripe", async (b: Browser) => b.pay({ gateway: "stripe" })],
    [
      "3DS",
      async (b: Browser) => {
        await b.pay({ gateway: "stripe3ds" });
        ep.passChallenge(b.pendingPaymentIntent());
        return b.resume();
      },
    ],
  ])("empties an account's last cart, which Elastic Path will not delete (%s)", async (_label, payWith) => {
    const browser = new Browser(newCart());
    ep.lastAccountCarts.add(browser.cartId);
    await readyToPay(browser);

    const res = await payWith(browser);

    expect(sessionIn(res).status).toBe("complete");
    expect(remainingLines(browser.cartId)).toEqual([]);
    expect(ep.cart(browser.cartId).paymentIntentId).toBeUndefined();
  });

  it("empties an account's last cart after a free order", async () => {
    const browser = new Browser(
      newCart([{ product_id: "p-free", sku: "p-free", quantity: 1, unit_price: { amount: 0 } }])
    );
    ep.lastAccountCarts.add(browser.cartId);
    expect((await browser.create()).status).toBe(201);
    await browser.update({
      customerInfo: { name: "Walk Tester", email: "walk@example.com" },
      billingAddress: ADDRESS,
      requiresShipping: false,
    });

    const res = await browser.pay({ gateway: "manual" });

    expect(sessionIn(res).status).toBe("complete");
    expect(remainingLines(browser.cartId)).toEqual([]);
  });

  it("keeps the next checkout from buying lines it could not remove, until they are removed", async () => {
    const browser = new Browser(newCart());
    ep.lastAccountCarts.add(browser.cartId);
    ep.undeletableItems.add(browser.cartId);
    await readyToPay(browser);
    expect(sessionIn(await browser.pay({ gateway: "manual" })).status).toBe("complete");
    expect(remainingLines(browser.cartId)).not.toEqual([]);

    const blocked = await browser.create();

    expect(blocked.status).toBe(409);
    expect((blocked.body as any).error.code).toBe("CART_CLEANUP_PENDING");
    expect(ep.paidOrders()).toHaveLength(1);

    ep.undeletableItems.delete(browser.cartId);
    ep.cart(browser.cartId).lines.push({
      id: "line-next",
      type: "cart_item",
      sku: "p-next",
      product_id: "p-next",
      quantity: 1,
      unit_price: { amount: 1000 },
      value: { amount: 1000 },
    });
    const retried = await browser.create();
    expect(retried.status).toBe(409);
    expect((retried.body as any).error.code).toBe("EMPTY_CART");
    expect(remainingLines(browser.cartId)).toEqual([]);
  });
});

describe("a checkout Elastic Path rejects", () => {
  const STOCK = "There is not enough stock to add Test Product 1 to your cart";

  it("tells the shopper why, takes no payment, and the next submit can succeed", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    ep.checkoutRejection = { status: 400, detail: STOCK };

    const res = await browser.pay({ gateway: "manual" });

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("CHECKOUT_REJECTED");
    expect((res.body as any).error.message).toBe(STOCK);
    expect(browser.cookie?.status).toBe("open");
    expect(ep.orders).toEqual([]);

    ep.checkoutRejection = null;
    const paid = await browser.pay({ gateway: "manual" });
    expect(sessionIn(paid).status).toBe("complete");
  });

  it("refuses the card check before it starts, and frees the cart", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    ep.checkoutRejection = { status: 400, detail: STOCK };

    const res = await browser.pay({ gateway: "stripe3ds" });

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("CHECKOUT_REJECTED");
    expect(JSON.stringify(res.body)).not.toContain("_secret");
    expect(ep.cart(browser.cartId).paymentIntentId).toBeUndefined();
    expect(ep.charges).toEqual([]);
  });

  it("keeps a server error a 502", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    ep.checkoutRejection = { status: 503, detail: "unavailable" };

    const res = await browser.pay({ gateway: "manual" });

    expect(res.status).toBe(502);
    expect((res.body as any).error.code).toBe("EP_ERROR");
  });

  it("ends a card payment taken before the checkout was rejected, without leaving the shopper stuck", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    ep.checkoutRejection = { status: 400, detail: STOCK };

    const res = await browser.pay({ gateway: "stripe" });

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("PAYMENT_NEEDS_REVIEW");
    expect((res.body as any).error.message).toMatch(/payment/i);
    expect((res.body as any).reconciliationPending).toBe(true);
    expect(sessionIn(res).status).toBe("complete");
    expect(ep.cart(browser.cartId).paymentIntentId).toBeUndefined();

    ep.checkoutRejection = null;
    expect((await browser.create()).status).toBe(201);
  });

  it.each([
    ["answers with a server error", () => {
      ep.checkoutRejection = { status: 503, detail: "unavailable" };
    }],
    ["throws", () => {
      sdkImpl.checkoutApi = async () => {
        throw new Error("socket hang up");
      };
    }],
  ])("ends a card payment taken before the checkout %s, recording the payment", async (_, failCheckout) => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    failCheckout();

    const res = await browser.pay({ gateway: "stripe" });

    const [pi] = [...ep.paymentIntents.keys()];
    expect(ep.charges).toEqual([2799]);
    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("PAYMENT_NEEDS_REVIEW");
    expect((res.body as any).error.message).toMatch(/received your payment/);
    expect((res.body as any).reconciliationPending).toBe(true);
    expect(sessionIn(res).status).toBe("complete");
    expect(sessionIn(res).payment.gatewayMetadata).toMatchObject({
      paymentIntentId: pi,
      needsReconciliation: true,
    });
    expect(ep.cart(browser.cartId).paymentIntentId).toBeUndefined();

    const again = await browser.pay({ gateway: "stripe" });
    expect((again.body as any).error.code).toBe("SESSION_NOT_OPEN");
    expect(ep.charges).toEqual([2799]);

    ep.checkoutRejection = null;
    Object.assign(sdkImpl, ep.sdk());
    expect((await browser.create()).status).toBe(201);
  });
});

describe("a taken payment whose admin token cannot be minted afterwards", () => {
  it("still records the payment on the order and completes", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    browser.identity = {
      allowedCustomAttributeKeys: ["po_number"],
      getClientCredentialsToken: async () => {
        if (ep.charges.length > 0) throw new Error("token endpoint unavailable");
        return "admin-token";
      },
    };
    await browser.update({ customAttributes: { po_number: "PO-1" } });

    const res = await browser.pay({ gateway: "stripe" });

    expect(res.status).toBe(200);
    expect(sessionIn(res).status).toBe("complete");
    expect(ep.paidOrders().map((o) => o.paid)).toEqual([2799]);
  });
});

describe("an order whose total is not the amount charged", () => {
  it("is never reported cleanly complete: it is marked for reconciliation and the shopper is told", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const res = await browser.pay({ gateway: "stripeLateWrite" });

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("PAYMENT_NEEDS_REVIEW");
    expect((res.body as any).error.message).toMatch(/27\.99/);
    expect((res.body as any).reconciliationPending).toBe(true);
    expect(sessionIn(res).status).toBe("complete");
    const order = ep.orders[0];
    expect(order.total).toBe(2899);
    expect(order.paid).toBe(2799);
    expect(order.externalRef).toContain("needs-reconciliation");
  });

  it("tells the shopper both amounts in the currency's own minor unit", async () => {
    ep.currency = "JPY";
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const res = await browser.pay({ gateway: "stripeLateWrite" });

    expect((res.body as any).error.code).toBe("PAYMENT_NEEDS_REVIEW");
    expect((res.body as any).error.message).toContain("¥2,899");
    expect((res.body as any).error.message).toContain("¥2,799");
    expect((res.body as any).error.message).not.toMatch(/28\.99|27\.99/);
  });

  it("completes normally when the order total is the amount charged", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const res = await browser.pay({ gateway: "stripe" });

    expect(res.status).toBe(200);
    expect((res.body as any).reconciliationPending).toBeUndefined();
    expect(ep.orders[0].externalRef).toBeUndefined();
  });
});

describe("the cart check and promotions", () => {
  const PROMO_CART = [
    { product_id: "p-plus", sku: "p-plus-sub", quantity: 1, unit_price: { amount: 2200 } },
    {
      id: "promo-1",
      type: "promotion_item",
      sku: "TEST1",
      quantity: 1,
      unit_price: { amount: 0 },
      percentOff: 10,
    },
  ];

  it("does not count a promotion re-priced by the shipping line as a cart change", async () => {
    const browser = new Browser(newCart(PROMO_CART as any));
    await readyToPay(browser);
    expect(browser.shownTotal()).toBe(2519);

    const res = await browser.pay({ gateway: "manual" });

    expect(res.status).toBe(200);
    expect(sessionIn(res).status).toBe("complete");
    expect(ep.paidOrders().map((o) => o.total)).toEqual([2519]);
  });

  it("still counts a promotion removed after the session was created", async () => {
    const browser = new Browser(newCart(PROMO_CART as any));
    await readyToPay(browser);
    const cart = ep.cart(browser.cartId);
    cart.lines = cart.lines.filter((l) => l.type !== "promotion_item");

    const res = await browser.pay({ gateway: "manual" });

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("CART_MISMATCH");
  });

  it("still counts a promotion added after the session was created", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    ep.cart(browser.cartId).lines.push({
      id: "promo-late",
      type: "promotion_item",
      sku: "TEST1",
      quantity: 1,
      unit_price: { amount: 0 },
      value: { amount: 0 },
      percentOff: 10,
    });

    const res = await browser.pay({ gateway: "manual" });

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("CART_MISMATCH");
  });
});

describe("abandoning a card check that can still complete", () => {
  async function challenged(browser: Browser): Promise<string> {
    await readyToPay(browser);
    const res = await browser.pay({ gateway: "stripe3ds" });
    expect(sessionIn(res).payment.status).toBe("requires_action");
    return browser.pendingPaymentIntent();
  }

  it("voids the payment, so completing the challenge later charges nothing, and the next pay settles one order", async () => {
    const browser = new Browser(newCart());
    const piId = await challenged(browser);
    const held = heldOrder();

    const abandoned = await browser.abandon();

    expect(abandoned.status).toBe(200);
    expect(sessionIn(abandoned).payment.status).toBe("failed");
    expect(ep.paymentIntents.get(piId)!.status).toBe("canceled");
    expect(held.status).toBe("cancelled");
    expect(ep.cart(browser.cartId).paymentIntentId).toBeUndefined();
    expect(ep.passChallenge(piId)).toBe(false);

    const paid = await browser.pay({ gateway: "stripe" });
    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.charges).toEqual([2799]);
    expect(ep.chargedOrders().map((o) => o.total)).toEqual([2799]);
  });

  it("returns the stock the voided order took", async () => {
    ep.allocated.set("p-plus", 0);
    const browser = new Browser(newCart());
    await challenged(browser);

    expect((await browser.abandon()).status).toBe(200);

    expect(ep.allocated.get("p-plus")).toBe(0);
  });

  it("when the challenge completes just before the void, keeps the order and does not free the cart for a second charge", async () => {
    const browser = new Browser(newCart());
    const piId = await challenged(browser);
    ep.beforeCancel = () => {
      ep.passChallenge(piId);
      ep.beforeCancel = null;
    };

    const res = await browser.abandon();

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("PAYMENT_ALREADY_TAKEN");
    expect((res.body as any).reconciliationPending).toBe(true);
    expect(sessionIn(res).status).toBe("complete");
    expect(heldOrder().externalRef).toContain(piId);
    expect((await browser.pay({ gateway: "stripe" })).status).toBe(400);
    expect(ep.charges).toEqual([2799]);
  });

  it("when the challenge completed before the void began, settles the held order instead", async () => {
    const browser = new Browser(newCart());
    const piId = await challenged(browser);
    registry.register("stripe3dsStale", {
      paymentSequence: "cart_payment_intent",
      initializePayment: async () => ({ status: "failed" as const }),
      // The read says the challenge is open; it completes right after.
      readPaymentIntentState: async () => {
        ep.passChallenge(piId);
        return "awaiting_action";
      },
    });
    browser.cookie = {
      ...browser.cookie!,
      payment: { ...browser.cookie!.payment, gateway: "stripe3dsStale" },
    };

    const res = await browser.abandon();

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("PAYMENT_ALREADY_TAKEN");
    expect(sessionIn(res).status).toBe("complete");
    expect(heldOrder().payment).toBe("paid");
    expect(ep.charges).toEqual([2799]);
  });

  it("keeps the session open when the void cannot be done, and a retry voids it", async () => {
    const browser = new Browser(newCart());
    const piId = await challenged(browser);
    ep.cancelFails = true;

    const first = await browser.abandon();

    expect(first.status).toBe(502);
    expect((first.body as any).error.code).toBe("PAYMENT_STATUS_UNKNOWN");
    expect(browser.cookie?.payment.status).toBe("requires_action");
    expect(ep.cart(browser.cartId).paymentIntentId).toBe(piId);

    ep.cancelFails = false;
    const second = await browser.abandon();
    expect(second.status).toBe(200);
    expect(ep.paymentIntents.get(piId)!.status).toBe("canceled");
  });

  it("still never confirms a payment on resume before the challenge is passed", async () => {
    const browser = new Browser(newCart());
    await challenged(browser);

    const early = await browser.resume();

    expect(early.status).toBe(409);
    expect((early.body as any).error.code).toBe("PAYMENT_STILL_REQUIRES_ACTION");
    expect(heldOrder().transactions).toEqual([]);
  });
});

describe("the session follows the cart before the shopper pays", () => {
  it("shows a code applied on the checkout page on the next read, and the first pay charges it", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    expect(browser.shownTotal()).toBe(2799);
    ep.applyPromotion(browser.cartId, "TEST1", 10);

    const read = await browser.get();

    expect(read.status).toBe(200);
    expect(read.headers?.["Set-Cookie"]).toBeDefined();
    expect(sessionIn(read).totals).toEqual({
      subtotal: 1980,
      tax: 0,
      shipping: 539,
      total: 2519,
      currency: "USD",
    });
    expect(browser.shownTotal()).toBe(2519);

    const paid = await browser.pay({ gateway: "stripe", shownTotal: 2519 });

    expect(paid.status).toBe(200);
    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.charges).toEqual([2519]);
  });

  it("shows a free order before pay when a 100% code is applied, with no negative subtotal, and settles it with no charge", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    ep.applyPromotion(browser.cartId, "FREE", 100);

    const read = await browser.get();

    expect(sessionIn(read).totals).toEqual({
      subtotal: 0,
      tax: 0,
      shipping: 0,
      total: 0,
      currency: "USD",
    });

    const paid = await browser.pay({ gateway: "manual", shownTotal: 0 });

    expect(paid.status).toBe(200);
    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.charges).toEqual([]);
  });

  it("refuses to charge a total another tab's read moved, shows the new total, and charges it next", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    const shownInThisTab = browser.shownTotal();
    ep.setQuantity(browser.cartId, "p-plus-sub", 2);
    expect(sessionIn(await browser.get()).totals.total).toBe(4999);

    const stale = await browser.pay({ gateway: "stripe", shownTotal: shownInThisTab });

    expect(stale.status).toBe(409);
    expect((stale.body as any).error.code).toBe("TOTAL_CHANGED");
    expect(sessionIn(stale).totals.total).toBe(4999);
    expect(ep.charges).toEqual([]);
    expect(ep.orders).toEqual([]);

    const paid = await browser.pay({ gateway: "stripe", shownTotal: 4999 });

    expect(paid.status).toBe(200);
    expect(ep.charges).toEqual([4999]);
  });

  it("leaves a session alone while its card check is open", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    expect((await browser.pay({ gateway: "stripe3ds" })).status).toBe(200);
    const held = clone(browser.cookie);
    ep.applyPromotion(browser.cartId, "TEST1", 10);

    const read = await browser.get();

    expect(read.status).toBe(200);
    expect(read.headers).toBeUndefined();
    expect(sessionIn(read).totals.total).toBe(2799);
    expect(browser.cookie).toEqual(held);
  });
});

describe("a checkout started on an empty cart", () => {
  it("is refused with a message the page can show", async () => {
    const browser = new Browser(
      newCart([
        {
          type: "custom_item",
          sku: EP_SHIPPING_LINE_SKU,
          quantity: 1,
          unit_price: { amount: 599 },
        } as any,
      ])
    );

    const res = await browser.create();

    expect(res.status).toBe(409);
    expect((res.body as any).error).toEqual({
      code: "EMPTY_CART",
      message: "Your cart is empty",
    });
    expect(browser.cookie).toBeNull();
  });
});

describe("an account member's order belongs to the selected account", () => {
  const ACCOUNT_A = { accountToken: "account-token-a", accountId: "account-a", accountMemberId: "member-1" };
  const ACCOUNT_B = { accountToken: "account-token-b", accountId: "account-b", accountMemberId: "member-1" };
  const MEMBER_ONLY = { accountMemberId: "member-1" };
  const WALK = { name: "Walk Tester", email: "walk@example.com" };
  const LINKED_TO_A = { account: "account-a", member: "member-1", contact: WALK, customer: null };
  const GUEST = { account: null, member: null, contact: null, customer: WALK };

  function linkOf(order: { account?: string; accountMember?: string; contact?: unknown; customer?: unknown }) {
    return {
      account: order.account ?? null,
      member: order.accountMember ?? null,
      contact: order.contact ?? null,
      customer: order.customer ?? null,
    };
  }

  function remainingLines(cartId: string): string[] | "deleted" {
    const cart = ep.carts.get(cartId);
    return !cart || cart.deleted ? "deleted" : cart.lines.map((l) => `${l.sku}x${l.quantity}`);
  }

  async function freeCheckout(browser: Browser): Promise<SessionResponse> {
    expect((await browser.create()).status).toBe(201);
    await browser.update({ customerInfo: WALK, billingAddress: ADDRESS, requiresShipping: false });
    return browser.pay({ gateway: "manual" });
  }

  const PATHS: Array<[string, (b: Browser) => Promise<SessionResponse>, boolean]> = [
    ["manual (order first)", async (b) => (await readyToPay(b), b.pay({ gateway: "manual" })), false],
    ["card", async (b) => (await readyToPay(b), b.pay({ gateway: "stripe" })), false],
    [
      "3DS with a held order",
      async (b) => {
        await readyToPay(b);
        await b.pay({ gateway: "stripe3ds" });
        expect(b.cookie?.order?.id).toBeTruthy();
        ep.passChallenge(b.pendingPaymentIntent());
        return b.resume();
      },
      false,
    ],
    [
      "3DS resumed without a held order",
      async (b) => {
        await readyToPay(b);
        await b.pay({ gateway: "stripe3ds" });
        const held = ep.orders.pop()!;
        expect(held.payment).toBe("unpaid");
        b.cookie = { ...b.cookie!, order: null };
        ep.passChallenge(b.pendingPaymentIntent());
        return b.resume();
      },
      false,
    ],
    ["free order", freeCheckout, true],
  ];

  function cartFor(free: boolean): string {
    return free
      ? newCart([{ product_id: "p-free", sku: "p-free", quantity: 1, unit_price: { amount: 0 } }])
      : newCart();
  }

  it.each(PATHS)("links the order to the account and the member: %s", async (_label, checkout, free) => {
    const browser = new Browser(cartFor(free));
    browser.identity = ACCOUNT_A;

    const res = await checkout(browser);

    expect(sessionIn(res).status).toBe("complete");
    expect(ep.orders.map(linkOf)).toEqual([LINKED_TO_A]);
    expect(ep.orders[0].payment).toBe("paid");
    expect(ep.orders[0].accountTokenSent).toBeUndefined();
  });

  it.each(PATHS)("keeps a guest order a guest order: %s", async (_label, checkout, free) => {
    const browser = new Browser(cartFor(free));

    const res = await checkout(browser);

    expect(sessionIn(res).status).toBe("complete");
    expect(ep.orders.map(linkOf)).toEqual([GUEST]);
  });

  it("checks out a signed-in member with no selected account as a guest", async () => {
    const browser = new Browser(newCart());
    browser.identity = MEMBER_ONLY;
    await readyToPay(browser);

    const res = await browser.pay({ gateway: "manual" });

    expect(sessionIn(res).status).toBe("complete");
    expect(ep.orders.map(linkOf)).toEqual([GUEST]);
  });

  it("takes the account and the member from the shopper session", async () => {
    const cartId = newCart();
    const browser = new Browser(cartId);
    browser.identity = checkoutContextFromSession({
      session: {
        accessToken: "shopper-token",
        expires: Date.now() + 60_000,
        clientId: "client",
        host: "https://api.test.com",
        memberId: "member-1",
        account: { id: "account-a", token: "account-token-a", expires: Date.now() + 60_000 },
        lapsedAccount: null,
      },
      cart: { id: cartId },
    });

    const res = await (await readyToPay(browser), browser.pay({ gateway: "stripe" }));

    expect(sessionIn(res).status).toBe("complete");
    expect(ep.orders.map(linkOf)).toEqual([LINKED_TO_A]);
  });

  it.each([
    ["the account token without its id", { accountToken: "account-token-a", accountMemberId: "member-1" }],
    ["the account id without its token", { accountId: "account-a", accountMemberId: "member-1" }],
  ])("refuses a checkout, and places no guest order, when the host sets %s", async (_, half) => {
    const browser = new Browser(newCart());
    browser.identity = half;

    const created = await browser.create();

    expect(created.status).toBe(500);
    expect((created.body as any).error.code).toBe("ACCOUNT_NOT_CONFIGURED");
    expect(browser.cookie).toBeNull();

    browser.identity = {};
    await readyToPay(browser);
    browser.identity = half;
    const paid = await browser.pay({ gateway: "stripe" });

    expect(paid.status).toBe(500);
    expect((paid.body as any).error.code).toBe("ACCOUNT_NOT_CONFIGURED");
    expect(ep.charges).toEqual([]);
    expect(ep.orders).toEqual([]);
  });

  it("gives the manual payment rule the account the order is then placed for", async () => {
    const seen: Array<string | null> = [];
    registry.register(
      "manualRule",
      createManualAdapter({
        allow: (input) => {
          seen.push(input.account?.id ?? null);
          return true;
        },
      })
    );
    const browser = new Browser(newCart());
    browser.identity = ACCOUNT_B;
    await readyToPay(browser);

    const res = await browser.pay({ gateway: "manualRule" });

    expect(sessionIn(res).status).toBe("complete");
    expect(seen).toEqual(["account-b"]);
    expect(ep.paidOrders().map((o) => o.account)).toEqual(["account-b"]);
  });

  it.each([
    ["switches to another account", ACCOUNT_B],
    ["loses the selected account", MEMBER_ONLY],
    ["has no identity left", {}],
  ])("refuses to pay when the shopper %s after checkout started, and takes no payment", async (_label, next) => {
    const browser = new Browser(newCart());
    browser.identity = ACCOUNT_A;
    await readyToPay(browser);
    browser.identity = next;

    const res = await browser.pay({ gateway: "stripe" });

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("ACCOUNT_CHANGED");
    expect(ep.orders).toEqual([]);
    expect(ep.charges).toEqual([]);
    expect(browser.cookie).toBeNull();
  });

  it("refuses to pay a guest checkout as an account selected after it started, and the next checkout is the account's", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    browser.identity = ACCOUNT_A;

    const refused = await browser.pay({ gateway: "manual" });

    expect(refused.status).toBe(409);
    expect((refused.body as any).error.code).toBe("ACCOUNT_CHANGED");
    expect(ep.orders).toEqual([]);

    await readyToPay(browser);
    const paid = await browser.pay({ gateway: "manual" });

    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.orders.map(linkOf)).toEqual([LINKED_TO_A]);
  });

  it("keeps the account out of the session the browser reads", async () => {
    const browser = new Browser(newCart());
    browser.identity = ACCOUNT_A;
    await readyToPay(browser);

    const res = await browser.get();

    expect(sessionIn(res).status).toBe("open");
    expect(JSON.stringify(res.body)).not.toContain("account-a");
    expect(JSON.stringify(res.body)).not.toContain("member-1");
  });

  it.each(["stripe", "manual"])(
    "empties the account's last cart and deletes an account cart that is not its last (%s)",
    async (gateway) => {
      const last = new Browser(newCart());
      last.identity = ACCOUNT_A;
      ep.lastAccountCarts.add(last.cartId);
      const other = new Browser(newCart());
      other.identity = ACCOUNT_A;
      await readyToPay(last);
      await readyToPay(other);

      const a = await last.pay({ gateway });
      const b = await other.pay({ gateway });

      expect([sessionIn(a).status, sessionIn(b).status]).toEqual(["complete", "complete"]);
      expect(ep.paidOrders().map((o) => o.account)).toEqual(["account-a", "account-a"]);
      expect(remainingLines(last.cartId)).toEqual([]);
      expect(ep.cart(last.cartId).paymentIntentId).toBeUndefined();
      expect(remainingLines(other.cartId)).toBe("deleted");
    }
  );

  it("puts the shipping line and the checkout's extra fields on an account order", async () => {
    const browser = new Browser(newCart());
    browser.identity = { ...ACCOUNT_A, allowedCustomAttributeKeys: ["po_number"] };
    await readyToPay(browser);
    await browser.update({ customAttributes: { po_number: "PO-322" } });

    const res = await browser.pay({ gateway: "stripe" });

    expect(sessionIn(res).status).toBe("complete");
    const [order] = ep.orders;
    expect(linkOf(order)).toEqual(LINKED_TO_A);
    expect(order.lines.filter((l) => l.sku === EP_SHIPPING_LINE_SKU)).toEqual([
      { sku: EP_SHIPPING_LINE_SKU, quantity: 1, amount: 599 },
    ]);
    expect(order.total).toBe(2799);
    expect(order.fields).toEqual({ po_number: "PO-322" });
  });
});

describe("outside a payment, the cart holds no shipping line", () => {
  const shippingLines = (cartId: string) => ep.linesWithSku(cartId, EP_SHIPPING_LINE_SKU);
  const PROMO_CART = [
    { product_id: "p-plus", sku: "p-plus-sub", quantity: 1, unit_price: { amount: 2200 } },
    {
      id: "promo-1",
      type: "promotion_item",
      sku: "TEST1",
      quantity: 1,
      unit_price: { amount: 0 },
      percentOff: 10,
    },
  ];

  it("shows the chosen rate in the checkout total, and leaves the cart at what its lines cost", async () => {
    const browser = new Browser(newCart());

    await readyToPay(browser);

    expect(browser.cookie?.totals).toEqual({
      subtotal: 2200,
      tax: 0,
      shipping: 599,
      total: 2799,
      currency: "USD",
    });
    expect(shippingLines(browser.cartId)).toEqual([]);
    expect(ep.total(browser.cartId)).toBe(2200);
  });

  it("prices a code that also takes off the shipping into the checkout total only", async () => {
    const browser = new Browser(newCart(PROMO_CART as any));

    await readyToPay(browser);

    expect(browser.cookie?.totals).toEqual({
      subtotal: 1980,
      tax: 0,
      shipping: 539,
      total: 2519,
      currency: "USD",
    });
    expect(shippingLines(browser.cartId)).toEqual([]);
    expect(ep.total(browser.cartId)).toBe(1980);

    const paid = await browser.pay({ gateway: "stripe", shownTotal: 2519 });

    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.charges).toEqual([2519]);
  });

  it("prices the shipping again when the cart changes in another tab, and still leaves no line", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    ep.setQuantity(browser.cartId, "p-plus-sub", 2);

    const read = await browser.get();

    expect(sessionIn(read).totals).toEqual({
      subtotal: 4400,
      tax: 0,
      shipping: 599,
      total: 4999,
      currency: "USD",
    });
    expect(sessionIn(read).selectedShippingRateId).toBe(RATE.id);
    expect(shippingLines(browser.cartId)).toEqual([]);

    const paid = await browser.pay({ gateway: "stripe", shownTotal: 4999 });

    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.charges).toEqual([4999]);
    expect(ep.paidOrders()[0].lines.filter((l) => l.sku === EP_SHIPPING_LINE_SKU)).toEqual([
      { sku: EP_SHIPPING_LINE_SKU, quantity: 1, amount: 599 },
    ]);
  });

  it("shows the new total with shipping when pay finds the cart changed, and leaves no line", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    ep.setQuantity(browser.cartId, "p-plus-sub", 2);

    const changed = await browser.pay({ gateway: "stripe", shownTotal: 2799 });

    expect((changed.body as any).error.code).toBe("CART_MISMATCH");
    expect(sessionIn(changed).totals).toEqual({
      subtotal: 4400,
      tax: 0,
      shipping: 599,
      total: 4999,
      currency: "USD",
    });
    expect(shippingLines(browser.cartId)).toEqual([]);
    expect(ep.charges).toEqual([]);
  });

  it("leaves no line after a declined card, and the next pay charges the total shown", async () => {
    registry.register("stripeDeclines", {
      paymentSequence: "cart_payment_intent",
      initializePayment: async () => ({
        status: "failed",
        errorMessage: "Your card was declined.",
      }),
    });
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const declined = await browser.pay({ gateway: "stripeDeclines", shownTotal: 2799 });

    expect((declined.body as any).paymentError).toBe("Your card was declined.");
    expect(shippingLines(browser.cartId)).toEqual([]);
    expect(ep.total(browser.cartId)).toBe(2200);

    const paid = await browser.pay({ gateway: "stripe", shownTotal: 2799 });

    expect(sessionIn(paid).status).toBe("complete");
    expect(ep.charges).toEqual([2799]);
  });

  it("leaves no line while a held card check is open, and the held order keeps the shipping", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);

    const held = await browser.pay({ gateway: "stripe3ds", shownTotal: 2799 });

    expect(sessionIn(held).payment.status).toBe("requires_action");
    expect(shippingLines(browser.cartId)).toEqual([]);
    expect(heldOrder().total).toBe(2799);
    expect(heldOrder().lines.filter((l) => l.sku === EP_SHIPPING_LINE_SKU)).toEqual([
      { sku: EP_SHIPPING_LINE_SKU, quantity: 1, amount: 599 },
    ]);

    ep.passChallenge(browser.pendingPaymentIntent());
    const resumed = await browser.resume();

    expect(sessionIn(resumed).status).toBe("complete");
    expect(ep.paidOrders().map((o) => o.total)).toEqual([2799]);
  });

  it("leaves no line after the shopper abandons a card check", async () => {
    const browser = new Browser(newCart());
    await readyToPay(browser);
    await browser.pay({ gateway: "stripe3ds", shownTotal: 2799 });

    const abandoned = await browser.abandon();

    expect(abandoned.status).toBe(200);
    expect(shippingLines(browser.cartId)).toEqual([]);
    expect(ep.total(browser.cartId)).toBe(2200);
  });

  it("keeps a rate it could not price unchosen, and the total without it", async () => {
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

    const refused = await browser.update({ selectedShippingRateId: RATE.id });

    expect(refused.status).toBe(502);
    expect((refused.body as any).error.code).toBe("SHIPPING_NOT_APPLIED");
    expect(sessionIn(refused).selectedShippingRateId).toBeNull();
    expect(sessionIn(refused).totals).toEqual({
      subtotal: 2200,
      tax: 0,
      shipping: 0,
      total: 2200,
      currency: "USD",
    });
    expect(browser.cookie?.selectedShippingRateId).toBeNull();
    expect(shippingLines(browser.cartId)).toEqual([]);

    const chosen = await browser.update({ selectedShippingRateId: RATE.id });

    expect(sessionIn(chosen).totals.total).toBe(2799);
  });

  it("takes out a shipping line an earlier checkout left in the cart when checkout starts", async () => {
    const browser = new Browser(
      newCart([
        { product_id: "p-plus", sku: "p-plus-sub", quantity: 1, unit_price: { amount: 2200 } },
        {
          type: "custom_item",
          sku: EP_SHIPPING_LINE_SKU,
          name: "Standard",
          quantity: 1,
          unit_price: { amount: 599 },
        } as any,
      ])
    );

    const created = await browser.create();

    expect(sessionIn(created).totals).toEqual({
      subtotal: 2200,
      tax: 0,
      shipping: 0,
      total: 2200,
      currency: "USD",
    });
    expect(shippingLines(browser.cartId)).toEqual([]);
    expect(ep.total(browser.cartId)).toBe(2200);
  });
});
