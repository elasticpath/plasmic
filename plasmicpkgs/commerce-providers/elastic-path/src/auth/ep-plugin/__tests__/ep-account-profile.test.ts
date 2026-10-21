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
let updateCalls: {
  url: string;
  method: string;
  authorization: string | null;
  accountToken: string | null;
  body: unknown;
}[];
let fetchUrls: string[];
let memberResponse: { status: number; body: unknown } | null;
let memberThrow: Error | null;
let updateResponse: { status: number; body: unknown } | null;
let updateThrow: Error | null;
let settingsResponse: { status: number; body: unknown } | null;
let settingsThrow: Error | null;
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

function jsonBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function requestParts(url: any, init: any = {}) {
  if (typeof Request !== "undefined" && url instanceof Request) {
    return {
      u: url.url,
      method: url.method,
      headers: url.headers,
      body: jsonBody(await url.clone().text()),
    };
  }
  return {
    u: String(url),
    method: init.method ?? "GET",
    headers: init.headers,
    body: jsonBody(typeof init.body === "string" ? init.body : ""),
  };
}

function installFetch() {
  memberCalls = [];
  updateCalls = [];
  fetchUrls = [];
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const request = await requestParts(url, init);
    const u = request.u;
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
      if (settingsThrow) throw settingsThrow;
      if (settingsResponse) {
        return json(settingsResponse.body, settingsResponse.status);
      }
      return json({
        data: {
          relationships: { authentication_realm: { data: { id: "realm-1" } } },
        },
      });
    }
    if (
      u.startsWith(`${EP_HOST}/v2/authentication-realms/`) &&
      u.includes("/user-authentication-info/")
    ) {
      updateCalls.push({
        url: u,
        method: request.method,
        authorization: headerValue(request.headers, "Authorization"),
        accountToken: headerValue(request.headers, EP_ACCOUNT_TOKEN_HEADER),
        body: request.body,
      });
      if (updateThrow) throw updateThrow;
      if (updateResponse) return json(updateResponse.body, updateResponse.status);
      return json({
        data: {
          type: "user_authentication_info",
          id: MEMBER_ID,
          name: "from-elastic-path",
          email: "from-elastic-path@example.com",
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
        authorization: headerValue(request.headers, "Authorization"),
        accountToken: headerValue(request.headers, EP_ACCOUNT_TOKEN_HEADER),
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
  updateResponse = null;
  updateThrow = null;
  settingsResponse = null;
  settingsThrow = null;
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

async function updateMember(auth: any, cookies: string, body: unknown = {}) {
  const res = await auth.api.epAccountMemberUpdate({
    body,
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return { res, cookies: mergeCookies(cookies, res), body: await res.json() };
}

async function signedIn(auth: any) {
  let cookies = await anonymous(auth);
  ({ cookies } = await signIn(auth, cookies));
  return cookies;
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

describe("updating the signed-in account member", () => {
  const UPDATE_URL = `${EP_HOST}/v2/authentication-realms/realm-1/user-authentication-info/${MEMBER_ID}`;

  function epData(body: unknown) {
    return (body as { data?: Record<string, unknown> }).data;
  }

  it("writes only the supplied name and returns the session member id", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    fetchUrls = [];
    memberCalls = [];
    updateCalls = [];

    const { res, body } = await updateMember(auth, cookies, { name: "New Name" });
    expect(res.status).toBe(200);
    expect(body).toEqual({ id: MEMBER_ID });
    expect(updateCalls).toEqual([
      {
        url: UPDATE_URL,
        method: "PUT",
        authorization: "Bearer anon-token",
        accountToken: accountTokenFor("acct-north"),
        body: {
          data: { type: "user_authentication_info", name: "New Name" },
        },
      },
    ]);
    expect(epData(updateCalls[0].body)).not.toHaveProperty("email");
    expect(memberCalls).toEqual([]);
    expect(fetchUrls.some((url) => url.includes("/v2/account-members/"))).toBe(false);
    expect(fetchUrls).not.toContain(`${EP_HOST}/oauth/access_token`);
    expect(loggedText()).not.toContain("anon-token");
    expect(loggedText()).not.toContain(accountTokenFor("acct-north"));
  });

  it("writes only the supplied email", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    updateCalls = [];

    const { body } = await updateMember(auth, cookies, {
      email: "  new@example.com  ",
    });
    expect(body).toEqual({ id: MEMBER_ID });
    expect(epData(updateCalls[0].body)).toEqual({
      type: "user_authentication_info",
      email: "new@example.com",
    });
  });

  it("writes name and email when both are supplied", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    updateCalls = [];

    await updateMember(auth, cookies, {
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(epData(updateCalls[0].body)).toEqual({
      type: "user_authentication_info",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("uses the anchor credential when no account is selected", async () => {
    const auth = buildAuth();
    const cookies = await signedIn(auth);
    updateCalls = [];

    await updateMember(auth, cookies, { name: "Ada Lovelace" });
    expect(updateCalls[0].accountToken).toBe(accountTokenFor("acct-north"));
    expect(updateCalls[0].accountToken).not.toBe(accountTokenFor("acct-south"));
    expect(updateCalls[0].authorization).toBe("Bearer anon-token");
  });

  it("uses the selected account credential", async () => {
    const auth = buildAuth();
    let cookies = await signedIn(auth);
    const selected = await auth.api.epAccountSelect({
      body: { accountId: "acct-south" },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    cookies = mergeCookies(cookies, selected);
    updateCalls = [];

    await updateMember(auth, cookies, { name: "Ada Lovelace" });
    expect(updateCalls[0].accountToken).toBe(accountTokenFor("acct-south"));
    expect(updateCalls[0].authorization).toBe("Bearer anon-token");
  });

  it("keeps the session implicit token as the bearer and does not mint a client credential", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await signedIn(auth);
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccessToken = SESSION_IMPLICIT;
    });
    fetchUrls = [];
    updateCalls = [];

    await updateMember(auth, cookies, { name: "Ada Lovelace" });
    expect(updateCalls[0].authorization).toBe(`Bearer ${SESSION_IMPLICIT}`);
    expect(updateCalls[0].accountToken).toBe(accountTokenFor("acct-north"));
    expect(fetchUrls.filter((url) => url.includes("/oauth/"))).toEqual([]);
    expect(fetchUrls).toContain(`${EP_HOST}/v2/settings/account-authentication`);
    expect(fetchUrls).toContain(UPDATE_URL);
  });

  it("does not call Elastic Path when the member has no organisation", async () => {
    const auth = buildAuth();
    store.accounts = [];
    const cookies = await signedIn(auth);
    fetchUrls = [];
    updateCalls = [];

    const { res, body } = await updateMember(auth, cookies, { name: "Ada" });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_account_credential");
    expect(updateCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(USERNAME);
  });

  it("does not call Elastic Path for a lapsed selected credential", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    store.ttlSeconds = 1;
    const cookies = await signedIn(auth);
    vi.setSystemTime(Date.now() + 5_000);
    fetchUrls = [];
    updateCalls = [];

    const { res, body } = await updateMember(auth, cookies, { name: "Ada" });
    expect(res.status).toBe(401);
    expect(body.code).toBe("account_lapsed");
    expect(updateCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("does not call Elastic Path for an expired anchor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth();
    store.ttlSeconds = 1;
    const cookies = await signedIn(auth);
    vi.setSystemTime(Date.now() + 5_000);
    fetchUrls = [];

    const { res, body } = await updateMember(auth, cookies, { name: "Ada" });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_account_credential");
    expect(updateCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("refuses when there is no session, before the body is validated", async () => {
    const auth = buildAuth();
    const { res, body } = await updateMember(auth, "", { memberId: "someone" });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_session");
    expect(updateCalls).toEqual([]);
  });

  it("refuses an anonymous session after a valid body", async () => {
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    const { res, body } = await updateMember(auth, cookies, { name: "Ada" });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_account_member");
    expect(updateCalls).toEqual([]);
  });

  it.each([
    [null],
    [[]],
    ["Ada"],
    [{ memberId: "someone-else" }],
    [{ userAuthInfoId: MEMBER_ID }],
    [{ realmId: "realm-1" }],
    [{ accountId: "acct-south" }],
    [{ token: "browser-token" }],
    [{ type: "user_authentication_info" }],
    [{ given_name: "Ada" }],
    [{ name: "Ada", email: "ada@example.com", family_name: "Lovelace" }],
    [{}],
    [{ name: "" }],
    [{ name: "   " }],
    [{ email: "" }],
    [{ email: "not-an-email" }],
    [{ name: 1 }],
    [{ email: ["ada@example.com"] }],
  ])("rejects %j and does not call Elastic Path", async (payload) => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    fetchUrls = [];
    updateCalls = [];

    const { res, body } = await updateMember(auth, cookies, payload);
    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_input");
    expect(updateCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("does not write when account-authentication settings cannot be read", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    settingsResponse = {
      status: 403,
      body: { errors: [{ detail: "settings forbidden", title: "ignored" }] },
    };
    updateCalls = [];

    const { res, body } = await updateMember(auth, cookies, { name: "Ada" });
    expect(res.status).toBe(403);
    expect(body).toMatchObject({
      code: "account_member_update_failed",
      message: "settings forbidden",
    });
    expect(body.code).not.toBe("password_profile_unresolved");
    expect(updateCalls).toEqual([]);
  });

  it("reports a settings body with no authentication realm as 502 and does not write", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    settingsResponse = { status: 200, body: { data: {} } };
    updateCalls = [];

    const { res, body } = await updateMember(auth, cookies, { name: "Ada" });
    expect(res.status).toBe(502);
    expect(body).toEqual({
      error: "account_member_update_failed",
      code: "account_member_update_failed",
      message:
        "Elastic Path's account-authentication settings name no authentication realm.",
    });
    expect(updateCalls).toEqual([]);
  });

  it("reports an unreachable settings read as 502 and does not write", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    settingsThrow = new Error("socket down bearer anon-token");
    updateCalls = [];
    consoleError.mockClear();

    const { res, body } = await updateMember(auth, cookies, { name: "Ada" });
    expect(res.status).toBe(502);
    expect(body).toEqual({
      error: "account_member_update_failed",
      code: "account_member_update_failed",
      message: "Elastic Path was unreachable.",
    });
    expect(JSON.stringify(body)).not.toContain("anon-token");
    expect(updateCalls).toEqual([]);
  });

  it("takes the realm from account-authentication settings", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    settingsResponse = {
      status: 200,
      body: {
        data: {
          relationships: {
            authentication_realm: { data: { id: "realm-from-settings" } },
          },
        },
      },
    };
    updateCalls = [];

    await updateMember(auth, cookies, { name: "Ada" });
    expect(updateCalls[0].url).toBe(
      `${EP_HOST}/v2/authentication-realms/realm-from-settings/user-authentication-info/${MEMBER_ID}`
    );
  });

  it.each([
    [400, "Bad profile request"],
    [403, "Your current grant type does not have the required permissions to fulfill this request"],
    [422, "Email is already in use"],
    [500, "Member store failed"],
    [503, "Member store unavailable"],
  ])("preserves Elastic Path %s", async (status, detail) => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    updateResponse = {
      status,
      body: { errors: [{ detail, title: "ignored title" }] },
    };

    const update = await updateMember(auth, cookies, { name: "Ada" });
    expect(update.res.status).toBe(status);
    expect(update.body).toMatchObject({
      code: "account_member_update_failed",
      message: detail,
    });
    expect(memberCalls).toEqual([]);
  });

  it("reports a transport failure as 502 without the thrown error", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    const thrown = new Error(
      `socket down bearer anon-token account ${accountTokenFor("acct-north")}`
    );
    updateThrow = thrown;
    consoleError.mockClear();
    consoleLog.mockClear();
    consoleWarn.mockClear();

    const { res, body } = await updateMember(auth, cookies, { name: "Ada" });
    expect(res.status).toBe(502);
    expect(body).toEqual({
      error: "account_member_update_failed",
      code: "account_member_update_failed",
      message: "Elastic Path was unreachable.",
    });
    expect(JSON.stringify(body)).not.toContain(thrown.message);
    expect(loggedText()).not.toContain("anon-token");
    expect(loggedText()).not.toContain(accountTokenFor("acct-north"));
    expect(memberCalls).toEqual([]);
  });
});
