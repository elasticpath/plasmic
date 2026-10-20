/**
 * @jest-environment jsdom
 *
 * A checkout page and a cart page in one browser, against the real checkout
 * session routes and the storefront proxy over an in-memory Elastic Path
 * store. Every request the page sends and every answer it gets is recorded.
 */
const sdkImpl: Record<string, (...args: any[]) => any> = {};

// The fake store yields with setImmediate, which jsdom does not provide.
(globalThis as any).setImmediate ??= (fn: () => void) => setTimeout(fn, 0);

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
      names.map((name) => [name, (...args: unknown[]) => sdkImpl[name](...args)])
    ),
    createShopperClient: jest.fn(
      require("./fake-shopper-client").fakeShopperClient
    ),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockStripeJs = require("../../stripe/__tests__/fake-stripe-js").createFakeStripeJs();
jest.mock("../../stripe/load-stripe-js", () => ({
  loadStripeJs: () => mockStripeJs.load(),
}));

jest.mock("@plasmicapp/host", () => ({
  ...jest.requireActual("@plasmicapp/host"),
  usePlasmicCanvasContext: () => undefined,
}));

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mutate, SWRConfig } from "swr";

/* eslint-disable @typescript-eslint/no-var-requires */
const { useDataEnv } = require("@plasmicapp/host") as typeof import("@plasmicapp/host");
const { handleCreateSession, handleGetSession, handleUpdateSession, handlePay } =
  require("../../../api/endpoints/checkout-session") as typeof import("../../../api/endpoints/checkout-session");
const { createAdapterRegistry } =
  require("../adapter-registry") as typeof import("../adapter-registry");
const { createManualAdapter } =
  require("../adapters/manual-adapter") as typeof import("../adapters/manual-adapter");
const { EP_SHIPPING_LINE_SKU } =
  require("../set-shipping-line") as typeof import("../set-shipping-line");
const { FakeEpStore } = require("./fake-ep-store") as typeof import("./fake-ep-store");
const { normalizeCart } = require("../../../utils/normalize") as typeof import("../../../utils/normalize");
const { epCartCacheKey } = require("../../../cart-provider/cache-keys") as typeof import("../../../cart-provider/cache-keys");
const { EPCheckoutSessionProvider } =
  require("../EPCheckoutSessionProvider") as typeof import("../EPCheckoutSessionProvider");
const { EPStripePayment } = require("../EPStripePayment") as typeof import("../EPStripePayment");
const { EPCheckoutFormProvider } =
  require("../../composable/EPCheckoutFormProvider") as typeof import("../../composable/EPCheckoutFormProvider");
const { EPFormField } = require("../../composable/EPFormField") as typeof import("../../composable/EPFormField");
const { EPPlaceOrderButton } =
  require("../../composable/EPPlaceOrderButton") as typeof import("../../composable/EPPlaceOrderButton");
const { EPPromoCodeInput } =
  require("../../composable/EPPromoCodeInput") as typeof import("../../composable/EPPromoCodeInput");
const { EPCheckoutShippingRates } =
  require("../EPCheckoutShippingRates") as typeof import("../EPCheckoutShippingRates");
const { EPOrderTotalsBreakdown } =
  require("../../composable/EPOrderTotalsBreakdown") as typeof import("../../composable/EPOrderTotalsBreakdown");
const { EPCartProvider } = require("../../../cart-provider/EPCartProvider") as typeof import("../../../cart-provider/EPCartProvider");
const { EPCartItemList } = require("../../../cart-drawer/EPCartItemList") as typeof import("../../../cart-drawer/EPCartItemList");
const { EPCartItemField } = require("../../../cart-drawer/EPCartItemField") as typeof import("../../../cart-drawer/EPCartItemField");
const { EPCartField } = require("../../../cart-drawer/EPCartField") as typeof import("../../../cart-drawer/EPCartField");
/* eslint-enable @typescript-eslint/no-var-requires */

import type {
  AdapterRegistry,
  CheckoutSession,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
} from "../types";

const RATE = { id: "standard", name: "Standard Shipping", amount: 599, currency: "USD" };
const ADDRESS = {
  firstName: "Walk",
  lastName: "Tester",
  line1: "1 Test St",
  city: "Boston",
  country: "US",
  postcode: "02110",
};

interface Exchange {
  method: string;
  url: string;
  body: any;
  status: number;
  response: any;
}

