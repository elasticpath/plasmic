/**
 * Signing out, refusing a sign-in, and what a lapsed account credential looks
 * like from outside. Signing in itself is covered in ep-account-member.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";
import { DEFAULT_HOST_ALLOWLIST } from "../../host-allowlist";
import { createEpAuth } from "../create-ep-auth-better";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const PROFILE = "profile-1";
const USERNAME = "buyer@example.com";
const PASSWORD = "Passw0rd!";
const ACCOUNT = { id: "acct-north", name: "Acme North" };
const ACCOUNT_TOKEN = "acct-tok-xyz";

let originalFetch: typeof fetch;
/** Negative leaves the minted credential already expired. */
let ttlSeconds: number;

function installFetch() {
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (u === `${EP_HOST}/oauth/access_token`) {
      return json({
        access_token: "anon-token",
        token_type: "Bearer",
        expires: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
      });
    }
    if (u === `${EP_HOST}/v2/settings/account-authentication`) {
      return json({
        data: {
          relationships: { authentication_realm: { data: { id: "realm-1" } } },
        },
      });
    }
    if (u.includes("/password-profiles")) {
      return json({ data: [{ id: PROFILE, name: "password" }] });
    }
    if (u.startsWith(`${EP_HOST}/v2/account-members/tokens`)) {
      const data = JSON.parse(init.body).data;
      if (
        data.authentication_mechanism === "password" &&
        (data.username !== USERNAME || data.password !== PASSWORD)
      ) {
        return json({ errors: [{ detail: "authentication failed" }] }, 400);
      }
      return json(
        {
          meta: {
            account_member_id: "member-123",
            results: { total: 1 },
          },
          data: [
            {
              account_id: ACCOUNT.id,
              account_name: ACCOUNT.name,
              token: ACCOUNT_TOKEN,
              type: "account_management_authentication_token",
              expires: new Date(
                (Math.floor(Date.now() / 1000) + ttlSeconds) * 1000
              ).toISOString(),
            },
          ],
        },
        201
      );
    }
    throw new Error(`Unexpected URL: ${u}`);
  }) as any;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  ttlSeconds = 1800;
  installFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function buildAuth() {
  return betterAuth({
    secret: SECRET,
    baseURL: "http://localhost:3000",
    plugins: [
      epPlugin({
        hostAllowlist: DEFAULT_HOST_ALLOWLIST,
        clientId: EP_CLIENT_ID,
        host: EP_HOST,
      }),
    ],
    session: {
      cookieCache: { enabled: true, strategy: "jwe", refreshCache: true },
    },
  } as any);
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

async function anonymous(api: any): Promise<{ cookies: string; body: any }> {
  const res = await api.epAnonymous({
    body: {},
    headers: new Headers(),
    asResponse: true,
  });
  return { cookies: mergeCookies("", res), body: await res.json() };
}

async function signIn(api: any, cookies: string): Promise<Response> {
  return api.epAccountLogin({
    body: { username: USERNAME, password: PASSWORD },
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
}

describe("signing out", () => {
  it("strips the account fields and keeps the anonymous credential", async () => {
    const auth = buildAuth();
    const anon = await anonymous(auth.api);
    const loginResp = await signIn(auth.api, anon.cookies);
    const loggedIn = mergeCookies(anon.cookies, loginResp);

    const res = await (auth.api as any).epAccountLogout({
      body: {},
      headers: new Headers({ cookie: loggedIn }),
      asResponse: true,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.epMemberId).toBeUndefined();
    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epAnchorToken).toBeUndefined();
    expect(body.session.epLapsedAccount).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(ACCOUNT_TOKEN);
    expect(body.session.epAccessToken).toBe(anon.body.session.epAccessToken);
    expect(body.user.email).toMatch(/@anonymous\.local$/);
  });
});

describe("refusing a sign-in", () => {
  it("refuses a body that carries no credentials", async () => {
    const auth = buildAuth();
    const anon = await anonymous(auth.api);

    const res = await (auth.api as any).epAccountLogin({
      body: { username: USERNAME },
      headers: new Headers({ cookie: anon.cookies }),
      asResponse: true,
    });

    expect(res.status).toBe(400);
  });

  it("refuses a caller the package minted no token for", async () => {
    const auth = buildAuth();

    const res = await (auth.api as any).epAccountLogin({
      body: {
        epMemberId: "member-123",
        epAccountId: ACCOUNT.id,
        epAccountToken: "a-token-the-caller-minted",
        epAccountExpires: new Date(Date.now() + 1800_000).toISOString(),
      },
      headers: new Headers({ cookie: (await anonymous(auth.api)).cookies }),
      asResponse: true,
    });

    expect(res.status).toBe(400);
  });

  it("refuses when no anonymous session exists", async () => {
    const auth = buildAuth();

    const res = await (auth.api as any).epAccountLogin({
      body: { username: USERNAME, password: PASSWORD },
      headers: new Headers(),
      asResponse: true,
    });

    expect(res.status).toBe(401);
  });
});

describe("a lapsed account credential", () => {
  it("releases the anchor token on sign-in, so both slots are never filled", async () => {
    const auth = buildAuth();
    const anon = await anonymous(auth.api);

    const res = await signIn(auth.api, anon.cookies);

    expect((await res.json()).session.epAnchorToken).toBeUndefined();
  });

  it("is stated on every read, not only when a refresh happens to run", async () => {
    ttlSeconds = -10;
    const epAuth = createEpAuth({
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      secret: SECRET,
      baseURL: "http://localhost:3000",
    });
    const anon = await anonymous(epAuth.handler.api);
    const loginResp = await signIn(epAuth.handler.api, anon.cookies);

    const session = await epAuth.api.getSession({
      cookies: nextStyleCookies(mergeCookies(anon.cookies, loginResp)),
    });

    expect(session.session?.account).toBeNull();
    expect(session.session?.lapsedAccount).toEqual(ACCOUNT);
    expect(session.isAuthenticated).toBe(true);
  });

  it("is stated on refresh rather than letting the shopper see list prices", async () => {
    ttlSeconds = -10;
    const auth = buildAuth();
    const anon = await anonymous(auth.api);
    const loginResp = await signIn(auth.api, anon.cookies);
    const loggedIn = mergeCookies(anon.cookies, loginResp);

    const res = await (auth.api as any).epRefresh({
      body: {},
      headers: new Headers({ cookie: loggedIn }),
      asResponse: true,
    });

    const body = await res.json();
    expect(body.session.epLapsedAccount).toEqual(ACCOUNT);
    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epMemberId).toBe("member-123");
  });
});
