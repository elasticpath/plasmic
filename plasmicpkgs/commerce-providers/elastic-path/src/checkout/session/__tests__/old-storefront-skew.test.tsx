/**
 * @jest-environment jsdom
 *
 * The checkout components of this release on a storefront that still runs
 * the 0.8.0 npm package: a hostless publish reaches every project at once,
 * while each store upgrades its server on its own schedule. The storefront is
 * a fake that replays recorded 0.8.0 responses (old-storefront-080.ts). Every
 * request the page sends is recorded.
 */
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
const { OldStorefront } = require("./old-storefront-080") as typeof import("./old-storefront-080");
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
const { EPOrderTotalsBreakdown } =
  require("../../composable/EPOrderTotalsBreakdown") as typeof import("../../composable/EPOrderTotalsBreakdown");
/* eslint-enable @typescript-eslint/no-var-requires */

const ADDRESS = {
  firstName: "Walk",
  lastName: "Hostless",
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

let store: InstanceType<typeof OldStorefront>;
let exchanges: Exchange[];
let failNext: Set<string>;

const clone = <T,>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

const browserFetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (failNext.delete(`${method} ${url}`)) {
    exchanges.push({ method, url, body, status: 0, response: null });
    throw new TypeError("Failed to fetch");
  }
  const res = await store.route({ method, url, body });
  exchanges.push({ method, url, body, status: res.status, response: clone(res.body) });
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    json: async () => clone(res.body),
  } as unknown as Response;
});

const CREATE = "/api/checkout/sessions";
const CURRENT = "/api/checkout/sessions/current";
const PAY = "/api/checkout/sessions/current/pay";

function sent(method: string, url: string, from = 0): Exchange[] {
  return exchanges.slice(from).filter((e) => e.method === method && e.url === url);
}

/** Talks to the storefront directly, as the page did before this render. */
async function server(method: string, url: string, body?: any) {
  return store.route({ method, url, body });
}

/** The shopper filled the checkout and picked the $5.99 rate on a 0.8.0 storefront. */
async function readyToPay({ rate = true } = {}): Promise<void> {
  expect((await server("POST", CREATE, {})).status).toBe(201);
  await server("PATCH", CURRENT, {
    customerInfo: { name: "Walk Hostless", email: "shopper@example.com" },
    billingAddress: ADDRESS,
    shippingAddress: ADDRESS,
  });
  if (rate) {
    expect((await server("PATCH", CURRENT, { selectedShippingRateId: "example-standard" })).status).toBe(200);
  }
}

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

/** The Total row the shopper reads. */
function shownTotal(): string | null {
  const rows = Array.from(document.querySelectorAll("[data-ep-totals-row]"));
  const row = rows.find((r) => r.querySelector("[data-ep-totals-label]")?.textContent === "Total");
  return row?.querySelector("[data-ep-totals-value]")?.textContent ?? null;
}

function alertText(): string | null {
  return document.querySelector("[data-ep-checkout-error]")?.textContent ?? null;
}

function renderCheckout(extra?: React.ReactNode) {
  return render(
    <SWRConfig value={{ dedupingInterval: 0 }}>
      <EPCheckoutSessionProvider>
        <SessionProbe />
        <EPCheckoutFormProvider requiresShipping>
          <EPFormField name="email" label="Email" />
          <EPOrderTotalsBreakdown />
          {extra}
          <EPStripePayment publishableKey="pk_test_walk" />
          <EPPlaceOrderButton />
        </EPCheckoutFormProvider>
      </EPCheckoutSessionProvider>
    </SWRConfig>
  );
}

async function fillEmail() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "shopper@example.com" },
  });
}

async function place() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Place your order" }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

async function focusPage() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

const CART_CHANGED = "Your cart changed. Check the new total, then place your order again.";

beforeEach(async () => {
  store = new OldStorefront();
  exchanges = [];
  failNext = new Set();
  mockStripeJs.reset();
  browserFetch.mockClear();
  global.fetch = browserFetch as any;
  await mutate(epCartCacheKey(), undefined, false);
  await mutate(CURRENT, undefined, false);
});

