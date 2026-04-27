/**
 * epAuthMiddleware (PRD #273) — Next.js middleware that bootstraps an
 * anonymous EP session on first visit so RSC pages always have cookies.
 *
 * RSC pages cannot write cookies in Next 15. Without this middleware,
 * the catchall page's `epAuth.api.getSession({cookies})` mints an
 * in-memory session per request that's never persisted, and the
 * client-side EP SDK falls back to its own localStorage-cached
 * implicit-grant token. With this middleware:
 *
 *   1. First request without cookies → middleware POSTs synthetically
 *      to /ep/anonymous → captures Set-Cookie headers → forwards them
 *      on NextResponse → cookies persist for the user's lifetime.
 *   2. Subsequent requests carry the cookies → middleware sees a session
 *      → no-ops → page reads it via getSession.
 *
 * This is the better-auth + Next 15 standard pattern: middleware writes
 * the cookies (allowed) so RSC pages can just read them (also allowed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { epAuthMiddleware } from "../middleware";
import { createEpAuth } from "../create-ep-auth-better";

const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({
          access_token: "mw-token",
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

function buildEpAuth() {
  return createEpAuth({
    clientId: EP_CLIENT_ID,
    host: EP_HOST,
    secret: "x".repeat(48),
    baseURL: "http://localhost:3456",
    basePath: "/api/ep",
    checkout: { sessionSecret: "dev-secret-min-16-chars" },
  });
}

describe("epAuthMiddleware (PRD #273)", () => {
  it("mints anonymous session + sets cookies on first request without session", async () => {
    const epAuth = buildEpAuth();
    const middleware = epAuthMiddleware(epAuth);

    const req = new Request("http://localhost:3456/product/abc", {
      method: "GET",
    });

    const res = await middleware(req);

    expect(res).toBeInstanceOf(Response);
    const setCookies: string[] = [];
    res.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() === "set-cookie") setCookies.push(value);
    });
    expect(setCookies.length).toBeGreaterThanOrEqual(2);
    expect(
      setCookies.some((c) => c.includes("better-auth.session_token"))
    ).toBe(true);
    expect(
      setCookies.some((c) => c.includes("better-auth.session_data"))
    ).toBe(true);
  });

  it("passes through requests that already carry session cookies (no extra mint)", async () => {
    const epAuth = buildEpAuth();
    const middleware = epAuthMiddleware(epAuth);

    // Step 1 — mint a session.
    const firstReq = new Request("http://localhost:3456/product/abc");
    const firstRes = await middleware(firstReq);
    const setCookies: string[] = [];
    firstRes.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() === "set-cookie") setCookies.push(value);
    });
    const cookieHeader = setCookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");

    const fetchCallsAfterMint = (globalThis.fetch as any).mock.calls.length;

    // Step 2 — second request carries the cookies. Middleware should NOT
    // call EP again.
    const secondReq = new Request("http://localhost:3456/product/abc", {
      headers: { cookie: cookieHeader },
    });
    await middleware(secondReq);

    expect((globalThis.fetch as any).mock.calls.length).toBe(
      fetchCallsAfterMint
    );
  });

  it("skips mint on request paths matching the auth handler basePath", async () => {
    // /api/ep/* requests are the auth handler itself — middleware must
    // not bootstrap mid-flight or it'd loop.
    const epAuth = buildEpAuth();
    const middleware = epAuthMiddleware(epAuth);

    const req = new Request("http://localhost:3456/api/ep/ep/anonymous", {
      method: "POST",
    });
    await middleware(req);

    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });
});
