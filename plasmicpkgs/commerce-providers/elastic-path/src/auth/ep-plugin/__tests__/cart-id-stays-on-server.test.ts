/**
 * Guard: the Elastic Path cart id never reaches the browser. A cart id alone
 * grants access to that cart, so every response a storefront page can read
 * is checked for it: the cart functions through the proxy, the auth routes,
 * and the development error text. Checkout session responses are checked in
 * each handler's own tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpAuthRoutes } from "../auth-routes";
import { createEpProxyRoutes } from "../proxy-routes";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const ORIGIN = "http://localhost:3000";
const CART_ID = "7c2e9a4d-31f0-4b6e-8d55-0a9f3c1e2b77";

let cartReadsFail = false;

function epCart() {
  return {
    data: {
      id: CART_ID,
      type: "cart",
      name: "Cart",
      links: { self: `${EP_HOST}/v2/carts/${CART_ID}` },
      relationships: {
        items: { data: [{ type: "cart_item", id: "line-1" }] },
      },
      meta: {
        display_price: {
          with_tax: { amount: 2400, currency: "USD", formatted: "$24.00" },
        },
      },
    },
    included: {
      items: [
        {
          id: "line-1",
          type: "cart_item",
          product_id: "prod-1",
          name: "Jumper",
          quantity: 2,
          links: { product: `${EP_HOST}/v2/products/prod-1` },
        },
        {
          id: "promo-line",
          type: "promotion_item",
          sku: "SUMMER10",
          name: "Summer",
          quantity: 1,
        },
      ],
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let originalFetch: typeof fetch;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  cartReadsFail = false;
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (input instanceof Request ? input.method : init.method) ?? "GET";
    if (url === `${EP_HOST}/oauth/access_token`) {
      return json({
        access_token: "anon-token",
        token_type: "Bearer",
        expires: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
      });
    }
    if (url.startsWith(`${EP_HOST}/v2/carts`)) {
      if (method === "GET" && cartReadsFail) {
        return json({ errors: [{ status: 404, title: "Not Found" }] }, 404);
      }
      return json(epCart(), method === "POST" ? 201 : 200);
    }
    throw new Error(`Unexpected URL: ${method} ${url}`);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (process.env as any).NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

function buildAuth() {
  return createEpAuth({
    clientId: "test-client-id",
    host: EP_HOST,
    secret: SECRET,
    baseURL: ORIGIN,
  });
}

class Browser {
  jar = new Map<string, string>();
  readonly proxy;
  readonly routes;

  constructor(readonly auth: ReturnType<typeof buildAuth>) {
    this.proxy = createEpProxyRoutes(auth);
    this.routes = createEpAuthRoutes(auth);
  }

  get cookie() {
    return [...this.jar].map(([n, v]) => `${n}=${v}`).join("; ");
  }

  keep(res: Response): Response {
    res.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() !== "set-cookie") return;
      const head = value.split(";")[0];
      const eq = head.indexOf("=");
      if (eq > 0) this.jar.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
    });
    return res;
  }

  request(path: string, method: string, body?: unknown) {
    return new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        ...(this.jar.size ? { cookie: this.cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async call(fn: string, args: Record<string, unknown> = {}) {
    return this.keep(
      await this.proxy.handle(this.request(`/api/ep/proxy/${fn}`, "POST", args), {
        params: Promise.resolve({ fn }),
      })
    );
  }

  async authRoute(method: "GET" | "POST", path: string, body?: unknown) {
    const handler = method === "GET" ? this.routes.GET : this.routes.POST;
    return this.keep(await handler(this.request(path, method, body)));
  }

  async storedCartId(): Promise<string | undefined> {
    const result = (await this.auth.handler.api.getSession({
      headers: new Headers({ cookie: this.cookie }),
    } as any)) as any;
    return result?.session?.epCartId;
  }
}

async function shopperWithACart() {
  const browser = new Browser(buildAuth());
  await browser.authRoute("POST", "/api/ep/ep/anonymous", {});
  const added = await browser.call("addCartItem", {
    productId: "prod-1",
    quantity: 2,
  });
  return { browser, added };
}

describe("the cart id stays on the server", () => {
  it("is recorded on the session when a cart write creates the cart, and is not in the response", async () => {
    const { browser, added } = await shopperWithACart();

    expect(added.status).toBe(200);
    const text = await added.text();
    expect(JSON.parse(text).itemCount).toBe(2);
    expect(text).not.toContain(CART_ID);
    expect(await browser.storedCartId()).toBe(CART_ID);
  });

  it.each([
    ["getCart", {}],
    ["addCartItem", { productId: "prod-1", quantity: 1 }],
    ["updateCartItem", { itemId: "line-1", quantity: 3 }],
    ["removeCartItem", { itemId: "line-1" }],
    ["applyPromoCode", { code: "SUMMER10" }],
    ["removePromoCode", { code: "SUMMER10" }],
    ["applyCartAdjustment", { label: "Gift wrap", amountMinor: 500, kind: "fee" }],
  ])("is not in the %s result", async (fn, args) => {
    const { browser } = await shopperWithACart();

    const res = await browser.call(fn, args);

    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(CART_ID);
  });

  it.each([
    ["GET", "/api/ep/get-session"],
    ["POST", "/api/ep/ep/refresh"],
  ] as const)("is not in %s %s", async (method, path) => {
    const { browser } = await shopperWithACart();

    const res = await browser.authRoute(method, path, method === "POST" ? {} : undefined);

    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(CART_ID);
  });

  it("cannot be set from the browser", async () => {
    const { browser } = await shopperWithACart();

    const res = await browser.authRoute("POST", "/api/ep/ep/cart", {
      cartId: "someone-elses-cart",
    });

    expect(res.ok).toBe(false);
    expect(await browser.storedCartId()).toBe(CART_ID);
  });

  it("is not in the development error text", async () => {
    (process.env as any).NODE_ENV = "development";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { browser } = await shopperWithACart();
    cartReadsFail = true;

    const res = await browser.call("removeCartItem", { itemId: "line-1" });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).message).toBeTruthy();
    expect(text).not.toContain(CART_ID);
  });
});
