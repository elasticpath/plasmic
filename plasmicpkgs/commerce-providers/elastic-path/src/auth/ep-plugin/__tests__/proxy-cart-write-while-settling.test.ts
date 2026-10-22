/**
 * A shopper's cart write through the proxy while that cart's payment is
 * settling is refused before it reaches Elastic Path, so the cart being
 * charged cannot change under the charge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleOnce } from "../../../checkout/session/settle-once";
import type { SessionResponse } from "../../../checkout/session/types";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpAuthRoutes } from "../auth-routes";
import { createEpProxyRoutes } from "../proxy-routes";

const EP_HOST = "https://api.test.elasticpath.com";
const ORIGIN = "http://localhost:3000";
const CART_ID = "cart-settling";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const cart = {
  data: {
    id: CART_ID,
    type: "cart",
    meta: {
      display_price: { with_tax: { amount: 2200, currency: "USD", formatted: "$22.00" } },
    },
  },
  included: {
    items: [
      { id: "line-1", type: "cart_item", product_id: "prod-1", name: "Jumper", quantity: 1 },
      { id: "promo-line", type: "promotion_item", sku: "SUMMER10", name: "Summer", quantity: 1 },
    ],
  },
};

let writes: string[] = [];
let originalFetch: typeof fetch;

beforeEach(() => {
  writes = [];
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
      if (method !== "GET") writes.push(`${method} ${new URL(url).pathname}`);
      return json(cart, method === "POST" ? 201 : 200);
    }
    throw new Error(`Unexpected URL: ${method} ${url}`);
  }) as any;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

class Browser {
  jar = new Map<string, string>();
  readonly auth = createEpAuth({
    clientId: "test-client-id",
    host: EP_HOST,
    secret: "x".repeat(48),
    baseURL: ORIGIN,
  });
  readonly proxy = createEpProxyRoutes(this.auth);
  readonly routes = createEpAuthRoutes(this.auth);

  private keep(res: Response): Response {
    res.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() !== "set-cookie") return;
      const head = value.split(";")[0];
      const eq = head.indexOf("=");
      if (eq > 0) this.jar.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
    });
    return res;
  }

  private request(path: string, body: unknown) {
    return new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        ...(this.jar.size
          ? { cookie: [...this.jar].map(([n, v]) => `${n}=${v}`).join("; ") }
          : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async anonymous() {
    this.keep(await this.routes.POST(this.request("/api/ep/ep/anonymous", {})));
  }

  async call(fn: string, args: Record<string, unknown>) {
    return this.keep(
      await this.proxy.handle(this.request(`/api/ep/proxy/${fn}`, args), {
        params: Promise.resolve({ fn }),
      })
    );
  }
}

describe("a cart write while the cart's payment is settling", () => {
  it.each([
    ["addCartItem", { productId: "prod-1", quantity: 1 }],
    ["updateCartItem", { itemId: "line-1", quantity: 3 }],
    ["removeCartItem", { itemId: "line-1" }],
    ["applyPromoCode", { code: "SUMMER10" }],
    ["removePromoCode", { code: "SUMMER10" }],
    ["applyCartAdjustment", { label: "Gift wrap", amountMinor: 500, kind: "fee" }],
  ])("refuses %s with checkout_in_progress and writes nothing", async (fn, args) => {
    const browser = new Browser();
    await browser.anonymous();
    expect((await browser.call("addCartItem", { productId: "prod-1", quantity: 1 })).status).toBe(200);
    writes = [];

    let finish!: (res: SessionResponse) => void;
    const settling = settleOnce(CART_ID, "session-1", () => new Promise((r) => (finish = r)));
    const res = await browser.call(fn, args);
    finish({ status: 200, body: { success: true } });
    await settling;

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("checkout_in_progress");
    expect(writes).toEqual([]);

    expect((await browser.call(fn, args)).status).toBe(200);
  });
});
