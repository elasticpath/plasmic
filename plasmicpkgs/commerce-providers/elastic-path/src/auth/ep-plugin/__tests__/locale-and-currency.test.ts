import type { IncomingHttpHeaders } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpProxyRoutes } from "../proxy-routes";
import { buildEpCtx } from "../../../ep-server-functions/build-ep-ctx";
import { epGetCart } from "../../../ep-server-functions/getCart";
import { withEpSession } from "../../../ep-server-functions/session-context";
import { resetEpLocaleAndCurrencyWarnings } from "../locale-and-currency";

const nextRequest = vi.hoisted(() => ({
  headers: undefined as Headers | undefined,
}));

vi.mock("next/headers.js", () => ({
  async headers() {
    if (!nextRequest.headers) {
      throw new Error("`headers` was called outside a request scope.");
    }
    return nextRequest.headers;
  },
  async cookies() {
    return { get() {}, set() {} };
  },
}));

const EP_HOST = "https://api.test.elasticpath.com";
const ORIGIN = "http://localhost:3000";
const CART_ID = "cart-fr";

interface CartRead {
  acceptLanguage: string | null;
  currency: string | null;
}

let originalFetch: typeof fetch;
let cartReads: CartRead[];

function cartBody() {
  return {
    data: {
      id: CART_ID,
      type: "cart",
      name: "Cart",
      meta: {
        display_price: {
          with_tax: { amount: 1000, currency: "EUR", formatted: "€10.00" },
          without_tax: { amount: 1000, currency: "EUR", formatted: "€10.00" },
          tax: { amount: 0, currency: "EUR", formatted: "€0.00" },
        },
      },
    },
    included: {
      items: [
        {
          id: "line-1",
          type: "cart_item",
          product_id: "prod-1",
          name: "Thing",
          sku: "thing",
          quantity: 1,
          meta: {
            display_price: {
              with_tax: {
                unit: { amount: 1000, currency: "EUR", formatted: "€10.00" },
                value: { amount: 1000, currency: "EUR", formatted: "€10.00" },
              },
            },
          },
        },
      ],
    },
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetEpLocaleAndCurrencyWarnings();
  nextRequest.headers = undefined;
  originalFetch = globalThis.fetch;
  cartReads = [];
  globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/oauth/access_token") {
      return json({
        access_token: "anon-token",
        token_type: "Bearer",
        expires: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
      });
    }
    if (request.method === "POST" && url.pathname === "/v2/carts") {
      return json({ data: { id: CART_ID, type: "cart" } });
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v2/carts/${CART_ID}/items`
    ) {
      return json(cartBody());
    }
    if (request.method === "GET" && url.pathname === `/v2/carts/${CART_ID}`) {
      cartReads.push({
        acceptLanguage: request.headers.get("Accept-Language"),
        currency: request.headers.get("X-Moltin-Currency"),
      });
      return json(cartBody());
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function storefrontAuth(
  resolveLocaleAndCurrency: Parameters<
    typeof createEpAuth
  >[0]["resolveLocaleAndCurrency"] = ({ cookies }) => ({
    locale: cookies["shop-locale"],
    currency: cookies["shop-currency"],
  })
) {
  return createEpAuth({
    clientId: "test-client-id",
    host: EP_HOST,
    secret: "x".repeat(48),
    baseURL: ORIGIN,
    resolveLocaleAndCurrency,
  });
}

function setCookiePairs(res: Response): string[] {
  const out: string[] = [];
  res.headers.forEach((v: string, k: string) => {
    if (k.toLowerCase() === "set-cookie") out.push(v.split(";")[0]);
  });
  return out;
}

function mergeCookies(prior: string, res: Response): string {
  const map = new Map<string, string>();
  for (const pair of [...prior.split("; "), ...setCookiePairs(res)]) {
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return [...map.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

function cookieRecord(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of header.split("; ")) {
    const eq = pair.indexOf("=");
    if (eq > 0) out[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
  }
  return out;
}

function proxyCall(
  routes: ReturnType<typeof createEpProxyRoutes>,
  fn: string,
  cookie: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return routes.handle(
    new Request(`${ORIGIN}/api/ep/proxy/${fn}`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Origin: ORIGIN,
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ fn }) }
  );
}

async function shopperWithCart(auth = storefrontAuth()) {
  const routes = createEpProxyRoutes(auth);
  const anon = await (auth.handler.api as any).epAnonymous({
    body: {},
    headers: new Headers(),
    asResponse: true,
  });
  let cookie = mergeCookies(
    "shop-locale=fr-FR; shop-currency=EUR",
    anon
  );
  const write = await proxyCall(routes, "addCartItem", cookie, {
    productId: "prod-1",
    quantity: 1,
  });
  expect(write.status).toBe(200);
  cookie = mergeCookies(cookie, write);
  return { auth, routes, cookie };
}

async function ssrCartRead(
  auth: ReturnType<typeof storefrontAuth>,
  cookie: string
): Promise<CartRead> {
  const session = await auth.api.getSession({ cookies: cookieRecord(cookie) });
  const before = cartReads.length;
  await withEpSession(buildEpCtx(session), () => epGetCart());
  return cartReads[before];
}

describe("proxy locale and currency", () => {
  it("prices a proxied cart write the way a server render prices the cart", async () => {
    const { auth, cookie } = await shopperWithCart();
    const proxiedWrite = cartReads[0];

    const ssr = await ssrCartRead(auth, cookie);

    expect(ssr).toEqual({ acceptLanguage: "fr-FR", currency: "EUR" });
    expect(proxiedWrite).toEqual(ssr);
  });

  it("prices a proxied getCart the way a server render prices the cart", async () => {
    const { auth, routes, cookie } = await shopperWithCart();
    const before = cartReads.length;

    const res = await proxyCall(routes, "getCart", cookie, {});
    const proxiedRead = cartReads[before];
    const ssr = await ssrCartRead(auth, cookie);

    expect(res.status).toBe(200);
    expect(ssr).toEqual({ acceptLanguage: "fr-FR", currency: "EUR" });
    expect(proxiedRead).toEqual(ssr);
  });
});

describe("a resolver keyed on request headers", () => {
  const byAcceptLanguage = storefrontAuth.bind(null, ({ headers }) => ({
    locale: headers["accept-language"],
  }));

  it("gets the page request's headers on a server render that passes none", async () => {
    nextRequest.headers = new Headers({ "Accept-Language": "de-DE" });

    const session = await byAcceptLanguage().api.getSession({ cookies: {} });

    expect(session.locale).toBe("de-DE");
  });

  it("gives a server render and a proxied call the same answer", async () => {
    const { auth, routes, cookie } = await shopperWithCart(byAcceptLanguage());
    const before = cartReads.length;

    await proxyCall(routes, "getCart", cookie, {}, { "Accept-Language": "de-DE" });
    const proxiedRead = cartReads[before];
    nextRequest.headers = new Headers({ "Accept-Language": "de-DE" });
    const ssr = await ssrCartRead(auth, cookie);

    expect(ssr.acceptLanguage).toBe("de-DE");
    expect(proxiedRead).toEqual(ssr);
  });

  it("uses the headers a caller passes over the page request's", async () => {
    nextRequest.headers = new Headers({ "Accept-Language": "de-DE" });

    const session = await byAcceptLanguage().api.getSession({
      cookies: {},
      headers: { "accept-language": "fr-FR" },
    });

    expect(session.locale).toBe("fr-FR");
  });

  it("takes a Node request's headers, as the Pages Router passes them", async () => {
    let seen: Record<string, string> | undefined;
    const auth = storefrontAuth(({ headers }) => {
      seen = headers;
      return { locale: headers["accept-language"] };
    });
    const nodeHeaders: IncomingHttpHeaders = {
      "accept-language": "fr-CH,fr;q=0.9,en;q=0.8",
      "x-shop": ["north", "south"],
      "if-none-match": undefined,
    };

    const session = await auth.api.getSession({ cookies: {}, headers: nodeHeaders });

    expect(session.locale).toBe("fr-CH");
    expect(seen).toEqual({
      "accept-language": "fr-CH,fr;q=0.9,en;q=0.8",
      "x-shop": "north, south",
    });
  });

  it("hands the resolver header names in lower case", async () => {
    const session = await byAcceptLanguage().api.getSession({
      cookies: {},
      headers: { "Accept-Language": "it-IT" },
    });

    expect(session.locale).toBe("it-IT");
  });

  it("gets no headers outside a request", async () => {
    const session = await byAcceptLanguage().api.getSession({ cookies: {} });

    expect(session.locale).toBeUndefined();
    expect(session.session?.accessToken).toBe("anon-token");
  });
});

describe("resolveLocaleAndCurrency validation", () => {
  function sessionFor(
    resolveLocaleAndCurrency: Parameters<typeof createEpAuth>[0]["resolveLocaleAndCurrency"]
  ) {
    const auth = createEpAuth({
      clientId: "test-client-id",
      host: EP_HOST,
      secret: "x".repeat(48),
      baseURL: ORIGIN,
      resolveLocaleAndCurrency,
    });
    return auth.api.getSession({ cookies: {} });
  }

  it("drops a currency or locale that is not a valid header value", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const session = await sessionFor(() => ({
      locale: "fr-FR\r\nX-Injected: 1",
      currency: "EURO",
    }));

    expect(session.locale).toBeUndefined();
    expect(session.currency).toBeUndefined();
    expect(session.session?.accessToken).toBe("anon-token");
  });

  it.each(["en-a", "de-1", "en-x", "abcd", "en--US", "en_US"])(
    "drops %s, which is not a BCP 47 tag",
    async (locale) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const session = await sessionFor(() => ({ locale, currency: "EUR" }));

      expect(session.locale).toBeUndefined();
      expect(session.currency).toBe("EUR");
    }
  );

  it.each([
    ["EN-us", "en-US"],
    ["zh-hant-tw", "zh-Hant-TW"],
    ["de-CH", "de-CH"],
  ])("sends %s in its canonical form %s", async (locale, canonical) => {
    const session = await sessionFor(() => ({ locale }));

    expect(session.locale).toBe(canonical);
  });

  it("upper-cases a lower-case currency code", async () => {
    const session = await sessionFor(() => ({ locale: "de-CH", currency: "chf" }));

    expect(session.locale).toBe("de-CH");
    expect(session.currency).toBe("CHF");
  });

  it("still returns the session when the resolver throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const session = await sessionFor(() => {
      throw new Error("boom");
    });

    expect(session.session?.accessToken).toBe("anon-token");
    expect(session.currency).toBeUndefined();
  });
});

describe("a resolver that returns the Accept-Language header as it is", () => {
  function sessionFor(acceptLanguage: string) {
    const auth = createEpAuth({
      clientId: "test-client-id",
      host: EP_HOST,
      secret: "x".repeat(48),
      baseURL: ORIGIN,
      resolveLocaleAndCurrency: ({ headers }) => ({
        locale: headers["accept-language"],
      }),
    });
    return auth.api.getSession({
      cookies: {},
      headers: { "accept-language": acceptLanguage },
    });
  }

  it.each([
    ["en-GB,en-US;q=0.9,en;q=0.8", "en-GB"],
    ["de,en-US;q=0.7,en;q=0.3", "de"],
    ["fr-FR,fr;q=0.9", "fr-FR"],
    ["en-us", "en-US"],
    ["en;q=0.5, fr-CH", "fr-CH"],
    ["*;q=0.9, ja-JP;q=0.5", "ja-JP"],
    ["en-US;q=0, de-AT;q=0.4", "de-AT"],
    ["en_US,de-DE;q=0.9", "de-DE"],
  ])("sends %s as %s", async (header, locale) => {
    const session = await sessionFor(header);

    expect(session.locale).toBe(locale);
  });

  it("logs nothing for a header it can use", async () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");

    await sessionFor("en-GB,en;q=0.9");

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("sends no locale and logs nothing for a wildcard", async () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");

    const session = await sessionFor("*");

    expect(session.locale).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("warns once, not on every request, about a header it cannot use", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error");

    const first = await sessionFor("en_US");
    const second = await sessionFor("12345");

    expect(first.locale).toBeUndefined();
    expect(second.locale).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});