let ep: InstanceType<typeof FakeEpStore>;
let registry: AdapterRegistry;
let cookie: CheckoutSession | null;
let cartId: string;
let exchanges: Exchange[];
let declineNext: boolean;
let beforePay: (() => void) | null;

const clone = <T,>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

function ctx(): SessionHandlerContext {
  const sent = clone(cookie);
  return {
    epCredentials: { clientId: "client", apiBaseUrl: "https://api.test.com" },
    adapterRegistry: registry,
    sessionStore: {
      get: async () => clone(sent),
      set: async (_id, session) => {
        cookie = clone(session);
        return { headers: { "Set-Cookie": "ep_cs=sealed; Path=/" } };
      },
      delete: async () => {
        cookie = null;
        return { headers: {} };
      },
    },
    shopperAccessToken: "shopper-token",
    sessionCartId: cartId,
    getClientCredentialsToken: async () => "admin-token",
    shippingRateResolver: () => [RATE],
  };
}

const req = (body: Record<string, unknown>): SessionRequest => ({
  body,
  headers: {},
  cookies: {},
});

async function shopperCart() {
  const read = await sdkImpl.getACart({ path: { cartID: cartId } });
  return normalizeCart(read.data);
}

async function route(method: string, url: string, body: any): Promise<SessionResponse> {
  switch (`${method} ${url}`) {
    case "POST /api/checkout/sessions":
      return handleCreateSession(req(body), ctx());
    case "GET /api/checkout/sessions/current":
      return handleGetSession(req({}), ctx());
    case "PATCH /api/checkout/sessions/current":
      return handleUpdateSession(req(body), ctx());
    case "POST /api/checkout/sessions/current/pay": {
      const hook = beforePay;
      beforePay = null;
      hook?.();
      return handlePay(req(body), ctx());
    }
    case "POST /api/ep/proxy/getCart":
      return { status: 200, body: await shopperCart() };
    case "POST /api/ep/proxy/applyPromoCode":
      ep.applyPromotion(cartId, body.code, body.code === "FREE" ? 100 : 10);
      return { status: 200, body: await shopperCart() };
    default:
      return { status: 404, body: { error: `no route ${method} ${url}` } };
  }
}

const browserFetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const res = await route(method, url, body);
  exchanges.push({ method, url, body, status: res.status, response: clone(res.body) });
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    json: async () => clone(res.body),
  } as unknown as Response;
});

function sent(method: string, path: string): Exchange[] {
  return exchanges.filter((e) => e.method === method && e.url === path);
}

const GET_CURRENT = "/api/checkout/sessions/current";
const PAY = "/api/checkout/sessions/current/pay";

/** What a designer binds from `$ctx.checkoutSession`, shown as text. */
function SessionProbe() {
  const env = useDataEnv() as any;
  const cs = env?.checkoutSession;
  return (
    <div data-testid="probe">
      {JSON.stringify({
        status: cs?.session?.status ?? null,
        total: cs?.session?.totals?.total ?? null,
        error: cs?.error ?? null,
        errorCode: cs?.errorCode ?? null,
      })}
    </div>
  );
}

function probe() {
  return JSON.parse(screen.getByTestId("probe").textContent || "{}");
}

function newCart(lines: Array<Record<string, unknown>>): string {
  const id = `cart-${Math.random().toString(36).slice(2, 8)}`;
  ep.addCart(id, lines as never);
  return id;
}

const PRODUCT = {
  product_id: "p-plus",
  sku: "p-plus-sub",
  name: "PlayStation Plus",
  quantity: 1,
  unit_price: { amount: 2200 },
};

/** The shopper filled the checkout and picked the $5.99 rate (as the page does). */
async function readyToPay(): Promise<void> {
  expect((await handleCreateSession(req({}), ctx())).status).toBe(201);
  await handleUpdateSession(
    req({
      customerInfo: { name: "Walk Tester", email: "walk@example.com" },
      billingAddress: ADDRESS,
      shippingAddress: ADDRESS,
    }),
    ctx()
  );
  expect(
    (await handleUpdateSession(req({ selectedShippingRateId: RATE.id }), ctx())).status
  ).toBe(200);
  expect(cookie?.totals?.total).toBe(2799);
}

function renderCheckout(children: React.ReactNode, ref?: React.Ref<any>) {
  return render(
    <SWRConfig value={{ dedupingInterval: 0 }}>
      <EPCheckoutSessionProvider ref={ref}>
        <SessionProbe />
        {children}
      </EPCheckoutSessionProvider>
    </SWRConfig>
  );
}

