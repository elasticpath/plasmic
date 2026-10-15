/**
 * Account-member profile read (#711).
 *
 * The browser sends an empty body. The server reads the member the session
 * already names, with the credential roster and select already treat as usable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { getCookieCache, setCookieCache } from "better-auth/cookies";
import { epPlugin } from "../ep-plugin";
import { DEFAULT_HOST_ALLOWLIST } from "../../host-allowlist";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpAuthRoutes } from "../auth-routes";
import { createEpIdentityClient } from "../../../identity/client";
import { EP_ACCOUNT_TOKEN_HEADER } from "../envelope";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const PROFILE = "profile-1";
const USERNAME = "buyer";
const PASSWORD = "Passw0rd!";
const MEMBER_ID = "member-1";

const ACCOUNTS = [
  { id: "acct-north", name: "Acme North" },
  { id: "acct-south", name: "Acme South" },
];

let originalFetch: typeof fetch;
let tokenGeneration = 0;
let store: {
  accounts: { id: string; name: string }[];
  ttlSeconds: number;
};
let memberCalls: { url: string; authorization: string | null; accountToken: string | null }[];
let fetchUrls: string[];
let memberResponse: { status: number; body: unknown } | null;
let memberThrow: Error | null;
const SESSION_IMPLICIT = "session-implicit-token-not-minted";
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

function accountTokenFor(id: string): string {
  return `token-${id}-gen${tokenGeneration}`;
}

function expiresIso(seconds: number): string {
  return new Date((Math.floor(Date.now() / 1000) + seconds) * 1000).toISOString();
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

function installFetch() {
  memberCalls = [];
  fetchUrls = [];
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    fetchUrls.push(u);
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
      const parsed = new URL(u);
      const limit = Number(parsed.searchParams.get("page[limit]") ?? 100);
      const offset = Number(parsed.searchParams.get("page[offset]") ?? 0);
      const page = store.accounts.slice(offset, offset + limit);
      return json(
        {
          meta: {
            account_member_id: MEMBER_ID,
            results: { total: store.accounts.length },
          },
          data: page.map((account) => ({
            account_id: account.id,
            account_name: account.name,
            token: accountTokenFor(account.id),
            type: "account_management_authentication_token",
            expires: expiresIso(store.ttlSeconds),
          })),
        },
        201
      );
    }
    if (u.startsWith(`${EP_HOST}/v2/account-members/`)) {
      memberCalls.push({
        url: u,
        authorization: headerValue(init.headers, "Authorization"),
        accountToken: headerValue(init.headers, EP_ACCOUNT_TOKEN_HEADER),
      });
      if (memberThrow) throw memberThrow;
      if (memberResponse) return json(memberResponse.body, memberResponse.status);
      return json({
        data: {
          id: MEMBER_ID,
          type: "account_member",
          name: "Ada Lovelace",
          email: "ada@example.com",
          meta: { timestamp: "secret-meta" },
          links: { self: "https://api.test.elasticpath.com/secret" },
          token: "profile-body-token",
        },
      });
    }
    throw new Error(`Unexpected URL: ${u}`);
  }) as any;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  tokenGeneration = 0;
  memberResponse = null;
  memberThrow = null;
  store = { accounts: [...ACCOUNTS], ttlSeconds: 86400 };
  installFetch();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
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
        passwordProfileId: PROFILE,
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

async function anonymous(auth: any) {
  const res = await auth.api.epAnonymous({
    body: {},
    headers: new Headers(),
    asResponse: true,
  });
  return mergeCookies("", res);
}

async function signIn(auth: any, cookies: string) {
  const res = await auth.api.epAccountLogin({
    body: { username: USERNAME, password: PASSWORD },
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return { res, cookies: mergeCookies(cookies, res) };
}

async function replaceCachedSession(
  auth: any,
  cookies: string,
  update: (session: any) => void
) {
  const cache = await getCookieCache(new Headers({ cookie: cookies }), {
    secret: SECRET,
    strategy: "jwe",
    isSecure: false,
  } as any);
  update((cache as any).session);
  const ctx = await auth.$context;
  const jar: string[] = [];
  await setCookieCache(
    {
      context: ctx,
      getCookie() {
        return null;
      },
      setCookie(name: string, value: string) {
        jar.push(`${name}=${value}`);
      },
    } as any,
    { session: (cache as any).session, user: (cache as any).user }
  );
  return jar.join("; ");
}

async function readMember(auth: any, cookies: string, body: unknown = {}) {
  const res = await auth.api.epAccountMember({
    body,
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return { res, cookies: mergeCookies(cookies, res), body: await res.json() };
}

function loggedText(): string {
  return [consoleError, consoleLog, consoleWarn]
    .flatMap((spy) => spy.mock.calls.flat().map((part) => String(part)))
    .join("\n");
}

describe("reading the signed-in account member", () => {
  it("refuses when there is no session", async () => {
    const auth = buildAuth();
    const { res, body } = await readMember(auth, "");
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_session");
    expect(memberCalls).toEqual([]);
  });

  it("refuses an anonymous session before an empty body would matter", async () => {
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    const { res, body } = await readMember(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_account_member");
    expect(memberCalls).toEqual([]);
  });

  it("rejects a body field and does not call Elastic Path", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));

    for (const body of [
      { memberId: "someone-else" },
      { accountId: "acct-south" },
      { token: "browser-token" },
      { extra: true },
    ]) {
      memberCalls = [];
      const read = await readMember(auth, cookies, body);
      expect(read.res.status).toBe(400);
      expect(read.body.code).toBe("invalid_input");
      expect(memberCalls).toEqual([]);
    }
  });

  it("returns only the session member id when the member has no organisation", async () => {
    const auth = buildAuth();
    store.accounts = [];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    memberCalls = [];

    const { res, body } = await readMember(auth, cookies);
    expect(res.status).toBe(200);
    expect(body).toEqual({ id: MEMBER_ID });
    expect(memberCalls).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(USERNAME);
  });

  it("reads with the selected credential and returns only id, name and email", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    memberCalls = [];

    const { res, body } = await readMember(auth, cookies);
    expect(res.status).toBe(200);
    expect(body).toEqual({
      id: MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(Object.keys(body).sort()).toEqual(["email", "id", "name"]);
    expect(memberCalls).toEqual([
      {
        url: `${EP_HOST}/v2/account-members/${MEMBER_ID}`,
        authorization: "Bearer anon-token",
        accountToken: accountTokenFor("acct-north"),
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("profile-body-token");
    expect(JSON.stringify(body)).not.toContain("secret-meta");
    expect(loggedText()).not.toContain("anon-token");
    expect(loggedText()).not.toContain(accountTokenFor("acct-north"));
    expect(loggedText()).not.toContain("Ada Lovelace");
    expect(loggedText()).not.toContain("ada@example.com");
  });

  it("reads with the anchor when several accounts are held and none is selected", async () => {
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    memberCalls = [];

    const { body } = await readMember(auth, cookies);
    expect(body.id).toBe(MEMBER_ID);
    expect(memberCalls[0].accountToken).toBe(accountTokenFor("acct-north"));
    expect(memberCalls[0].accountToken).not.toBe(accountTokenFor("acct-south"));
  });

  it("reads with the selected credential after one of several accounts is chosen", async () => {
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    const selected = await auth.api.epAccountSelect({
      body: { accountId: "acct-south" },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    cookies = mergeCookies(cookies, selected);
    memberCalls = [];

    await readMember(auth, cookies);
    expect(memberCalls[0].accountToken).toBe(accountTokenFor("acct-south"));
    expect(memberCalls[0].accountToken).not.toBe(accountTokenFor("acct-north"));
  });

  it("prefers the selected credential when an anchor is also still on the session", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));

    const cache = await getCookieCache(new Headers({ cookie: cookies }), {
      secret: SECRET,
      strategy: "jwe",
      isSecure: false,
    } as any);
    (cache as any).session.epAnchorToken = {
      token: "anchor-must-not-be-sent",
      expires: Math.floor(Date.now() / 1000) + 3600,
    };
    const ctx = await auth.$context;
    const jar: string[] = [];
    await setCookieCache(
      {
        context: ctx,
        getCookie() {
          return null;
        },
        setCookie(name: string, value: string) {
          jar.push(`${name}=${value}`);
        },
      } as any,
      { session: (cache as any).session, user: (cache as any).user }
    );
    cookies = jar.join("; ");
    memberCalls = [];

    await readMember(auth, cookies);
    expect(memberCalls[0].accountToken).toBe(accountTokenFor("acct-north"));
    expect(memberCalls[0].accountToken).not.toBe("anchor-must-not-be-sent");
  });

  it("does not call Elastic Path for a lapsed selected credential", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    store.ttlSeconds = 1;
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    vi.setSystemTime(Date.now() + 5_000);
    memberCalls = [];

    const { res, body } = await readMember(auth, cookies);
    expect(res.status).toBe(200);
    expect(body).toEqual({ id: MEMBER_ID });
    expect(body.code).toBeUndefined();
    expect(memberCalls).toEqual([]);
  });

  it("does not call Elastic Path for an expired anchor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth();
    store.ttlSeconds = 1;
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    vi.setSystemTime(Date.now() + 5_000);
    memberCalls = [];

    const { res, body } = await readMember(auth, cookies);
    expect(res.status).toBe(200);
    expect(body).toEqual({ id: MEMBER_ID });
    expect(memberCalls).toEqual([]);
  });

  it("keeps the session member id when Elastic Path omits data.id", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    memberResponse = {
      status: 200,
      body: { data: { name: "Ada Lovelace", email: "ada@example.com" } },
    };
    const { body } = await readMember(auth, cookies);
    expect(body).toEqual({
      id: MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("does not publish a profile whose id is not the session member", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    memberResponse = {
      status: 200,
      body: {
        data: {
          id: "someone-else",
          name: "Other Person",
          email: "other@example.com",
        },
      },
    };
    const { res, body } = await readMember(auth, cookies);
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_member_read_failed");
    expect(JSON.stringify(body)).not.toContain("someone-else");
    expect(JSON.stringify(body)).not.toContain("Other Person");
    expect(JSON.stringify(body)).not.toContain("other@example.com");

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookies }),
    });
    expect(session.session.epMemberId).toBe(MEMBER_ID);
  });

  it.each([
    [401, "Unauthorised call"],
    [403, "Your current grant type does not have the required permissions to fulfill this request"],
    [400, "Bad member request"],
    [500, "Member store failed"],
  ])("preserves Elastic Path %s and leaves the shopper signed in", async (status, detail) => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    memberResponse = { status, body: { errors: [{ detail, title: "ignored title" }] } };
    const before = await auth.api.getSession({
      headers: new Headers({ cookie: cookies }),
    });

    const read = await readMember(auth, cookies);
    expect(read.res.status).toBe(status);
    expect(read.body).toMatchObject({
      code: "account_member_read_failed",
      error: "account_member_read_failed",
      message: detail,
    });
    expect(read.body.code).not.toBe("no_session");

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: read.cookies }),
    });
    expect(session.session.id).toBe(before.session.id);
    expect(session.session.epMemberId).toBe(before.session.epMemberId);
    expect(session.session.epMemberId).toBe(MEMBER_ID);
    expect(session.session.epAccessToken).toBe(before.session.epAccessToken);
    expect(session.session.epAccount.token).toBe(before.session.epAccount.token);
    expect(session.session.epAccount.token).toBe(accountTokenFor("acct-north"));
  });

  it("reports a transport failure without the thrown error or credentials", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    const thrown = new Error(
      `socket down ${EP_HOST} member ${MEMBER_ID} bearer anon-token account ${accountTokenFor("acct-north")}`
    );
    memberThrow = thrown;
    fetchUrls = [];
    consoleError.mockClear();
    consoleLog.mockClear();
    consoleWarn.mockClear();

    const { res, body } = await readMember(auth, cookies);
    const text = JSON.stringify(body);
    expect(res.status).toBe(502);
    expect(body).toEqual({
      error: "account_member_read_failed",
      code: "account_member_read_failed",
      message: "Elastic Path was unreachable.",
    });
    expect(text).not.toContain(thrown.message);
    expect(text).not.toContain(EP_HOST);
    expect(text).not.toContain(MEMBER_ID);
    expect(text).not.toContain("anon-token");
    expect(text).not.toContain(accountTokenFor("acct-north"));
    const logged = loggedText();
    expect(logged).not.toContain(thrown.message);
    expect(logged).not.toContain(EP_HOST);
    expect(logged).not.toContain(MEMBER_ID);
    expect(logged).not.toContain("anon-token");
    expect(logged).not.toContain(accountTokenFor("acct-north"));
  });

  it("drops non-string profile fields and does not use the session user", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    memberResponse = {
      status: 200,
      body: {
        data: {
          id: MEMBER_ID,
          name: { given: "Ada" },
          email: ["ada@example.com"],
        },
      },
    };

    const { body } = await readMember(auth, cookies);
    expect(body).toEqual({ id: MEMBER_ID });
    expect(JSON.stringify(body)).not.toContain(USERNAME);
    expect(JSON.stringify(body)).not.toContain("Ada");
    expect(JSON.stringify(body)).not.toContain("ada@example.com");
  });

  it("keeps no_session ahead of an invalid body", async () => {
    const auth = buildAuth();
    const { res, body } = await readMember(auth, "", { memberId: "someone-else" });
    expect(res.status).toBe(401);
    expect(body).toMatchObject({
      error: "no_session",
      code: "no_session",
      message: "No EP session — call /ep/anonymous first to bootstrap.",
    });
    expect(body.code).not.toBe("invalid_input");
    expect(memberCalls).toEqual([]);
  });

  it("sends the session implicit token and does not mint another credential", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccessToken = SESSION_IMPLICIT;
    });
    fetchUrls = [];
    memberCalls = [];

    const { res, body } = await readMember(auth, cookies);
    expect(res.status).toBe(200);
    expect(body.id).toBe(MEMBER_ID);
    expect(memberCalls).toEqual([
      {
        url: `${EP_HOST}/v2/account-members/${MEMBER_ID}`,
        authorization: `Bearer ${SESSION_IMPLICIT}`,
        accountToken: accountTokenFor("acct-north"),
      },
    ]);
    expect(fetchUrls).toEqual([`${EP_HOST}/v2/account-members/${MEMBER_ID}`]);
    expect(SESSION_IMPLICIT).not.toBe("anon-token");
  });

  it("exposes only the profile through the mounted auth routes", async () => {
    const epAuth = createEpAuth({
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      secret: SECRET,
      baseURL: "http://localhost:3000",
      passwordProfileId: PROFILE,
      hostAllowlist: DEFAULT_HOST_ALLOWLIST,
    });
    store.accounts = [ACCOUNTS[0]];
    const anon = await epAuth.handler.api.epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    let cookies = mergeCookies("", anon);
    const signed = await epAuth.handler.api.epAccountLogin({
      body: { username: USERNAME, password: PASSWORD },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    cookies = mergeCookies(cookies, signed);
    memberCalls = [];

    const routes = createEpAuthRoutes(epAuth);
    const res = await routes.POST(
      new Request("http://localhost:3000/api/ep/ep/account/member", {
        method: "POST",
        headers: {
          cookie: cookies,
          "content-type": "application/json",
        },
        body: "{}",
      })
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      id: MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(text).not.toContain("anon-token");
    expect(text).not.toContain(accountTokenFor("acct-north"));
    expect(text).not.toContain(EP_HOST);
    expect(text).not.toContain(EP_CLIENT_ID);
    expect(text).not.toContain("profile-body-token");

    const client = createEpIdentityClient({
      fetch: async (url, init) => {
        expect(String(url)).toBe("/api/ep/ep/account/member");
        expect(init?.body).toBe("{}");
        return routes.POST(
          new Request("http://localhost:3000/api/ep/ep/account/member", {
            method: "POST",
            headers: {
              cookie: cookies,
              "content-type": "application/json",
            },
            body: String(init?.body ?? ""),
          })
        );
      },
    });
    await expect(client.member()).resolves.toEqual({
      id: MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });
});