describe("the 0.8.0 storefront the fake replays", () => {
  it("charges the live cart after CART_MISMATCH, whatever total was shown", async () => {
    await readyToPay();
    store.quantity = 2;

    const mismatch = await server("POST", PAY, { gateway: "stripe", shownTotal: 2799 });
    expect([mismatch.status, mismatch.body.error.code, mismatch.body.data.session.totals.total]).toEqual([
      409,
      "CART_MISMATCH",
      2799,
    ]);
    expect((await server("GET", CURRENT)).body.data.session.totals.total).toBe(2799);
    expect((await server("POST", PAY, { gateway: "stripe", shownTotal: 2799 })).status).toBe(200);
    expect(store.charges).toEqual([4999]);
  });

  it("opens checkout on an empty cart and charges the shipping line alone", async () => {
    store.quantity = 0;
    await readyToPay();
    expect(store.storedSession()?.totals.total).toBe(599);
    expect((await server("POST", PAY, { gateway: "stripe", shownTotal: 599 })).status).toBe(200);
    expect(store.orders).toEqual([{ charged: 599, skus: ["__ep_shipping"] }]);
  });

  it("sends the session's cart id to the browser", async () => {
    await readyToPay();
    expect((await server("GET", CURRENT)).body.data.session).toHaveProperty("cartId");
  });
});

describe("a cart changed in another tab after the total was shown (0.8.0 storefront)", () => {
  it("shows the new total and takes no payment on that Place, then charges the total shown", async () => {
    await readyToPay();
    renderCheckout();
    await waitFor(() => expect(shownTotal()).toBe("$27.99"));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());
    await fillEmail();

    store.quantity = 2;
    await focusPage();
    expect(shownTotal()).toBe("$27.99");

    const before = exchanges.length;
    await place();

    await waitFor(() => expect(shownTotal()).toBe("$49.99"));
    expect(alertText()).toBe(CART_CHANGED);
    expect(sent("POST", PAY)).toEqual([]);
    expect(sent("POST", CREATE, before).map((e) => e.status)).toEqual([201]);
    expect(store.charges).toEqual([]);

    await place();

    expect(sent("POST", PAY).map((e) => [e.body.shownTotal, e.status])).toEqual([[4999, 200]]);
    expect(store.charges).toEqual([4999]);
    expect(store.orders[0].skus).toEqual(["p-plus-sub", "__ep_shipping"]);
  });

  it("answers CART_MISMATCH by starting checkout again, and sends no other payment until the new total is shown", async () => {
    await readyToPay();
    renderCheckout();
    await waitFor(() => expect(shownTotal()).toBe("$27.99"));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());
    await fillEmail();

    // The cart changes after the page read it and before the payment.
    store.after("POST", "/api/ep/proxy/getCart", () => {
      store.quantity = 2;
    });
    await place();

    expect(sent("POST", PAY).map((e) => [e.body.shownTotal, e.status, e.response.error.code])).toEqual([
      [2799, 409, "CART_MISMATCH"],
    ]);
    const mismatchAt = exchanges.findIndex((e) => e.url === PAY);
    expect(sent("POST", CREATE, mismatchAt).map((e) => e.status)).toEqual([201]);
    await waitFor(() => expect(shownTotal()).toBe("$49.99"));
    expect(alertText()).toBe(CART_CHANGED);
    expect(store.charges).toEqual([]);

    await place();

    expect(sent("POST", PAY).map((e) => [e.body.shownTotal, e.status])).toEqual([
      [2799, 409],
      [4999, 200],
    ]);
    expect(store.charges).toEqual([4999]);
  });

  it("keeps Place refused after CART_MISMATCH while checkout cannot start again", async () => {
    await readyToPay();
    renderCheckout();
    await waitFor(() => expect(shownTotal()).toBe("$27.99"));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());
    await fillEmail();

    store.after("POST", "/api/ep/proxy/getCart", () => {
      store.quantity = 2;
    });
    failNext.add(`POST ${CREATE}`);
    await place();

    expect(sent("POST", PAY).map((e) => e.status)).toEqual([409]);
    expect(shownTotal()).toBe("$27.99");
    expect(alertText()).toBe(CART_CHANGED);

    await place();

    expect(sent("POST", PAY).map((e) => e.status)).toEqual([409]);
    await waitFor(() => expect(shownTotal()).toBe("$49.99"));
    expect(alertText()).toBe(CART_CHANGED);
    expect(store.charges).toEqual([]);

    await place();

    expect(sent("POST", PAY).map((e) => [e.body.shownTotal, e.status])).toEqual([
      [2799, 409],
      [4999, 200],
    ]);
    expect(store.charges).toEqual([4999]);
  });

  it("does not pay a session an earlier CART_MISMATCH left with the old total, after a reload", async () => {
    await readyToPay();
    store.quantity = 2;
    expect((await server("POST", PAY, { gateway: "stripe", shownTotal: 2799 })).status).toBe(409);
    expect(store.storedSession()?.totals.total).toBe(2799);

    renderCheckout();
    await waitFor(() => expect(shownTotal()).toBe("$27.99"));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());
    await fillEmail();

    await place();

    expect(sent("POST", PAY)).toEqual([]);
    await waitFor(() => expect(shownTotal()).toBe("$49.99"));
    expect(alertText()).toBe(CART_CHANGED);

    await place();

    expect(sent("POST", PAY).map((e) => [e.body.shownTotal, e.status])).toEqual([[4999, 200]]);
    expect(store.charges).toEqual([4999]);
  });
});

