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
import { createEpAuth } from "../create-ep-auth-better";

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

/**
 * A `Cookie:` header value as `createEpAuth().api.getSession` wants it.
 * Next's `cookies().getAll()` hands back DECODED values and the adapter
 * re-encodes them, so a raw Set-Cookie value — still encoded — would be
 * double-encoded and read as no session at all.
 */
function nextStyleCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const head = part.trim();
    const eq = head.indexOf("=");
    if (eq < 0) continue;
    out[head.slice(0, eq).trim()] = decodeURIComponent(
      head.slice(eq + 1).trim()
    );
  }
  return out;
}

const ACCOUNT_EXPIRES_ISO = new Date(Date.now() + 1800_000).toISOString();

const ACCOUNT_INPUT = {
  epMemberId: "member-123",
  epAccountId: "acct-123",
  epAccountToken: "acct-tok-xyz",
  // Elastic Path's /v2/account-members/tokens returns ISO-8601, not
  // epoch seconds.
  epAccountExpires: ACCOUNT_EXPIRES_ISO,
  email: "shopper@example.com",
  name: "Test Shopper",
};

/**
 * Install a fetch mock that verifies the supplied account token by
 * returning EP's canonical account record. `canonicalId` defaults to
 * the body's `epAccountId` (the happy "EP and caller agree" case);
 * pass a different value to assert that the session stores EP's id
 * rather than the body's claim.
 */
