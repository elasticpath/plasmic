import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpProxyRoutes } from "../proxy-routes";
import { buildEpCtx } from "../../../ep-server-functions/build-ep-ctx";
import { epGetCart } from "../../../ep-server-functions/getCart";
import { withEpSession } from "../../../ep-server-functions/session-context";

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

function storefrontAuth() {
  return createEpAuth({
    clientId: "test-client-id",
    host: EP_HOST,
    secret: "x".repeat(48),
    baseURL: ORIGIN,
    resolveLocaleAndCurrency: ({ cookies }) => ({
      locale: cookies["shop-locale"],
      currency: cookies["shop-currency"],
    }),
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
  body: unknown
) {
  return routes.handle(
    new Request(`${ORIGIN}/api/ep/proxy/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ fn }) }
  );
}

async function shopperWithCart() {
  const auth = storefrontAuth();
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
    vi.spyOn(console, "error").mockImplementation(() => {});

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
      vi.spyOn(console, "error").mockImplementation(() => {});

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
