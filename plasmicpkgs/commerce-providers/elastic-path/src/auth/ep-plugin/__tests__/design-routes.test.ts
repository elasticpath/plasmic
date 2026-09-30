/**
 * createEpDesignRoutes — the session-free catalog route.
 *
 * Two properties carry the whole design: it serves exactly four declared
 * names, and it reads no shopper session. The second is a property of the
 * file's imports, asserted here by source inspection, because a route that
 * merely happens not to call `getSession` today can grow the call tomorrow.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";
import { EP_DESIGN_FN_NAMES } from "../../../ep-server-functions/design-fn-names";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";

vi.mock("../../../ep-server-functions/getProduct", () => ({
  epGetProduct: vi.fn(),
}));
vi.mock("../../../ep-server-functions/getProductList", () => ({
  epGetProductList: vi.fn(),
}));
vi.mock("../../../ep-server-functions/getProductPage", () => ({
  epGetProductPage: vi.fn(),
}));
vi.mock("../../../ep-server-functions/getRelatedProducts", () => ({
  epGetRelatedProducts: vi.fn(),
}));

const { createEpDesignRoutes, resetEpDesignTokenCache } = await import(
  "../design-routes"
);
import { epGetProduct } from "../../../ep-server-functions/getProduct";
import { epGetProductList } from "../../../ep-server-functions/getProductList";
import { getCurrentEpSession } from "../../../ep-server-functions/session-context";

let originalFetch: typeof fetch;
let mintCalls: number;

function makeAuth(overrides: Record<string, unknown> = {}) {
  return createEpAuth({
    clientId: EP_CLIENT_ID,
    host: EP_HOST,
    secret: SECRET,
    baseURL: "http://localhost:3456",
    ...overrides,
  });
}

function post(fn: string, args: Record<string, unknown> = {}) {
  return [
    new Request(`http://localhost:3456/api/ep/design/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }),
    { params: Promise.resolve({ fn }) },
  ] as const;
}

beforeEach(() => {
  resetEpDesignTokenCache();
  mintCalls = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      mintCalls += 1;
      return new Response(
        JSON.stringify({
          access_token: `implicit-token-${mintCalls}`,
          token_type: "Bearer",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as any;
  (epGetProduct as any).mockReset();
  (epGetProductList as any).mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("the four declared names", () => {
  it("serves each of them under a bare implicit token", async () => {
    const routes = createEpDesignRoutes(makeAuth());
    let seen: any;
    (epGetProduct as any).mockImplementation(async () => {
      seen = getCurrentEpSession();
      return { id: "p1" };
    });

    const res = await routes.handle(...post("getProduct", { id: "p1" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "p1" });
    expect(seen).toEqual({
      accessToken: "implicit-token-1",
      host: EP_HOST,
      clientId: EP_CLIENT_ID,
    });
  });

  it("carries no cart, account or account token into the session scope", async () => {
    const routes = createEpDesignRoutes(makeAuth());
    let seen: any;
    (epGetProductList as any).mockImplementation(async () => {
      seen = getCurrentEpSession();
      return [];
    });

    await routes.handle(...post("getProductList", {}));

    expect(seen.cartId).toBeUndefined();
    expect(seen.accountId).toBeUndefined();
    expect(seen.accountToken).toBeUndefined();
  });

  it("is a closed list, not a forwarder", async () => {
    const routes = createEpDesignRoutes(makeAuth());

    for (const fn of ["getCart", "addCartItem", "placeOrder", "multiSearch"]) {
      const res = await routes.handle(...post(fn));
      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.code).toBe("design_fn_not_served");
      expect(body.message).toContain(fn);
    }
  });

  it("declares its names rather than subtracting from the proxy's table", () => {
    expect([...EP_DESIGN_FN_NAMES]).toEqual([
      "getProduct",
      "getProductList",
      "getProductPage",
      "getRelatedProducts",
    ]);
  });
});

describe("the implicit token", () => {
  it("is minted once and reused across requests", async () => {
    const routes = createEpDesignRoutes(makeAuth());
    (epGetProduct as any).mockResolvedValue(null);

    await routes.handle(...post("getProduct", { id: "a" }));
    await routes.handle(...post("getProduct", { id: "b" }));

    expect(mintCalls).toBe(1);
  });

  it("is minted against the store resolveConfig names, not the bootstrap one", async () => {
    const routes = createEpDesignRoutes(
      makeAuth({
        clientId: "bootstrap-placeholder",
        resolveConfig: async () => ({
          clientId: "real-client-id",
          host: EP_HOST,
        }),
      })
    );
    let seen: any;
    (epGetProduct as any).mockImplementation(async () => {
      seen = getCurrentEpSession();
      return null;
    });

    await routes.handle(...post("getProduct", { id: "a" }));

    expect(seen.clientId).toBe("real-client-id");
    const body = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(body).toContain("grant_type=implicit");
    expect(body).toContain("client_id=real-client-id");
  });
});

describe("CORS", () => {
  it("is open with no credentials and no origin gate", async () => {
    const routes = createEpDesignRoutes(makeAuth());
    (epGetProduct as any).mockResolvedValue(null);

    const preflight = routes.options();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull();

    const [request, context] = post("getProduct", { id: "a" });
    const hostile = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ id: "a" }),
    });
    const res = await routes.handle(hostile, context);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("adds no entry to trustedOrigins", () => {
    const auth = makeAuth();
    createEpDesignRoutes(auth);
    expect(auth.config.trustedOrigins).toEqual([
      "http://localhost:3456",
      "http://127.0.0.1:3456",
    ]);
  });
});

describe("the file itself", () => {
  /**
   * Comments stripped: "never reads the session" has to be a property of the
   * code, and the file explains at length why, in prose full of the words
   * this asserts the absence of.
   */
  const code = readFileSync(
    fileURLToPath(new URL("../design-routes.ts", import.meta.url)),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("reads no shopper session", () => {
    expect(code).not.toMatch(/getSession/);
    expect(code).not.toMatch(/parseCookieHeader/);
    expect(code).not.toMatch(/persistCartId/);
    expect(code).not.toMatch(/cookie/i);
    expect(code).not.toMatch(/epAuth\.api/);
  });

  it("imports no session-scoped operation", () => {
    for (const name of [
      "epGetCart",
      "epAddCartItem",
      "epPlaceOrder",
      "epMultiSearch",
      "epGetStock",
    ]) {
      expect(code).not.toContain(name);
    }
  });

  it("applies no origin gate", () => {
    expect(code).not.toMatch(/enforceOriginGate|isTrustedOrigin|trustedOrigins/);
  });
});
