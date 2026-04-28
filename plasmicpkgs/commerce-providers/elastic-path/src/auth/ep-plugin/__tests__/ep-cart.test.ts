/**
 * /ep/cart — writes the active cartId into the better-auth session cookie.
 *
 * Replaces the legacy `ep_cart` cookie. The storefront calls this when
 * it creates a new cart (POST /v2/carts) so subsequent server queries
 * can read `session.epCartId` via auth.api.getSession({headers}).
 *
 * Contract:
 *   - POST /ep/cart { cartId: string }
 *   - Reads existing session (must exist; bootstrap via /ep/anonymous first).
 *   - Updates session.epCartId, preserves all other fields incl. epAccessToken.
 *   - Returns 200 + updated session.
 *   - Returns 401 if no existing session (caller must mint one first).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({
          access_token: "tok-cart-test",
          token_type: "Bearer",
          expires: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function buildAuth() {
  return betterAuth({
    secret: SECRET,
    baseURL: "http://localhost:3000",
    plugins: [epPlugin({ clientId: EP_CLIENT_ID, host: EP_HOST })],
    session: {
      cookieCache: { enabled: true, strategy: "jwe", refreshCache: true },
    },
  });
}

function cookiesFromResponse(res: Response): string {
  // Better-auth may emit multiple Set-Cookie headers for chunked
  // session_data. Extract `name=value` from each, dedupe by name (later
  // wins so subsequent endpoint responses overwrite earlier values),
  // re-emit a `Cookie:` header value.
  const map = new Map<string, string>();
  res.headers.forEach((v: string, k: string) => {
    if (k.toLowerCase() !== "set-cookie") return;
    const head = v.split(";")[0];
    const eq = head.indexOf("=");
    if (eq < 0) return;
    const name = head.slice(0, eq).trim();
    const value = head.slice(eq + 1).trim();
    map.set(name, value);
  });
  return [...map.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

/**
 * Merges cookies from a previous response into a new response's
 * Set-Cookie headers, so the resulting Cookie header carries every
 * cookie still in flight (the cart endpoint may only emit a fresh
 * session_data, not session_token, which would be missing from the
 * naive cookies-from-response approach).
 */
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

describe("/ep/cart endpoint (PRD #273)", () => {
  it("writes cartId into the session, preserving epAccessToken + identity", async () => {
    const auth = buildAuth();

    // Bootstrap.
    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonBody = await anonResp.json();
    const cookieHeader = cookiesFromResponse(anonResp);
    const originalSessionId = anonBody.session.id;
    const originalToken = anonBody.session.epAccessToken;

    // Set cart.
    const cartResp = await (auth.api as any).epCart({
      body: { cartId: "cart-abc-123" },
      headers: new Headers({ cookie: cookieHeader }),
      asResponse: true,
    });
    expect(cartResp.status).toBe(200);
    const cartBody = await cartResp.json();
    expect(cartBody.session.epCartId).toBe("cart-abc-123");
    expect(cartBody.session.id).toBe(originalSessionId);
    expect(cartBody.session.epAccessToken).toBe(originalToken);

    // Cross-instance: a fresh auth reads the cartId back from cookies.
    // Merge cookies so we keep session_token (from anonResp) alongside
    // the freshly-rotated session_data from cartResp.
    const mergedCookies = mergeCookies(cookieHeader, cartResp);
    const authB = buildAuth();
    const sessionB = await authB.api.getSession({
      headers: new Headers({ cookie: mergedCookies }),
    } as any);
    expect((sessionB as any).session.epCartId).toBe("cart-abc-123");
    expect((sessionB as any).session.epAccessToken).toBe(originalToken);
  });

  it("returns 401 when no session cookie present", async () => {
    const auth = buildAuth();
    const resp = await (auth.api as any).epCart({
      body: { cartId: "c" },
      headers: new Headers(),
      asResponse: true,
    });
    expect(resp.status).toBe(401);
  });
});
