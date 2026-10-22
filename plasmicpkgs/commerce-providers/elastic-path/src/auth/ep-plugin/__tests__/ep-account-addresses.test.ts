/**
 * Saved-address read (#616).
 *
 * The browser posts an empty body. The server reads addresses for the
 * selected organisation only, and never treats a missing selection as an
 * empty book.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { getCookieCache, setCookieCache } from "better-auth/cookies";
import { epPlugin } from "../ep-plugin";
import { DEFAULT_HOST_ALLOWLIST } from "../../host-allowlist";
import { EP_ACCOUNT_TOKEN_HEADER } from "../envelope";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const PROFILE = "profile-1";
const USERNAME = "buyer";
const PASSWORD = "Passw0rd!";
const MEMBER_ID = "member-1";
const SESSION_IMPLICIT = "session-implicit-token-not-minted";
const SECRET_STREET = "1 Secret Street";
const FOREIGN_TOKEN = "foreign-account-token";

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
let addressCalls: {
  url: string;
  accountId: string | null;
  authorization: string | null;
  accountToken: string | null;
  limit: string | null;
  offset: string | null;
}[];
let fetchUrls: string[];
let addressReplies: Array<{ status: number; body: unknown }>;
let addressThrow: Error | null;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

function accountTokenFor(id: string): string {
  return `token-${id}-gen${tokenGeneration}`;
}

function expiresIso(seconds: number): string {
  return new Date((Math.floor(Date.now() / 1000) + seconds) * 1000).toISOString();
}

function headerValue(
  headers: HeadersInit | undefined,
  name: string
): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(
      ([key]) => key.toLowerCase() === name.toLowerCase()
    );
    return found ? found[1] : null;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

function addressPage(
  count: number,
  next: string | null,
  accountId = "acct-north"
) {
  return {
    data: Array.from({ length: count }, (_, index) => ({
      type: "address",
      id: `addr-${index}`,
      name: `Place ${index}`,
      first_name: "Ada",
      last_name: "Lovelace",
      company_name: "Analytical",
      phone_number: "555",
      instructions: "behind the bin",
      line_1: index === 0 ? SECRET_STREET : `${index} High Street`,
      line_2: "Unit 2",
      city: "London",
      county: "Greater London",
      region: "England",
      postcode: "SW1A 1AA",
      country: "GB",
      links: { self: "https://api.test.elasticpath.com/secret-link" },
      meta: { timestamps: { created_at: "secret-meta" } },
      relationships: { account: { id: accountId, type: "account" } },
      token: FOREIGN_TOKEN,
    })),
    links: { next },
    meta: { results: { total: 99999 }, token: FOREIGN_TOKEN },
  };
}

function installFetch() {
  addressCalls = [];
  fetchUrls = [];
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const request =
      typeof Request !== "undefined" && url instanceof Request
        ? {
            u: url.url,
            headers: url.headers as HeadersInit,
          }
        : { u: String(url), headers: init.headers as HeadersInit };
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

    const parsed = new URL(u);
    const accountId = parsed.pathname.match(
      /^\/v2\/accounts\/([^/]+)\/addresses$/
    )?.[1];
    if (accountId) {
      addressCalls.push({
        url: u,
        accountId: decodeURIComponent(accountId),
        authorization: headerValue(request.headers, "Authorization"),
        accountToken: headerValue(request.headers, EP_ACCOUNT_TOKEN_HEADER),
        limit: parsed.searchParams.get("page[limit]"),
        offset: parsed.searchParams.get("page[offset]"),
      });
      if (addressThrow) throw addressThrow;
      const reply = addressReplies.shift() ?? {
        status: 200,
        body: addressPage(0, null, decodeURIComponent(accountId)),
      };
      return json(reply.body, reply.status);
    }

    throw new Error(`Unexpected URL: ${u}`);
  }) as any;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  tokenGeneration = 0;
  addressReplies = [];
  addressThrow = null;
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

async function signedIn(auth: any) {
  let cookies = await anonymous(auth);
  ({ cookies } = await signIn(auth, cookies));
  return cookies;
}

async function selectAccount(auth: any, cookies: string, accountId: string) {
  const res = await auth.api.epAccountSelect({
    body: { accountId },
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return mergeCookies(cookies, res);
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

async function readAddresses(auth: any, cookies: string, body: unknown = {}) {
  const res = await auth.api.epAccountAddresses({
    body,
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return { res, body: await res.json() };
}

function loggedText(): string {
  return [consoleError, consoleLog, consoleWarn]
    .flatMap((spy) => spy.mock.calls.flat().map((part) => String(part)))
    .join("\n");
}

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value) + loggedText();
  expect(text).not.toContain(accountTokenFor("acct-north"));
  expect(text).not.toContain(accountTokenFor("acct-south"));
  expect(text).not.toContain("anon-token");
  expect(text).not.toContain(SESSION_IMPLICIT);
  expect(text).not.toContain(FOREIGN_TOKEN);
  expect(text).not.toContain("secret-link");
  expect(text).not.toContain("secret-meta");
  expect(text).not.toContain("anchor-must-not-be-sent");
}

describe("reading saved account addresses", () => {
  it("refuses when there is no session and does not call Elastic Path", async () => {
    const auth = buildAuth();
    const { res, body } = await readAddresses(auth, "");
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_session");
    expect(addressCalls).toEqual([]);
  });

  it("refuses an anonymous session", async () => {
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    addressCalls = [];
    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_account_member");
    expect(addressCalls).toEqual([]);
  });

  it("rejects a body field before calling Elastic Path", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    addressCalls = [];

    for (const body of [
      { accountId: "acct-south" },
      { filter: "eq(country,GB)" },
      { limit: 1 },
      { offset: 100 },
      { token: "browser-token" },
      { headers: { Authorization: "Bearer browser" } },
    ]) {
      addressCalls = [];
      const read = await readAddresses(auth, cookies, body);
      expect(read.res.status).toBe(400);
      expect(read.body.code).toBe("invalid_input");
      expect(addressCalls).toEqual([]);
    }
  });

  it("does not call Elastic Path when the member has no organisation", async () => {
    const auth = buildAuth();
    store.accounts = [];
    const cookies = await signedIn(auth);
    addressCalls = [];
    fetchUrls = [];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(body.addresses).toBeUndefined();
    expect(addressCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("does not use the anchor when none of several organisations is selected", async () => {
    const auth = buildAuth();
    const cookies = await signedIn(auth);
    addressCalls = [];
    fetchUrls = [];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(body.addresses).toBeUndefined();
    expect(addressCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("does not call Elastic Path for a lapsed selected account", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    store.ttlSeconds = 1;
    const cookies = await signedIn(auth);
    vi.setSystemTime(Date.now() + 5_000);
    addressCalls = [];
    fetchUrls = [];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("account_lapsed");
    expect(body.addresses).toBeUndefined();
    expect(addressCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("refuses a selected slot that has no token", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await signedIn(auth);
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccount = { id: "acct-north", name: "Acme North" };
      session.epAnchorToken = {
        token: "anchor-must-not-be-sent",
        expires: Math.floor(Date.now() / 1000) + 3600,
      };
    });
    addressCalls = [];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(addressCalls).toEqual([]);
    expectNoSecrets(body);
  });

  it("reads with the selected account id and token, not the anchor", async () => {
    const auth = buildAuth();
    let cookies = await signedIn(auth);
    cookies = await selectAccount(auth, cookies, "acct-south");
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccessToken = SESSION_IMPLICIT;
      session.epAnchorToken = {
        token: "anchor-must-not-be-sent",
        expires: Math.floor(Date.now() / 1000) + 3600,
      };
    });
    addressReplies = [{ status: 200, body: addressPage(1, null, "acct-south") }];
    addressCalls = [];
    fetchUrls = [];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(200);
    expect(addressCalls).toEqual([
      {
        url: addressCalls[0].url,
        accountId: "acct-south",
        authorization: `Bearer ${SESSION_IMPLICIT}`,
        accountToken: accountTokenFor("acct-south"),
        limit: "100",
        offset: "0",
      },
    ]);
    expect(addressCalls[0].accountToken).not.toBe("anchor-must-not-be-sent");
    expect(addressCalls[0].accountToken).not.toBe(accountTokenFor("acct-north"));
    expect(fetchUrls.filter((url) => url.includes("/oauth/"))).toEqual([]);
    expect(body.addresses).toEqual([
      {
        id: "addr-0",
        name: "Place 0",
        first_name: "Ada",
        last_name: "Lovelace",
        company_name: "Analytical",
        phone_number: "555",
        instructions: "behind the bin",
        line_1: SECRET_STREET,
        line_2: "Unit 2",
        city: "London",
        county: "Greater London",
        region: "England",
        postcode: "SW1A 1AA",
        country: "GB",
      },
    ]);
    expect(body.total).toBe(1);
    expect(JSON.stringify(body)).not.toContain("secret-link");
    expect(JSON.stringify(body)).not.toContain("secret-meta");
    expect(JSON.stringify(body)).not.toContain(FOREIGN_TOKEN);
    expect(JSON.stringify(body)).not.toContain('"type"');
    expect(loggedText()).not.toContain(SESSION_IMPLICIT);
    expect(loggedText()).not.toContain(accountTokenFor("acct-south"));
    expect(loggedText()).not.toContain(SECRET_STREET);
  });

  it("returns an empty list only after a selected account has none", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    addressReplies = [{ status: 200, body: { data: [], links: { next: null } } }];
    addressCalls = [];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(200);
    expect(body).toEqual({ addresses: [], total: 0 });
    expect(addressCalls).toHaveLength(1);
    expect(addressCalls[0].accountId).toBe("acct-north");
  });

  it("drops rows that are not a saved address of this account", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    addressReplies = [
      {
        status: 200,
        body: {
          data: [
            {
              id: "addr-home",
              name: "Home",
              city: 12,
              line_1: "1 High Street",
              relationships: { account: { id: "acct-north" } },
              links: { self: "https://api.test.elasticpath.com/secret-link" },
              meta: { timestamps: { created_at: "secret-meta" } },
              type: "address",
            },
            { id: "", name: "blank" },
            { name: "missing-id", line_1: "nowhere" },
            {
              id: "addr-foreign",
              line_1: "other book",
              relationships: { account: { id: "acct-south" } },
            },
            {
              id: "addr-nested-foreign",
              relationships: { account: { data: { id: "acct-south" } } },
            },
          ],
          links: { next: null },
          meta: { results: { total: 5 } },
        },
      },
    ];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(200);
    expect(body).toEqual({
      addresses: [{ id: "addr-home", name: "Home", line_1: "1 High Street" }],
      total: 1,
    });
    expect(JSON.stringify(body)).not.toContain("secret-link");
    expect(JSON.stringify(body)).not.toContain("acct-south");
  });

  it("walks pages internally and stops on a short page", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    addressReplies = [
      { status: 200, body: addressPage(100, "https://evil.example/next") },
      { status: 200, body: addressPage(2, "https://evil.example/still-next") },
    ];
    addressCalls = [];
    fetchUrls = [];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(200);
    expect(addressCalls.map((call) => call.offset)).toEqual(["0", "100"]);
    expect(addressCalls.every((call) => call.limit === "100")).toBe(true);
    expect(body.addresses).toHaveLength(102);
    expect(body.total).toBe(102);
    expect(fetchUrls.some((url) => url.includes("evil.example"))).toBe(false);
    expect(body.total).not.toBe(99999);
  });

  it("stops when the first full page has no next link", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    addressReplies = [{ status: 200, body: addressPage(100, null) }];
    addressCalls = [];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(200);
    expect(addressCalls).toHaveLength(1);
    expect(body.total).toBe(100);
  });

  it("fails the read when ten full pages still have another page", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    addressReplies = Array.from({ length: 11 }, () => ({
      status: 200,
      body: addressPage(100, "https://evil.example/next"),
    }));
    addressCalls = [];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_addresses_read_failed");
    expect(body.addresses).toBeUndefined();
    expect(addressCalls).toHaveLength(10);
    expect(addressCalls[9].offset).toBe("900");
    expect(JSON.stringify(body)).not.toContain(SECRET_STREET);
    expect(loggedText()).not.toContain(SECRET_STREET);
    expect(loggedText()).not.toContain(accountTokenFor("acct-north"));
  });

  it("keeps an Elastic Path error status and does not echo the body", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    addressReplies = [
      {
        status: 404,
        body: { errors: [{ detail: SECRET_STREET, title: "Not Found" }] },
      },
    ];

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(404);
    expect(body.code).toBe("account_addresses_read_failed");
    expect(body.addresses).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SECRET_STREET);
    expect(loggedText()).not.toContain(SECRET_STREET);
  });

  it("reports a transport failure as 502", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    addressThrow = new Error(`socket down ${SECRET_STREET}`);

    const { res, body } = await readAddresses(auth, cookies);
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_addresses_read_failed");
    expect(body.message).toBe("Elastic Path was unreachable.");
    expect(JSON.stringify(body)).not.toContain(SECRET_STREET);
    expect(loggedText()).not.toContain(SECRET_STREET);
    expect(loggedText()).not.toContain(accountTokenFor("acct-north"));
  });
});