beforeEach(async () => {
  ep = new FakeEpStore();
  for (const key of Object.keys(sdkImpl)) delete sdkImpl[key];
  Object.assign(sdkImpl, ep.sdk());
  cookie = null;
  exchanges = [];
  declineNext = false;
  beforePay = null;
  mockStripeJs.reset();
  registry = createAdapterRegistry();
  registry.register("manual", createManualAdapter({ allow: () => true }));
  registry.register("stripe", {
    paymentSequence: "cart_payment_intent",
    initializePayment: async (s: CheckoutSession) => {
      if (declineNext) {
        declineNext = false;
        return {
          status: "failed",
          errorMessage: "Payment did not complete (Your card was declined.)",
        };
      }
      const pi = await ep.chargeCart(s.cartId);
      return {
        status: "succeeded",
        gatewayOrderId: pi,
        gatewayMetadata: { paymentIntentId: pi, amount: ep.paymentIntents.get(pi)!.amount },
      };
    },
  });
  browserFetch.mockClear();
  global.fetch = browserFetch as any;
  await mutate(epCartCacheKey(), undefined, false);
  await mutate(GET_CURRENT, undefined, false);
});

describe("checkout page totals follow the cart", () => {
  it("goes free as soon as a 100% code is applied on the page: no card field, and the first Place settles it", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    const ref = React.createRef<any>();

    renderCheckout(
      <>
        <EPPromoCodeInput />
        <EPStripePayment publishableKey="pk_test_walk" />
      </>,
      ref
    );

    await waitFor(() => expect(probe().total).toBe(2799));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("Promo code"), {
      target: { value: "FREE" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    await waitFor(() => expect(probe().total).toBe(0));
    await waitFor(() =>
      expect(document.querySelector('[data-ep-payment-free="true"]')).not.toBeNull()
    );
    expect(screen.queryByTestId("stripe-payment-element")).toBeNull();
    const applied = exchanges.findIndex((e) => e.url === "/api/ep/proxy/applyPromoCode");
    const reread = exchanges.findIndex(
      (e, i) => i > applied && e.method === "GET" && e.url === GET_CURRENT
    );
    expect(reread).toBeGreaterThan(applied);
    expect(exchanges[reread].response.data.session.totals).toMatchObject({
      subtotal: 0,
      shipping: 0,
      total: 0,
    });
    expect(sent("POST", PAY)).toEqual([]);

    let placed: any;
    await act(async () => {
      placed = await ref.current.placeOrder();
    });

    expect(sent("POST", PAY).map((e) => [e.body, e.status])).toEqual([
      [{ gateway: "manual", shownTotal: 0 }, 200],
    ]);
    expect(placed.data.session.status).toBe("complete");
    expect(exchanges.filter((e) => e.status === 409)).toEqual([]);
    expect(ep.charges).toEqual([]);

    // The order placed on this page stays on it: no new checkout is started.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(probe()).toMatchObject({ status: "complete", total: 0, error: null });
    expect(sent("POST", "/api/checkout/sessions")).toEqual([]);
  });

  it("picks up a change made in another tab when the page gets focus, and charges that total on the first Place", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    const ref = React.createRef<any>();

    renderCheckout(<EPStripePayment publishableKey="pk_test_walk" />, ref);
    await waitFor(() => expect(probe().total).toBe(2799));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());

    ep.setQuantity(cartId, "p-plus-sub", 2);
    const before = exchanges.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(probe().total).toBe(4999));
    expect(
      exchanges
        .slice(before)
        .filter((e) => e.method === "GET" && e.url === GET_CURRENT)
        .map((e) => e.response.data.session.totals.total)
    ).toContain(4999);

    let placed: any;
    await act(async () => {
      placed = await ref.current.placeOrder();
    });

    expect(sent("POST", PAY).map((e) => [e.body.shownTotal, e.status])).toEqual([[4999, 200]]);
    expect(placed.data.session.status).toBe("complete");
    expect(ep.charges).toEqual([4999]);
  });
});

