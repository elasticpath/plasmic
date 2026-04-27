/**
 * /ep/account/login + /ep/account/logout (PRD #273).
 *
 * Login: caller has already exchanged a username/password (or other EP
 * credential) for an EP account token via EP's
 * `/v2/account-members/tokens` endpoint. The plugin's role is to PERSIST
 * the resulting account fields onto the better-auth session via
 * `setSessionCookie`, leaving the anonymous EP access token intact (the
 * shopper still browses anonymously for catalog reads, but checkout +
 * order calls use the account token).
 *
 * Logout: strips account fields. Preserves anonymous EP access token so
 * the visitor's cart and browsing continue without a re-mint.
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

function cookiesFromResponse(res: Response): string {
  return mergeCookies("", res);
}

const ACCOUNT_INPUT = {
  epAccountId: "acct-123",
  epAccountToken: "acct-tok-xyz",
  epAccountExpires: Math.floor(Date.now() / 1000) + 1800,
  email: "shopper@example.com",
  name: "Test Shopper",
};

describe("/ep/account/login + /ep/account/logout (PRD #273)", () => {
  it("login persists account fields, preserves anonymous epAccessToken", async () => {
    const auth = buildAuth();

    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);
    const anonBody = await anonResp.json();

    const loginResp = await (auth.api as any).epAccountLogin({
      body: ACCOUNT_INPUT,
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });
    expect(loginResp.status).toBe(200);
    const loginBody = await loginResp.json();
    expect(loginBody.session.epAccountId).toBe(ACCOUNT_INPUT.epAccountId);
    expect(loginBody.session.epAccountToken).toBe(
      ACCOUNT_INPUT.epAccountToken
    );
    expect(loginBody.session.epAccountExpires).toBe(
      ACCOUNT_INPUT.epAccountExpires
    );
    // Anonymous EP token preserved.
    expect(loginBody.session.epAccessToken).toBe(
      anonBody.session.epAccessToken
    );
    // User upgraded from anonymous → real account.
    expect(loginBody.user.email).toBe(ACCOUNT_INPUT.email);
    expect(loginBody.user.name).toBe(ACCOUNT_INPUT.name);
  });

  it("logout strips account fields, preserves anonymous epAccessToken", async () => {
    const auth = buildAuth();
    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);
    const anonBody = await anonResp.json();

    const loginResp = await (auth.api as any).epAccountLogin({
      body: ACCOUNT_INPUT,
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });
    const loggedInCookies = mergeCookies(anonCookies, loginResp);

    const logoutResp = await (auth.api as any).epAccountLogout({
      body: {},
      headers: new Headers({ cookie: loggedInCookies }),
      asResponse: true,
    });
    expect(logoutResp.status).toBe(200);
    const body = await logoutResp.json();
    expect(body.session.epAccountId).toBeUndefined();
    expect(body.session.epAccountToken).toBeUndefined();
    expect(body.session.epAccountExpires).toBeUndefined();
    expect(body.session.epAccessToken).toBe(anonBody.session.epAccessToken);
    // User downgraded back to anonymous.
    expect(body.user.email).toMatch(/@anonymous\.local$/);
  });

  it("login returns 401 when no anonymous session exists", async () => {
    const auth = buildAuth();
    const resp = await (auth.api as any).epAccountLogin({
      body: ACCOUNT_INPUT,
      headers: new Headers(),
      asResponse: true,
    });
    expect(resp.status).toBe(401);
  });
});
