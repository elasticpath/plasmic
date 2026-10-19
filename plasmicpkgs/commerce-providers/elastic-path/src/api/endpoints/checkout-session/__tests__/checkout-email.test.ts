/**
 * The checkout email through the real session handlers against an in-memory
 * Elastic Path store. The two lists are Elastic Path's verdicts on its
 * checkout `customer.email`, measured on the integration store.
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
const { handlePay } = require("../pay") as typeof import("../pay");
const { createAdapterRegistry } =
  require("../../../../checkout/session/adapter-registry") as typeof import("../../../../checkout/session/adapter-registry");
const { createManualAdapter } =
  require("../../../../checkout/session/adapters/manual-adapter") as typeof import("../../../../checkout/session/adapters/manual-adapter");
const { FakeEpStore } =
  require("../../../../checkout/session/__tests__/fake-ep-store") as typeof import("../../../../checkout/session/__tests__/fake-ep-store");
/* eslint-enable @typescript-eslint/no-var-requires */

import type {
  AdapterRegistry,
  CheckoutSession,
  SessionHandlerContext,
  SessionResponse,
  SessionShippingRate,
} from "../../../../checkout/session/types";

const ACCEPTED_BY_EP = [
  "probe@example.com",
  "probe+tag@example.com",
  "first.last@example.co.uk",
  "probe@example.photography",
  "probe@example.technology",
  "probe@sub.domain.example.com",
  "PROBE@EXAMPLE.COM",
  "probe_1-2@example-site.com",
  "o'brien@example.com",
  "probe@localhost",
  "probe@example",
  "probe@123.123.123.123",
  "probe@[123.123.123.123]",
  "\"quoted local\"@example.com",
  "Probe Shopper <probe@example.com>",
  "<probe@example.com>",
  "user%example.org@example.com",
  "x@example.com",
  "a!#$%&*/=?^`{|}~@example.com",
  "probe@-example.com",
  "probe@example-.com",
  "probe@exa_mple.com",
  " probe@example.com",
  "probe@example.com ",
  "probe@example.com\t",
  "üser@example.com",
  "probe@exämple.com",
  "probe@xn--exmple-cua.com",
  "用户@例子.广告",
  "δοκιμή@παράδειγμα.δοκιμή",
  "probe@example.c",
  "probe@example.123",
  "probe@example.com (comment)",
  "probe@example.com(c)",
  "\"a@b\"@example.com",
  "\"a\\\"b\"@example.com",
  "\"Probe, Shopper\" <probe@example.com>",
  "Probe.Shopper <probe@example.com>",
  "=?utf-8?q?J=C3=B6rg?= <probe@example.com>",
  "Jörg <probe@example.com>",
  "Name<probe@example.com>",
  "a\u00a0b@example.com",
  "probe@example.com\u00a0",
  "\u00a0probe@example.com",
  "probe@exam\u200bple.com",
  "😀@example.com",
  "probe@😀.com",
  "\tprobe@example.com",
  "probe@ex/ample.com",
  "a@b",
  "-@-",
  "\ufeffprobe@example.com",
  "probe@example.com\u2028",
  "pro\u3000be@example.com",
  "\u3000probe@example.com",
  "probe@ example.com",
  "probe@\texample.com",
  "Group: probe@example.com;",
  "probe@[::1]",
  "\"probe\"@example.com",
  "Name <probe@example.com> (c)",
  "probe@example.com(c(d))",
  "\"a\" <probe@example.com>",
  "probe@[1.2.3.4] ",
  "a.b.c@d.e.f",
  "Name (c) <probe@example.com>",
  "Name < probe@example.com>",
  "Name <probe@ example.com>",
  "\"a\tb\"@example.com",
  "\"a\\\\b\"@example.com",
  "probe@example.com (=?utf-8?q?x?=)",
  "Probe. Shopper <probe@example.com>",
  "Probe..Shopper <probe@example.com>",
  ".Probe <probe@example.com>",
  "Name: <probe@example.com>;",
];