describe("a cart that changes on the way to payment", () => {
  it("shows the total the storefront refreshed after CART_MISMATCH, starts no new checkout, and charges it on the next Place", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    const ref = React.createRef<any>();

    renderCheckout(
      <>
        <div data-testid="totals">
          <EPOrderTotalsBreakdown />
        </div>
        <EPStripePayment publishableKey="pk_test_walk" />
      </>,
      ref
    );
    await waitFor(() => expect(probe().total).toBe(2799));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());

    beforePay = () => ep.setQuantity(cartId, "p-plus-sub", 2);
    let first: any;
    await act(async () => {
      first = await ref.current.placeOrder();
    });

    expect(first.error.code).toBe("CART_MISMATCH");
    await waitFor(() => expect(screen.getByTestId("totals").textContent).toMatch(/Total\$49\.99/));
    expect(sent("POST", "/api/checkout/sessions")).toEqual([]);
    expect(ep.charges).toEqual([]);

    await act(async () => {
      await ref.current.placeOrder();
    });

    expect(sent("POST", PAY).map((e) => [e.body.shownTotal, e.status])).toEqual([
      [2799, 409],
      [4999, 200],
    ]);
    expect(ep.charges).toEqual([4999]);
  });
});

describe("checkout page on an empty cart", () => {
  function renderPayPage() {
    renderCheckout(
      <EPCheckoutFormProvider requiresShipping>
        <EPFormField name="email" label="Email" />
        <div data-testid="totals">
          <EPOrderTotalsBreakdown />
        </div>
        <EPStripePayment publishableKey="pk_test_walk" />
        <EPPlaceOrderButton />
      </EPCheckoutFormProvider>
    );
  }

  async function pressPlace() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Place your order" }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it("shows the empty cart as soon as another tab empties it, with no total and no card field", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    renderPayPage();
    await waitFor(() => expect(screen.getByTestId("totals").textContent).toMatch(/\$27\.99/));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());

    ep.cart(cartId).lines = [];
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(probe().errorCode).toBe("EMPTY_CART"));
    expect(probe()).toEqual({ status: null, total: null, error: "Your cart is empty", errorCode: "EMPTY_CART" });
    expect(screen.getByTestId("totals").textContent).toBe("");
    expect(screen.queryByTestId("stripe-payment-element")).toBeNull();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "walk@example.com" },
    });
    await pressPlace();

    expect(screen.getByRole("alert").textContent).toBe("Your cart is empty");
    expect(sent("POST", PAY)).toEqual([]);
    expect(ep.charges).toEqual([]);
  });

  it("shows the empty cart when the page opens on a checkout whose cart was emptied", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    ep.cart(cartId).lines = [];

    renderPayPage();

    await waitFor(() => expect(probe().errorCode).toBe("EMPTY_CART"));
    expect(screen.getByTestId("totals").textContent).toBe("");
    expect(screen.queryByTestId("stripe-payment-element")).toBeNull();
    await pressPlace();
    expect(sent("POST", PAY)).toEqual([]);
  });

  it("shows the checkout again, with the new total, when the cart has something in it again", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    const product = ep.cart(cartId).lines;
    ep.cart(cartId).lines = [];
    renderPayPage();
    await waitFor(() => expect(probe().errorCode).toBe("EMPTY_CART"));

    ep.cart(cartId).lines = product;
    ep.setQuantity(cartId, "p-plus-sub", 2);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(probe()).toMatchObject({ status: "open", total: 4999, errorCode: null }));
    expect(screen.getByTestId("totals").textContent).toBe(
      "Subtotal$44.00Shipping$5.99Tax$0.00Total$49.99"
    );
  });

  it("drops the finished checkout, says the cart is empty, and sends nothing when the shopper presses Place", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    expect((await handlePay(req({ gateway: "manual" }), ctx())).status).toBe(200);
    expect(cookie?.status).toBe("complete");
    cartId = newCart([]);

    renderCheckout(
      <EPCheckoutFormProvider requiresShipping>
        <EPFormField name="email" label="Email" />
        <EPStripePayment publishableKey="pk_test_walk" />
        <EPPlaceOrderButton />
      </EPCheckoutFormProvider>
    );

    await waitFor(() =>
      expect(probe()).toEqual({
        status: null,
        total: null,
        error: "Your cart is empty",
        errorCode: "EMPTY_CART",
      })
    );
    expect(sent("POST", "/api/checkout/sessions").map((e) => e.status)).toEqual([409]);
    expect(screen.getByRole("alert").textContent).toBe("Your cart is empty");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByTestId("stripe-payment-element")).toBeNull();

    const before = exchanges.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Place your order" }));
    });

    expect(exchanges.slice(before).filter((e) => e.method !== "GET")).toEqual([]);
    expect(screen.getByRole("alert").textContent).toBe("Your cart is empty");
  });

  it("starts the checkout once the cart has something in it again", async () => {
    cartId = newCart([]);

    renderCheckout(null);
    await waitFor(() => expect(probe().errorCode).toBe("EMPTY_CART"));

    ep.cart(cartId).lines.push({
      id: "line-new",
      type: "cart_item",
      sku: "p-plus-sub",
      product_id: "p-plus",
      quantity: 1,
      unit_price: { amount: 2200 },
      value: { amount: 2200 },
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(probe()).toEqual({ status: "open", total: 2200, error: null, errorCode: null })
    );
  });
});

