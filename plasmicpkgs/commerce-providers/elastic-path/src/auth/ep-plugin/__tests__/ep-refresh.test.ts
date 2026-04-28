/**
 * /ep/refresh — rotates the EP access token without dropping the
 * better-auth session identity. Used by the refresh-before-expiry hook
 * (separate cycle) but also exposed as a manual endpoint for storefront
 * code that knows it's about to need a fresh token.
 *
 * Contract:
 *   - Reads existing session via cookies on the request.
 *   - Mints a new EP token via /oauth/access_token (same path as
 *     /ep/anonymous).
 *   - Calls setSessionCookie with the same user.id / session.id but
 *     refreshed epAccessToken / epExpires.
 *   - Returns 200 + updated session in body.
 *
 *   - When NO existing session exists on the request, behaves like
 *     /ep/anonymous (mints fresh, returns new identity).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";

let originalFetch: typeof fetch;
let tokenCounter = 0;

beforeEach(() => {
  tokenCounter = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      tokenCounter += 1;
      return new Response(
        JSON.stringify({
          access_token: `token-${tokenCounter}`,
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

function setCookieHeadersFromResponse(res: Response): string[] {
  const out: string[] = [];
  res.headers.forEach((value: string, key: string) => {
    if (key.toLowerCase() === "set-cookie") out.push(value);
  });
  return out;
}

function cookiesToHeaderValue(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

describe("/ep/refresh endpoint (PRD #273)", () => {
  it("rotates epAccessToken while preserving session identity", async () => {
    const auth = buildAuth();

    // Step 1: anonymous mint → token-1
    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonBody = await anonResp.json();
    expect(anonBody.session.epAccessToken).toBe("token-1");
    const originalSessionId = anonBody.session.id;
    const originalUserId = anonBody.user.id;

    const cookieHeader = cookiesToHeaderValue(
      setCookieHeadersFromResponse(anonResp)
    );

    // Step 2: refresh → token-2, same identity
    const refreshResp = await (auth.api as any).epRefresh({
      body: {},
      headers: new Headers({ cookie: cookieHeader }),
      asResponse: true,
    });
    expect(refreshResp.status).toBe(200);
    const refreshBody = await refreshResp.json();
    expect(refreshBody.session.epAccessToken).toBe("token-2");
    expect(refreshBody.session.id).toBe(originalSessionId);
    expect(refreshBody.user.id).toBe(originalUserId);

    // EP token endpoint hit twice
    expect((globalThis.fetch as any).mock.calls.length).toBe(2);
  });

  it("falls back to anonymous mint when no session cookie present", async () => {
    const auth = buildAuth();
    const refreshResp = await (auth.api as any).epRefresh({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    expect(refreshResp.status).toBe(200);
    const body = await refreshResp.json();
    expect(body.session.epAccessToken).toBe("token-1");
    expect(body.user.id).toMatch(/^anon-/);
  });
});
