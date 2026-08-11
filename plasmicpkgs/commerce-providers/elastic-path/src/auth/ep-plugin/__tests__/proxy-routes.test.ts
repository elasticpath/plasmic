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

function buildAuth(trustedOrigins?: string[]) {
  return createEpAuth({
    clientId: EP_CLIENT_ID,
    host: EP_HOST,
    secret: SECRET,
    baseURL: "http://localhost:3000",
    ...(trustedOrigins ? { trustedOrigins } : {}),
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
      params: Promise.resolve({ fn: "addCartItem" }),
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
      params: Promise.resolve({ fn: "addCartItem" }),
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

describe("createEpProxyRoutes CORS", () => {
  function preflight(auth: any, origin: string) {
    return createEpProxyRoutes(auth).options(
      new Request("http://localhost:3000/api/ep/proxy/getCart", {
        method: "OPTIONS",
        headers: { Origin: origin },
      })
    );
  }

  it("reflects an origin that better-auth already trusts", () => {
    const auth = buildAuth();
    expect(
      preflight(auth, "http://localhost:3000").headers.get(
        "Access-Control-Allow-Origin"
      )
    ).toBe("http://localhost:3000");
    expect(
      preflight(auth, "http://127.0.0.1:3000").headers.get(
        "Access-Control-Allow-Origin"
      )
    ).toBe("http://127.0.0.1:3000");
  });

  it("no longer reflects the old hardcoded Studio default", () => {
    expect(
      preflight(buildAuth(), "http://localhost:3003").headers.get(
        "Access-Control-Allow-Origin"
      )
    ).toBeNull();
  });

  it("reflects a Studio origin once it is added to trustedOrigins", () => {
    const auth = buildAuth([
      "http://localhost:3000",
      "http://localhost:3003",
    ]);
    const res = preflight(auth, "http://localhost:3003");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3003"
    );
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("keeps the baseURL origin reflectable even when trustedOrigins is overridden", () => {
    const auth = buildAuth(["http://localhost:3003"]);
    expect(auth.config.trustedOrigins).toContain("http://localhost:3000");
    expect(
      preflight(auth, "http://localhost:3000").headers.get(
        "Access-Control-Allow-Origin"
      )
    ).toBe("http://localhost:3000");
  });

  it("picks up BETTER_AUTH_TRUSTED_ORIGINS the way better-auth does", () => {
    const prior = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    process.env.BETTER_AUTH_TRUSTED_ORIGINS =
      "https://studio.elasticpathdev.com, https://second.example.com";
    try {
      const auth = buildAuth();
      expect(
        preflight(auth, "https://studio.elasticpathdev.com").headers.get(
          "Access-Control-Allow-Origin"
        )
      ).toBe("https://studio.elasticpathdev.com");
      expect(auth.config.trustedOrigins).toContain(
        "https://second.example.com"
      );
    } finally {
      if (prior === undefined) delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
      else process.env.BETTER_AUTH_TRUSTED_ORIGINS = prior;
    }
  });

  it("honours wildcard trustedOrigins entries", () => {
    const auth = buildAuth(["http://localhost:3000", "https://*.vercel.app"]);
    expect(
      preflight(auth, "https://preview-42.vercel.app").headers.get(
        "Access-Control-Allow-Origin"
      )
    ).toBe("https://preview-42.vercel.app");
    expect(
      preflight(auth, "https://vercel.app.evil.test").headers.get(
        "Access-Control-Allow-Origin"
      )
    ).toBeNull();
  });
});

describe("createEpProxyRoutes origin gate", () => {
  it("rejects a cross-site mutation from an untrusted origin", async () => {
    const proxy = createEpProxyRoutes(buildAuth() as any);
    const res = await proxy.handle(
      new Request("http://localhost:3000/api/ep/proxy/addCartItem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://evil.test",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ productId: "p", quantity: 1 }),
      }),
      { params: Promise.resolve({ fn: "addCartItem" }) }
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "untrusted_origin" });
    expect(cartMutations.epAddCartItem as any).not.toHaveBeenCalled();
  });
});

/**
 * A missing cookie does NOT reach this branch — `getSession` bootstraps an
 * anonymous session first. It is reached when that mint also fails, so the
 * session is stubbed directly rather than via mint internals.
 */
describe("createEpProxyRoutes no-session handling", () => {
  function unauthenticatedRequest(fn: string, body: unknown) {
    const proxy = createEpProxyRoutes({
      config: { trustedOrigins: ["http://localhost:3000"] },
      api: { getSession: vi.fn(async () => ({ session: null, cart: null })) },
    } as any);
    return proxy.handle(
      new Request(`http://localhost:3000/api/ep/proxy/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ fn }) }
    );
  }

  it.each(["addCartItem", "updateCartItem", "removeCartItem"])(
    "rejects %s with 401 rather than a soft 200",
    async (fn) => {
      const res = await unauthenticatedRequest(fn, { itemId: "i1", quantity: 2 });

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "no_session" });
    }
  );

  it("does not dispatch the mutation when there is no session", async () => {
    await unauthenticatedRequest("addCartItem", { productId: "p", quantity: 1 });

    expect(cartMutations.epAddCartItem).not.toHaveBeenCalled();
  });

  it("still soft-fails reads with a 200 null body", async () => {
    const res = await unauthenticatedRequest("getCart", {});

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});

describe("createEpProxyRoutes error sanitization", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    (process.env as any).NODE_ENV = originalNodeEnv;
  });

  async function dispatchFailure(
    opts: { error?: Error } = {}
  ): Promise<Response> {
    const auth = buildAuth();
    const anonResp = await (auth.handler.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    (cartMutations.epAddCartItem as any).mockRejectedValue(
      opts.error ??
        new Error(
          "EP 500 at https://internal.ep.svc/v2/carts — token tok-secret"
        )
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const proxy = createEpProxyRoutes(auth as any);
    return proxy.handle(
      new Request("http://localhost:3000/api/ep/proxy/addCartItem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          cookie: cookiesFromResponse(anonResp),
        },
        body: JSON.stringify({ productId: "p", quantity: 1 }),
      }),
      { params: Promise.resolve({ fn: "addCartItem" }) }
    );
  }

  it("withholds the message in production and logs it instead", async () => {
    (process.env as any).NODE_ENV = "production";
    const res = await dispatchFailure();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("dispatch_failed");
    expect(body.message).toBeUndefined();
    expect(body.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(body.correlationId),
      expect.any(Error)
    );
  });

  it("keeps the message outside production", async () => {
    (process.env as any).NODE_ENV = "development";
    const body = await (await dispatchFailure()).json();

    expect(body.error).toBe("dispatch_failed");
    expect(body.message).toContain("EP 500");
    expect(body.correlationId).toBeTruthy();
  });

  it("classifies a generic failure as dispatch_failed", async () => {
    (process.env as any).NODE_ENV = "production";
    const body = await (await dispatchFailure()).json();

    expect(body.code).toBe("dispatch_failed");
  });

  it("carries insufficient_stock through production sanitization", async () => {
    (process.env as any).NODE_ENV = "production";
    const res = await dispatchFailure({
      error: new Error(
        "epUpdateCartItem: There is not enough stock to add this item"
      ),
    });

    const body = await res.json();
    expect(body.message).toBeUndefined();
    expect(body.code).toBe("insufficient_stock");
  });
});