describe("checkout page for a new visitor with no cart", () => {
  const SHIPPING_FIELDS: Array<[string, string, string]> = [
    ["shippingFirstName", "First name", ADDRESS.firstName],
    ["shippingLastName", "Last name", ADDRESS.lastName],
    ["shippingAddress", "Street", ADDRESS.line1],
    ["shippingCity", "City", ADDRESS.city],
    ["shippingPostal", "Postal code", ADDRESS.postcode],
    ["shippingCountry", "Country", ADDRESS.country],
  ];

  function renderPage() {
    renderCheckout(
      <EPCheckoutFormProvider requiresShipping>
        <EPFormField name="email" label="Email" />
        {SHIPPING_FIELDS.map(([name, label]) => (
          <EPFormField key={name} name={name} label={label} />
        ))}
        <EPCheckoutShippingRates />
        <div data-testid="totals">
          <EPOrderTotalsBreakdown />
        </div>
        <EPPlaceOrderButton />
      </EPCheckoutFormProvider>
    );
  }

  function fill() {
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "walk@example.com" },
    });
    for (const [, label, value] of SHIPPING_FIELDS) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
  }

  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

  it("says the cart is empty in shopper words, and shows no totals", async () => {
    cartId = undefined as unknown as string;
    renderPage();

    await waitFor(() => expect(probe().errorCode).toBe("NO_CART"));
    expect(probe().error).toBe("Your cart is empty");
    expect(screen.getByRole("alert").textContent).toBe("Your cart is empty");
    expect(screen.getByTestId("totals").textContent).toBe("");
    expect(screen.getByTestId("totals").textContent).not.toMatch(/\$/);
  });

  it("drops the refusal and quotes shipping for the typed address once the cart has something in it", async () => {
    cartId = undefined as unknown as string;
    renderPage();
    await waitFor(() => expect(probe().errorCode).toBe("NO_CART"));

    fill();
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Place your order" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Your cart is empty");
    expect(exchanges.filter((e) => e.method !== "GET" && e.url !== "/api/checkout/sessions")).toEqual([]);

    cartId = newCart([PRODUCT]);
    const before = exchanges.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(probe()).toMatchObject({ status: "open", errorCode: null }));
    await settle();

    expect(screen.queryByRole("alert")).toBeNull();
    const patches = exchanges
      .slice(before)
      .filter((e) => e.method === "PATCH" && e.url === GET_CURRENT);
    expect(patches.map((e) => [e.body.shippingAddress?.postcode, e.status])).toEqual([
      ["02110", 200],
    ]);
    await waitFor(() =>
      expect(document.querySelector("[data-ep-checkout-shipping-rates]")?.textContent).toMatch(
        /Standard Shipping/
      )
    );
    expect(screen.queryByText("No shipping rates available")).toBeNull();
    expect(sent("POST", PAY)).toEqual([]);
  });

  it("keeps a missing-field message when the cart arrives", async () => {
    cartId = undefined as unknown as string;
    renderCheckout(
      <EPCheckoutFormProvider requiresShipping>
        <EPFormField name="email" label="Email" required />
        <EPPlaceOrderButton />
      </EPCheckoutFormProvider>
    );
    await waitFor(() => expect(probe().errorCode).toBe("NO_CART"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Place your order" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Please complete the required fields.");

    cartId = newCart([PRODUCT]);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(probe()).toMatchObject({ status: "open", errorCode: null }));

    expect(screen.getByRole("alert").textContent).toBe("Please complete the required fields.");
  });
});