const REFUSED_BY_EP = [
  "probe@example.com.",
  "probe.@example.com",
  ".probe@example.com",
  "pro..be@example.com",
  "probe@.example.com",
  "probe@example..com",
  "noat.example.com",
  "@example.com",
  "probe@",
  "probe@@example.com",
  "pro@be@example.com",
  "a b@example.com",
  "probe @example.com",
  "probe@exa mple.com",
  "",
  "probe(comment)@example.com",
  "a@b.co,c@d.co",
  "probe;x@example.com",
  "probe\\@x@example.com",
  "probe\n@example.com",
  "(c) probe@example.com",
  "probe@(c)example.com",
  "probe@example(c).com",
  "probe@example.com (c) x",
  "\"unterminated@example.com",
  "\"\"@example.com",
  "a.\"b\"@example.com",
  "Name <probe@example.com",
  "Name probe@example.com>",
  "<a b@example.com>",
  "<probe@example.com> x",
  "Name <probe@example.com.>",
  "<>",
  "Name <>",
  "<@example.com>",
  "<<probe@example.com>>",
  "probe@[1.2.3.4",
  "probe@[a b]",
  "probe@[]",
  "probe@[IPv6:::1]",
  "probe@example.com\r\n",
  "\r\nprobe@example.com",
  "probe@example.com\n",
  "pro\tbe@example.com",
  "probe@example.com,",
  "probe@example.com;",
  "probe@example.com>",
  "probe@example.com:",
  "pro:be@example.com",
  "probe@exa:mple.com",
  "pro]be@example.com",
  "pro\u0001be@example.com",
  "probe@example.com\u0000",
  ".@x",
  "a@.",
  "probe @ example.com",
  "probe\t@example.com",
  "Group:;",
  "Group: a@b.co, c@d.co;",
  "Group: probe@example.com",
  "probe@[01.2.3.4]",
  "probe@[256.1.1.1]",
  "probe@example.com(unclosed",
  "probe@example.com)",
  "=?foo?q?x?= <probe@example.com>",
  "Name <probe@example.com>, other",
  "Name <probe@example.com >",
  "Name <probe @example.com>",
  "\"a b\" @example.com",
  "\"Probe\" probe@example.com",
];

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
let orderEmails: string[];

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

  create(): Promise<SessionResponse> {
    return handleCreateSession({ body: {}, headers: {}, cookies: {} }, this.ctx());
  }

  update(body: Record<string, unknown>): Promise<SessionResponse> {
    return handleUpdateSession({ body, headers: {}, cookies: {} }, this.ctx());
  }

  pay(gateway: string): Promise<SessionResponse> {
    return handlePay({ body: { gateway }, headers: {}, cookies: {} }, this.ctx());
  }
}

function newBrowser(): Browser {
  const cartId = `cart-${ep.carts.size + 1}`;
  ep.addCart(cartId, [
    { product_id: "p-plus", sku: "p-plus-sub", quantity: 1, unit_price: { amount: 2200 } },
  ]);
  return new Browser(cartId);
}

async function readyToPay(browser: Browser, email: string): Promise<void> {
  expect((await browser.create()).status).toBe(201);
  const details = await browser.update({
    customerInfo: { name: "Walk Tester", email },
    billingAddress: ADDRESS,
    shippingAddress: ADDRESS,
  });
  expect(details.status).toBe(200);
  expect((await browser.update({ selectedShippingRateId: RATE.id })).status).toBe(200);
}

function errorOf(res: SessionResponse): { code?: string; message?: string } {
  return (res.body as any).error ?? {};
}

