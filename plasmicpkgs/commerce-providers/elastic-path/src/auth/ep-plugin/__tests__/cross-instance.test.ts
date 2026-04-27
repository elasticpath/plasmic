/**
 * Cross-instance stateless verification (PRD #273, the load-bearing
 * property of the spike).
 *
 * Two independent `betterAuth({...})` instances with no DB option, sharing
 * only the same `secret`. Instance A handles `/ep/anonymous`, returning
 * Set-Cookie headers. Instance B receives those cookies on a fresh request
 * and reads them via `auth.api.getSession({headers})`. All EP fields must
 * survive the cookie round-trip.
 *
 * If this test ever fails — e.g. because we accidentally start storing
 * fields via `plugin.schema` instead of `setSessionCookie`, or migrate to
 * a non-JWE strategy that doesn't carry payload — the regression is
 * caught here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const FAKE_TOKEN = "fake-anonymous-access-token-xyz";
const FAKE_EXPIRES = Math.floor(Date.now() / 1000) + 3600;

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({
          access_token: FAKE_TOKEN,
          token_type: "Bearer",
          expires: FAKE_EXPIRES,
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
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

/**
 * Extracts cookie name=value pairs from an array of Set-Cookie header
 * strings, returning an HTTP-style `Cookie:` header value (joined `; `).
 */
function setCookieHeadersToCookieValue(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(";")[0])
    .filter((c) => c.length > 0)
    .join("; ");
}

describe("cross-instance stateless verification (PRD #273)", () => {
  it("instance B reads all EP fields from cookies written by instance A", async () => {
    // Instance A — mints anonymous session.
    const authA = buildAuth();
    const responseA = await (authA.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    expect(responseA.status).toBe(200);

    const setCookies: string[] = [];
    responseA.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() === "set-cookie") setCookies.push(value);
    });
    expect(setCookies.length).toBeGreaterThanOrEqual(2);

    const cookieHeader = setCookieHeadersToCookieValue(setCookies);

    // Instance B — fresh process, same secret. No prior knowledge of A.
    // Reading the cookies via getSession must return all EP fields.
    const authB = buildAuth();
    const headersB = new Headers({ cookie: cookieHeader });
    const sessionB = await authB.api.getSession({ headers: headersB } as any);

    expect(sessionB).not.toBeNull();
    expect((sessionB as any).session.epAccessToken).toBe(FAKE_TOKEN);
    expect((sessionB as any).session.epClientId).toBe(EP_CLIENT_ID);
    expect((sessionB as any).session.epHost).toBe(EP_HOST);
    expect((sessionB as any).session.epExpires).toBe(FAKE_EXPIRES);
  });

  it("a third instance reading the same cookies sees identical EP fields", async () => {
    // Defends against any accidental per-process state leaking into the
    // session object — the cookies must be the only carrier.
    const authA = buildAuth();
    const responseA = await (authA.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const setCookies: string[] = [];
    responseA.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() === "set-cookie") setCookies.push(value);
    });
    const cookieHeader = setCookieHeadersToCookieValue(setCookies);

    const authB = buildAuth();
    const sessionB = await authB.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    } as any);

    const authC = buildAuth();
    const sessionC = await authC.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    } as any);

    expect((sessionB as any).session.epAccessToken).toBe(
      (sessionC as any).session.epAccessToken
    );
    expect((sessionB as any).session.epClientId).toBe(
      (sessionC as any).session.epClientId
    );
    expect((sessionB as any).session.epHost).toBe(
      (sessionC as any).session.epHost
    );
  });
});