function mockEpVerificationSuccess(canonicalId = ACCOUNT_INPUT.epAccountId) {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u === `${EP_HOST}/oauth/access_token`) {
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
    if (u === `${EP_HOST}/v2/accounts/${ACCOUNT_INPUT.epAccountId}`) {
      return new Response(
        JSON.stringify({
          data: { id: canonicalId, type: "account", name: "Test Account" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as any;
}

describe("/ep/account/login + /ep/account/logout (PRD #273)", () => {
  it("login persists EP-canonical account id, preserves anonymous epAccessToken", async () => {
    const auth = buildAuth();

    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);
    const anonBody = await anonResp.json();

    // EP returns a DIFFERENT id than the body claims — session must
    // persist EP's canonical value, not the caller's claim. Issue #280.
    const CANONICAL_ID = "acct-canonical-from-ep";
    mockEpVerificationSuccess(CANONICAL_ID);

    const loginResp = await (auth.api as any).epAccountLogin({
      body: ACCOUNT_INPUT,
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });
    expect(loginResp.status).toBe(200);
    const loginBody = await loginResp.json();
    expect(loginBody.session.epMemberId).toBe(ACCOUNT_INPUT.epMemberId);
    expect(loginBody.session.epAccount).toEqual({
      id: CANONICAL_ID,
      name: "Test Account",
      token: ACCOUNT_INPUT.epAccountToken,
      expires: Math.floor(Date.parse(ACCOUNT_EXPIRES_ISO) / 1000),
    });
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

    mockEpVerificationSuccess();
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
    expect(body.session.epMemberId).toBeUndefined();
    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epAnchorToken).toBeUndefined();
    expect(body.session.epLapsedAccount).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(ACCOUNT_INPUT.epAccountToken);
    expect(body.session.epAccessToken).toBe(anonBody.session.epAccessToken);
    // User downgraded back to anonymous.
    expect(body.user.email).toMatch(/@anonymous\.local$/);
  });

  it("login rejects a body with no account member", async () => {
    const auth = buildAuth();
    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);
    mockEpVerificationSuccess();

    const { epMemberId, ...withoutMember } = ACCOUNT_INPUT;
    void epMemberId;
    const resp = await (auth.api as any).epAccountLogin({
      body: withoutMember,
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });

    expect(resp.status).toBe(400);
  });

  it("login accepts an expiry in epoch seconds as well as ISO-8601", async () => {
    const auth = buildAuth();
    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);
    mockEpVerificationSuccess();

    const epochSeconds = Math.floor(Date.now() / 1000) + 1800;
    const resp = await (auth.api as any).epAccountLogin({
      body: { ...ACCOUNT_INPUT, epAccountExpires: epochSeconds },
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });

    expect(resp.status).toBe(200);
    expect((await resp.json()).session.epAccount.expires).toBe(epochSeconds);
  });

  it("login rejects an expiry in no format at all", async () => {
    const auth = buildAuth();
    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);
    mockEpVerificationSuccess();

    const resp = await (auth.api as any).epAccountLogin({
      body: { ...ACCOUNT_INPUT, epAccountExpires: "next tuesday" },
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });

    expect(resp.status).toBe(400);
  });

  it("login releases the anchor token, so both slots are never filled", async () => {
    const auth = buildAuth();
    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);
    mockEpVerificationSuccess();

    const resp = await (auth.api as any).epAccountLogin({
      body: ACCOUNT_INPUT,
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });

    expect((await resp.json()).session.epAnchorToken).toBeUndefined();
  });

  it("states a lapse on every read, not only when a refresh happens to run", async () => {
    // The envelope outlives the account credential by days, and only a
    // near-expiry shopper token triggers a refresh. A read that reported
    // the stale selection would keep sending the dead credential and
    // leave the lapse unsaid until the next rotation.
    const epAuth = createEpAuth({
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      secret: SECRET,
      baseURL: "http://localhost:3000",
    });
    const anonResp = await (epAuth.handler.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);
    mockEpVerificationSuccess();

    const loginResp = await (epAuth.handler.api as any).epAccountLogin({
      body: {
        ...ACCOUNT_INPUT,
        epAccountExpires: new Date(Date.now() - 1000).toISOString(),
      },
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });
    const session = await epAuth.api.getSession({
      cookies: nextStyleCookies(mergeCookies(anonCookies, loginResp)),
    });

    expect(session.session?.account).toBeNull();
    expect(session.session?.lapsedAccount).toEqual({
      id: ACCOUNT_INPUT.epAccountId,
      name: "Test Account",
    });
    expect(session.isAuthenticated).toBe(true);
  });

  it("states a lapse on refresh rather than letting the shopper see list prices", async () => {
    const auth = buildAuth();
    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);
    mockEpVerificationSuccess();

    const loginResp = await (auth.api as any).epAccountLogin({
      body: {
        ...ACCOUNT_INPUT,
        epAccountExpires: new Date(Date.now() - 1000).toISOString(),
      },
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });
    const loggedInCookies = mergeCookies(anonCookies, loginResp);

    const refreshResp = await (auth.api as any).epRefresh({
      body: {},
      headers: new Headers({ cookie: loggedInCookies }),
      asResponse: true,
    });
    const body = await refreshResp.json();

    expect(body.session.epLapsedAccount).toEqual({
      id: ACCOUNT_INPUT.epAccountId,
      name: "Test Account",
    });
    expect(body.session.epAccount).toBeUndefined();
    // Still signed in — the member is the authentication, the account is
    // the selection.
    expect(body.session.epMemberId).toBe(ACCOUNT_INPUT.epMemberId);
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

  it("login returns 401 with no Set-Cookie when EP verification network call throws (#280)", async () => {
    const auth = buildAuth();

    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);

    // EP unreachable: verification fetch throws. Endpoint must fail
    // closed rather than treat the absence of a NACK as an ACK.
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u === `${EP_HOST}/oauth/access_token`) {
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
      if (u === `${EP_HOST}/v2/accounts/${ACCOUNT_INPUT.epAccountId}`) {
        throw new Error("network down");
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as any;

    const loginResp = await (auth.api as any).epAccountLogin({
      body: ACCOUNT_INPUT,
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });

    expect(loginResp.status).toBe(401);
    const setCookies: string[] = [];
    loginResp.headers.forEach((v: string, k: string) => {
      if (k.toLowerCase() === "set-cookie") setCookies.push(v);
    });
    expect(setCookies).toEqual([]);
  });

  it("login returns 401 with no Set-Cookie when EP rejects the supplied account token (#280)", async () => {
    const auth = buildAuth();

    // Bootstrap an anon session first.
    const anonResp = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const anonCookies = cookiesFromResponse(anonResp);

    // Swap the fetch mock so EP's verification endpoint returns 401.
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u === `${EP_HOST}/oauth/access_token`) {
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
      if (u === `${EP_HOST}/v2/accounts/${ACCOUNT_INPUT.epAccountId}`) {
        return new Response(
          JSON.stringify({ errors: [{ status: "401", title: "Unauthorized" }] }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as any;

    const loginResp = await (auth.api as any).epAccountLogin({
      body: ACCOUNT_INPUT,
      headers: new Headers({ cookie: anonCookies }),
      asResponse: true,
    });

    expect(loginResp.status).toBe(401);
    const setCookies: string[] = [];
    loginResp.headers.forEach((v: string, k: string) => {
      if (k.toLowerCase() === "set-cookie") setCookies.push(v);
    });
    expect(setCookies).toEqual([]);
  });
});
