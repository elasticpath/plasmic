/**
 * createEpProxyRoutes — exercises the cartId-persistence path.
 *
 * When the proxy dispatches `addCartItem` and the mutation auto-creates
 * a new cart (input session had no cartId), the proxy must call the
 * EP plugin's /ep/cart endpoint internally and forward the resulting
 * Set-Cookie headers on its own response so the browser's session
 * cookie picks up the new `epCartId`.
 *
 * Mutations are mocked at module boundary; we don't re-test the EP SDK
 * call path here (covered in `ep-server-functions/__tests__/cart-mutations.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";

vi.mock("../../../ep-server-functions/cart-mutations", () => ({
  epAddCartItem: vi.fn(),
  epUpdateCartItem: vi.fn(),
  epRemoveCartItem: vi.fn(),
  epApplyCartAdjustment: vi.fn(),
}));

// Imported AFTER vi.mock so the proxy picks up the mocked module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createEpProxyRoutes } = await import("../proxy-routes");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cartMutations = await import("../../../ep-server-functions/cart-mutations");

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({
          access_token: "anon-token",
          token_type: "Bearer",
          expires: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as any;
  (cartMutations.epAddCartItem as any).mockReset();
  (cartMutations.epUpdateCartItem as any).mockReset();
  (cartMutations.epRemoveCartItem as any).mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function buildAuth() {
  return createEpAuth({
    clientId: EP_CLIENT_ID,
    host: EP_HOST,
    secret: SECRET,
    baseURL: "http://localhost:3000",
  });
}

function cookiesFromResponse(res: Response): string {
  const map = new Map<string, string>();
  res.headers.forEach((v: string, k: string) => {
    if (k.toLowerCase() !== "set-cookie") return;
    const head = v.split(";")[0];
    const eq = head.indexOf("=");
    if (eq < 0) return;
    map.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
  });
  return [...map.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

function mergeCookies(prior: string, res: Response): string {
  const map = new Map<string, string>();
  for (const part of prior.split(";")) {
    const head = part.trim();
    const eq = head.indexOf("=");
    if (eq < 0) continue;
    map.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
  }
  res.headers.forEach((v: string, k: string) => {
    if (k.toLowerCase() !== "set-cookie") return;
    const head = v.split(";")[0];
    const eq = head.indexOf("=");
    if (eq < 0) return;
    map.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
  });
  return [...map.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

describe("createEpProxyRoutes", () => {
  it("forwards Set-Cookie for the freshly-created cartId when addCartItem auto-creates a cart", async () => {
    const auth = buildAuth();

    // Bootstrap an anonymous session (no cart yet).
    const anonResp = await (auth.handler.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookie = cookiesFromResponse(anonResp);

    // Configure the mocked mutation to "auto-create" a cart.
    const newCart = {
      id: "fresh-cart-uuid",
      lineItems: [{ id: "item-1" }],
      totalPrice: 50,
    };
    (cartMutations.epAddCartItem as any).mockResolvedValue(newCart);

    const proxy = createEpProxyRoutes(auth as any);
    const proxyReq = new Request(
      "http://localhost:3000/api/ep/proxy/addCartItem",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          cookie: anonCookie,
        },
        body: JSON.stringify({ productId: "prod-1", quantity: 1 }),
      }
    );
    const proxyResp = await proxy.handle(proxyReq, {
      params: { fn: "addCartItem" },
    });

    expect(proxyResp.status).toBe(200);
    const body = await proxyResp.json();
    expect(body).toEqual(newCart);

    // Set-Cookie was forwarded onto the proxy response, AND a fresh
    // getSession with merged cookies sees the new cartId.
    const merged = mergeCookies(anonCookie, proxyResp);
    const session = await auth.handler.api.getSession({
      headers: new Headers({ cookie: merged }),
    } as any);
    expect((session as any).session.epCartId).toBe("fresh-cart-uuid");
  });

  it("does not call the persistence path when the mutation returns the same cartId already on the session", async () => {
    const auth = buildAuth();

    // Bootstrap anonymous → set cart → use that cart ID.
    const anonResp = await (auth.handler.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const cartResp = await (auth.handler.api as any).epCart({
      body: { cartId: "existing-cart" },
      headers: new Headers({ cookie: cookiesFromResponse(anonResp) }),
      asResponse: true,
    });
    const cookies = mergeCookies(cookiesFromResponse(anonResp), cartResp);

    (cartMutations.epAddCartItem as any).mockResolvedValue({
      id: "existing-cart",
      lineItems: [{ id: "item-1" }],
      totalPrice: 50,
    });

    const proxy = createEpProxyRoutes(auth as any);
    const proxyReq = new Request(
      "http://localhost:3000/api/ep/proxy/addCartItem",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          cookie: cookies,
        },
        body: JSON.stringify({ productId: "prod-1", quantity: 1 }),
      }
    );
    const proxyResp = await proxy.handle(proxyReq, {
      params: { fn: "addCartItem" },
    });

    expect(proxyResp.status).toBe(200);
    // No Set-Cookie for cart id when it didn't change.
    const setCookies: string[] = [];
    proxyResp.headers.forEach((v: string, k: string) => {
      if (k.toLowerCase() === "set-cookie") setCookies.push(v);
    });
    expect(setCookies.join(";")).not.toContain("session_data=");
  });
});
