import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpProxyRoutes } from "../proxy-routes";

const EP_HOST = "https://api.test.elasticpath.com";
const ORIGIN = "http://localhost:3000";
const CART_ID = "cart-1";
const EP_REASON = "There is not enough stock to add gift-card to your cart";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let originalFetch: typeof fetch;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/oauth/access_token") {
      return json(200, {
        access_token: "anon-token",
        token_type: "Bearer",
        expires: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
      });
    }
    if (request.method === "POST" && url.pathname === "/v2/carts") {
      return json(201, { data: { id: CART_ID, type: "cart" } });
    }
    if (
      request.method === "POST" &&
      url.pathname === `/v2/carts/${CART_ID}/items`
    ) {
      return json(400, {
        errors: [{ status: 400, title: "Insufficient stock", detail: EP_REASON }],
      });
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  }) as any;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (process.env as any).NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

async function addOutOfStockItem(): Promise<Response> {
  const auth = createEpAuth({
    clientId: "test-client-id",
    host: EP_HOST,
    secret: "x".repeat(48),
    baseURL: ORIGIN,
  });
  const anon: Response = await (auth.handler.api as any).epAnonymous({
    body: {},
    headers: new Headers(),
    asResponse: true,
  });
  const cookie: string[] = [];
  anon.headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") cookie.push(v.split(";")[0]);
  });
  return createEpProxyRoutes(auth).handle(
    new Request(`${ORIGIN}/api/ep/proxy/addCartItem`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        Cookie: cookie.join("; "),
      },
      body: JSON.stringify({ productId: "prod-1", quantity: 99 }),
    }),
    { params: Promise.resolve({ fn: "addCartItem" }) }
  );
}

describe("a cart write that Elastic Path refuses, through the proxy route", () => {
  it("forwards Elastic Path's own reason in development", async () => {
    (process.env as any).NODE_ENV = "development";

    const res = await addOutOfStockItem();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe("insufficient_stock");
    expect(body.message).toBe(`epAddCartItem: ${EP_REASON}`);
  });

  it("sends only the code and the correlation id in production", async () => {
    (process.env as any).NODE_ENV = "production";

    const res = await addOutOfStockItem();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      error: "dispatch_failed",
      code: "insufficient_stock",
      correlationId: expect.any(String),
    });
  });
});