describe("the cart page in 0.8.0 components on this storefront", () => {
  /**
   * What EP Cart Field 0.8.0 shows for a saved field and what its EP Cart Item
   * List lists: Elastic Path's `meta` and every line in `items`
   * (src/cart-drawer/EPCartField.tsx at ba8b94466).
   */
  async function cartPage080() {
    const cart = (await route("POST", "/api/ep/proxy/getCart", {})).body as any;
    const price = cart.meta?.display_price;
    return {
      lines: cart.items.map((i: any) => i.name ?? i.sku),
      itemCount: cart.itemCount,
      formattedSubtotal: price?.without_tax?.formatted,
      formattedTotal: price?.with_tax?.formatted ?? price?.without_tax?.formatted,
    };
  }

  it("shows a total its listed lines add up to after an unfinished checkout", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();

    expect(await cartPage080()).toEqual({
      lines: ["PlayStation Plus"],
      itemCount: 1,
      formattedSubtotal: "$22.00",
      formattedTotal: "$22.00",
    });
  });

  it("shows a total its listed lines add up to after an unfinished checkout with a code", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    ep.applyPromotion(cartId, "TEST1", 10);
    await handleGetSession(req({}), ctx());
    expect(cookie?.totals?.total).toBe(2519);

    expect(await cartPage080()).toEqual({
      lines: ["PlayStation Plus"],
      itemCount: 1,
      formattedSubtotal: "$19.80",
      formattedTotal: "$19.80",
    });
  });

  it("shows a total its listed lines add up to after a declined card", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    declineNext = true;
    await handlePay(req({ gateway: "stripe", shownTotal: 2799 }), ctx());

    expect(await cartPage080()).toEqual({
      lines: ["PlayStation Plus"],
      itemCount: 1,
      formattedSubtotal: "$22.00",
      formattedTotal: "$22.00",
    });
  });
});

describe("after a declined card", () => {
  it("shows the decline on the page without a binding", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    declineNext = true;

    renderCheckout(
      <EPCheckoutFormProvider requiresShipping>
        <EPFormField name="email" label="Email" fieldId="email" />
        <EPStripePayment publishableKey="pk_test_walk" />
        <EPPlaceOrderButton />
      </EPCheckoutFormProvider>
    );
    await waitFor(() => expect(probe().total).toBe(2799));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());
    fireEvent.change(document.getElementById("email")!, {
      target: { value: "walk@example.com" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Place your order" }));
    });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Payment did not complete (Your card was declined.)"
      )
    );
    expect(ep.linesWithSku(cartId, EP_SHIPPING_LINE_SKU)).toEqual([]);
  });

  it("lists only what the shopper bought on the cart page, with a count and total that add up", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    ep.applyPromotion(cartId, "TEST1", 10);
    await handleGetSession(req({}), ctx());
    declineNext = true;
    const declined = await handlePay(req({ gateway: "stripe", shownTotal: 2519 }), ctx());
    expect((declined.body as any).paymentError).toMatch(/declined/);
    expect(ep.linesWithSku(cartId, EP_SHIPPING_LINE_SKU)).toEqual([]);
    expect(ep.total(cartId)).toBe(1980);

    render(
      <SWRConfig value={{ dedupingInterval: 0 }}>
        <EPCartProvider>
          <EPCartItemList>
            <div data-testid="line">
              <EPCartItemField field="name" />
            </div>
          </EPCartItemList>
          <span data-testid="count">
            <EPCartField field="itemCount" />
          </span>
          <span data-testid="total">
            <EPCartField field="formattedTotal" />
          </span>
        </EPCartProvider>
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getAllByTestId("line")).toHaveLength(1));
    expect(screen.getByTestId("line").textContent).toBe("PlayStation Plus");
    expect(screen.queryByText("Standard Shipping")).toBeNull();
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByTestId("total").textContent).toBe("$19.80");
  });
});

describe("a reload while a card check is open", () => {
  it("shows the saved details in the locked form, read-only, and sends no update", async () => {
    cartId = newCart([PRODUCT]);
    await readyToPay();
    cookie = {
      ...cookie!,
      payment: {
        ...cookie!.payment,
        gateway: "stripe",
        status: "requires_action",
        clientToken: "pi_walk_secret",
      },
      order: { id: "order-held" },
    };

    renderCheckout(
      <EPCheckoutFormProvider requiresShipping>
        <EPFormField name="email" label="Email" />
        <EPFormField name="firstName" label="First name" />
        <EPFormField name="shippingCity" label="City" />
        <EPFormField name="shippingPostal" label="Postal code" />
      </EPCheckoutFormProvider>
    );

    await waitFor(() =>
      expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
        "walk@example.com"
      )
    );
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Walk");
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Boston");
    expect((screen.getByLabelText("Postal code") as HTMLInputElement).value).toBe("02110");
    expect((screen.getByLabelText("Email") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/card check is still open/);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(sent("PATCH", GET_CURRENT)).toEqual([]);
  });
});