beforeEach(() => {
  ep = new FakeEpStore();
  orderEmails = [];
  for (const key of Object.keys(sdkImpl)) delete sdkImpl[key];
  const sdk = ep.sdk();
  Object.assign(sdkImpl, sdk, {
    checkoutApi: async (args: any) => {
      const email = args.body?.data?.customer?.email;
      if (REFUSED_BY_EP.includes(email)) {
        return {
          error: {
            errors: [
              {
                status: 400,
                source: "data.customer.email",
                title: "format",
                detail: "Does not match format 'email'",
              },
            ],
          },
          response: { status: 400 },
        };
      }
      const res = await sdk.checkoutApi(args);
      if (res.data) orderEmails.push(email);
      return res;
    },
  });
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
});

describe("the checkout email", () => {
  it.each(REFUSED_BY_EP.map((email) => [JSON.stringify(email), email]))(
    "is refused when the checkout is updated with %s, and nothing is saved",
    async (_label, email) => {
      const browser = newBrowser();
      await browser.create();

      const res = await browser.update({
        customerInfo: { name: "Walk Tester", email },
        billingAddress: ADDRESS,
      });

      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe("INVALID_EMAIL");
      expect(errorOf(res).message).toBe(
        "Enter a valid email address, such as name@example.com."
      );
      expect(browser.cookie!.customerInfo).toBeNull();
      expect(browser.cookie!.billingAddress).toBeNull();
    }
  );

  it.each(ACCEPTED_BY_EP.map((email) => [JSON.stringify(email), email]))(
    "is saved when the checkout is updated with %s, which Elastic Path accepts",
    async (_label, email) => {
      const browser = newBrowser();
      await browser.create();

      const res = await browser.update({
        customerInfo: { name: "Walk Tester", email },
      });

      expect(res.status).toBe(200);
      expect(browser.cookie!.customerInfo).toEqual({ name: "Walk Tester", email });
    }
  );

  it.each([null, undefined, 42, {}])(
    "is refused when the checkout is updated with a customer whose email is %p",
    async (email) => {
      const browser = newBrowser();
      await browser.create();

      const res = await browser.update({ customerInfo: { name: "Walk Tester", email } });

      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe("INVALID_EMAIL");
      expect(browser.cookie!.customerInfo).toBeNull();
    }
  );

  it("can still be cleared with the rest of the customer", async () => {
    const browser = newBrowser();
    await readyToPay(browser, "walk@example.com");

    const res = await browser.update({ customerInfo: null });

    expect(res.status).toBe(200);
    expect(browser.cookie!.customerInfo).toBeNull();
  });

  it.each(["stripe", "manual"])(
    "already in the session but refused by Elastic Path stops %s pay before any charge or order",
    async (gateway) => {
      const browser = newBrowser();
      await readyToPay(browser, "walk@example.com");
      browser.cookie!.customerInfo = { name: "Walk Tester", email: "a b@example.com" };

      const res = await browser.pay(gateway);

      expect(errorOf(res)).toEqual({
        code: "INVALID_EMAIL",
        message: "Enter a valid email address, such as name@example.com.",
      });
      expect(res.status).toBe(400);
      expect(ep.charges).toEqual([]);
      expect(ep.orders).toEqual([]);
      expect(browser.cookie!.status).toBe("open");
    }
  );

  it("lets the shopper pay after correcting a refused email", async () => {
    const browser = newBrowser();
    await readyToPay(browser, "walk@example.com");
    browser.cookie!.customerInfo = { name: "Walk Tester", email: "probe@example.com." };
    expect((await browser.pay("stripe")).status).toBe(400);

    await browser.update({ customerInfo: { name: "Walk Tester", email: "walk@example.com" } });
    const res = await browser.pay("stripe");

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    expect(ep.charges).toEqual([2799]);
    expect(orderEmails).toEqual(["walk@example.com"]);
  });

  it.each([
    "walk+orders@example.com",
    "Walk.Tester@example.photography",
    "üser@exämple.com",
    "用户@例子.广告",
    "o'brien@example.com",
  ])("pays for an order with %s", async (email) => {
    const browser = newBrowser();
    await readyToPay(browser, email);

    const res = await browser.pay("stripe");

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    expect(orderEmails).toEqual([email]);
  });
});