describe("a shipping line that did not reach the cart (0.8.0 storefront)", () => {
  it("takes no payment for a total without shipping, and charges once the page shows shipping", async () => {
    store.failShippingWrites = 1;
    await readyToPay();
    expect(store.storedSession()?.selectedShippingRateId).toBe("example-standard");
    expect(store.cartTotal()).toBe(2200);

    renderCheckout();
    await waitFor(() => expect(shownTotal()).toBe("$22.00"));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());
    await fillEmail();

    await place();

    expect(sent("POST", PAY)).toEqual([]);
    await waitFor(() => expect(shownTotal()).toBe("$27.99"));
    expect(alertText()).toBe(CART_CHANGED);

    await place();

    expect(sent("POST", PAY).map((e) => [e.body.shownTotal, e.status])).toEqual([[2799, 200]]);
    expect(store.charges).toEqual([2799]);
  });
});

describe("an empty cart (0.8.0 storefront)", () => {
  it("refuses Place with the shipping line as the only line, and takes no payment", async () => {
    store.quantity = 0;
    await readyToPay();
    expect(store.cartTotal()).toBe(599);

    renderCheckout();
    await waitFor(() => expect(shownTotal()).toBe("$5.99"));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());
    await fillEmail();

    await place();

    expect(alertText()).toBe("Your cart is empty");
    expect(sent("POST", PAY)).toEqual([]);
    expect(store.charges).toEqual([]);
    expect(store.orders).toEqual([]);
  });

  it("refuses Place on a $0 checkout with nothing in the cart", async () => {
    store.quantity = 0;
    await readyToPay({ rate: false });

    renderCheckout();
    await waitFor(() => expect(shownTotal()).toBe("$0.00"));
    await fillEmail();

    await place();

    expect(alertText()).toBe("Your cart is empty");
    expect(sent("POST", PAY)).toEqual([]);
    expect(store.orders).toEqual([]);
  });

  it("says the cart is empty, in shopper words, to a visitor with no cart", async () => {
    store.hasCart = false;
    renderCheckout();

    await waitFor(() => expect(probe().errorCode).toBe("NO_CART"));
    expect(probe().error).toBe("Your cart is empty");
    expect(sent("POST", CREATE).map((e) => [e.status, e.response.error.code])).toEqual([
      [400, "VALIDATION_ERROR"],
    ]);
    expect(alertText()).toBe("Your cart is empty");
    expect(document.body.textContent).not.toMatch(/cartId/);

    await fillEmail();
    await place();
    expect(alertText()).toBe("Your cart is empty");
    expect(sent("POST", PAY)).toEqual([]);
  });
});

describe("messages from a 0.8.0 storefront", () => {
  it("says promo codes need a storefront update when the storefront has no promo route", async () => {
    await readyToPay();
    renderCheckout(<EPPromoCodeInput />);
    await waitFor(() => expect(shownTotal()).toBe("$27.99"));

    fireEvent.change(screen.getByPlaceholderText("Promo code"), {
      target: { value: "TEST1" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Promo codes can't be used on this store until it is updated."
      )
    );
    expect(sent("POST", "/api/ep/proxy/applyPromoCode").map((e) => [e.body, e.status])).toEqual([
      [{ code: "TEST1" }, 404],
    ]);
    expect(document.body.textContent).not.toMatch(/unknown_fn|ep proxy|server-side/);
    expect(shownTotal()).toBe("$27.99");
  });

  it("shows shopper words, not the storefront's field list, when the payment step finds details missing", async () => {
    await readyToPay({ rate: false });
    renderCheckout();
    await waitFor(() => expect(shownTotal()).toBe("$22.00"));
    await waitFor(() => expect(screen.getByTestId("stripe-payment-element")).toBeTruthy());
    await fillEmail();

    await place();

    expect(sent("POST", PAY).map((e) => [e.status, e.response.error.code])).toEqual([
      [400, "MISSING_FIELDS"],
    ]);
    expect(alertText()).toBe("Please complete your details and choose a delivery option.");
    expect(document.body.textContent).not.toMatch(/Missing required fields|selectedShippingRateId/);
    expect(store.charges).toEqual([]);
  });
});
