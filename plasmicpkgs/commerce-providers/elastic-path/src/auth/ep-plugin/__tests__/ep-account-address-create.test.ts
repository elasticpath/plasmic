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

const INPUT = {
  name: " Home ",
  first_name: "Ada",
  last_name: "Lovelace",
  company_name: "Analytical",
  phone_number: "555",
  instructions: "behind the bin",
  line_1: `  ${SECRET_STREET}  `,
  line_2: "Unit 2",
  city: "London",
  county: "Greater London",
  region: "England",
  postcode: "SW1A 1AA",
  country: "GB",
};

let originalFetch: typeof fetch;
let tokenGeneration = 0;
let store: {
  accounts: { id: string; name: string }[];
  ttlSeconds: number;
};
let createCalls: {
  url: string;
  method: string;
  accountId: string | null;
  authorization: string | null;
  accountToken: string | null;
  body: unknown;
}[];
let fetchUrls: string[];
let createReplies: Array<{ status: number; body: unknown }>;
let createThrow: Error | null;
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
      headers: url.headers as HeadersInit,
      body: jsonBody(await url.clone().text()),
    };
  }
  return {
    u: String(url),
    method: String(init.method ?? "GET"),
    headers: init.headers as HeadersInit,
    body: jsonBody(typeof init.body === "string" ? init.body : ""),
  };
}

function addressResource(accountId: string, patch: Record<string, unknown> = {}) {
  return {
    type: "address",
    id: "addr-new",
    name: "Home",
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
    links: { self: "https://api.test.elasticpath.com/secret-link" },
    meta: { timestamps: { created_at: "secret-meta" } },
    relationships: { account: { id: accountId, type: "account" } },
    token: FOREIGN_TOKEN,
    ...patch,
  };
}

function installFetch() {
  createCalls = [];
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
    if (accountId && request.method === "POST") {
      createCalls.push({
        url: u,
        method: request.method,
        accountId: decodeURIComponent(accountId),
        authorization: headerValue(request.headers, "Authorization"),
        accountToken: headerValue(request.headers, EP_ACCOUNT_TOKEN_HEADER),
        body: request.body,
      });
      if (createThrow) throw createThrow;
      const reply = createReplies.shift() ?? {
        status: 201,
        body: { data: addressResource(decodeURIComponent(accountId)) },
      };
      return json(reply.body, reply.status);
    }

    throw new Error(`Unexpected URL: ${u}`);
  }) as any;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  tokenGeneration = 0;
  createReplies = [];
  createThrow = null;
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

async function createAddress(auth: any, cookies: string, body: unknown = INPUT) {
  const res = await auth.api.epAccountAddressCreate({
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

const SANITIZED = {
  id: "addr-new",
  name: "Home",
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
};

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

async function selectedSession(auth: any, accountId = "acct-north") {
  store.accounts = [ACCOUNTS.find((account) => account.id === accountId)!];
  let cookies = await signedIn(auth);
  cookies = await replaceCachedSession(auth, cookies, (session) => {
    session.epAccessToken = SESSION_IMPLICIT;
    session.epAnchorToken = {
      token: "anchor-must-not-be-sent",
      expires: Math.floor(Date.now() / 1000) + 3600,
    };
  });
  createCalls = [];
  fetchUrls = [];
  return cookies;
}

describe("creating a saved account address", () => {
  it("refuses when there is no session and does not call Elastic Path", async () => {
    const auth = buildAuth();
    const { res, body } = await createAddress(auth, "");
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_session");
    expect(createCalls).toEqual([]);
  });

  it("refuses an anonymous session", async () => {
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    createCalls = [];
    const { res, body } = await createAddress(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_account_member");
    expect(createCalls).toEqual([]);
  });

  it("rejects a bad body before calling Elastic Path", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    const bodies = [
      {},
      [],
      null,
      "1 High Street",
      { line_1: "   " },
      { city: 12 },
      { id: "addr-1", line_1: "1 High Street" },
      { accountId: "acct-south", line_1: "1 High Street" },
      { accountToken: "browser-token", line_1: "1 High Street" },
      { token: "browser-token", line_1: "1 High Street" },
      { type: "address", line_1: "1 High Street" },
      { filter: "eq(country,GB)", line_1: "1 High Street" },
      { limit: 1, line_1: "1 High Street" },
      { offset: 10, line_1: "1 High Street" },
      { page: { limit: 1 }, line_1: "1 High Street" },
      { relationships: {}, line_1: "1 High Street" },
      { meta: {}, line_1: "1 High Street" },
      { links: {}, line_1: "1 High Street" },
      { line_3: "Floor 2", line_1: "1 High Street" },
    ];

    for (const body of bodies) {
      createCalls = [];
      const created = await createAddress(auth, cookies, body);
      expect(created.res.status).toBe(400);
      expect(created.body.code).toBe("invalid_input");
      expect(createCalls).toEqual([]);
    }
  });

  it("does not call Elastic Path when the member has no organisation", async () => {
    const auth = buildAuth();
    store.accounts = [];
    const cookies = await signedIn(auth);
    createCalls = [];
    fetchUrls = [];

    const { res, body } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
    });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(body.id).toBeUndefined();
    expect(createCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("does not use the anchor when none of several organisations is selected", async () => {
    const auth = buildAuth();
    const cookies = await signedIn(auth);
    createCalls = [];
    fetchUrls = [];

    const { res, body } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
    });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(createCalls).toEqual([]);
    expect(fetchUrls.filter((url) => url.includes("/addresses"))).toEqual([]);
    expect(fetchUrls.filter((url) => url.includes("/oauth/"))).toEqual([]);
  });

  it("does not call Elastic Path for a lapsed selected account", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    store.ttlSeconds = 1;
    const cookies = await signedIn(auth);
    vi.setSystemTime(Date.now() + 5_000);
    createCalls = [];
    fetchUrls = [];

    const { res, body } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
    });
    expect(res.status).toBe(401);
    expect(body.code).toBe("account_lapsed");
    expect(body.id).toBeUndefined();
    expect(createCalls).toEqual([]);
    expect(fetchUrls.filter((url) => url.includes("/addresses"))).toEqual([]);
  });

  it.each([
    ["access token", (session: any) => { delete session.epAccessToken; }],
    ["host", (session: any) => { delete session.epHost; }],
    ["client id", (session: any) => { delete session.epClientId; }],
  ])("does not call Elastic Path when the %s is missing", async (_label, strip) => {
    const auth = buildAuth();
    let cookies = await selectedSession(auth);
    cookies = await replaceCachedSession(auth, cookies, strip);
    createCalls = [];

    const { res, body } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
    });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_address_create_failed");
    expect(body.message).toBe("Elastic Path was unreachable.");
    expect(createCalls).toEqual([]);
  });

  it.each([200, 201])(
    "creates with the selected account on %s and returns the sanitized address",
    async (status) => {
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
      createReplies = [
        { status, body: { data: addressResource("acct-south") } },
      ];
      createCalls = [];
      fetchUrls = [];

      const { res, body } = await createAddress(auth, cookies);
      expect(res.status).toBe(200);
      expect(createCalls).toEqual([
        {
          url: `${EP_HOST}/v2/accounts/acct-south/addresses`,
          method: "POST",
          accountId: "acct-south",
          authorization: `Bearer ${SESSION_IMPLICIT}`,
          accountToken: accountTokenFor("acct-south"),
          body: {
            data: {
              type: "address",
              name: "Home",
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
          },
        },
      ]);
      expect(createCalls[0].accountToken).not.toBe("anchor-must-not-be-sent");
      expect(fetchUrls.filter((url) => url.includes("/oauth/"))).toEqual([]);
      expect(body).toEqual(SANITIZED);
      expect(JSON.stringify(body)).not.toContain('"type"');
      expectNoSecrets(body);
    }
  );

  it("fails closed when the success body has no address", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    for (const reply of [
      { status: 201, body: {} },
      { status: 200, body: { data: null } },
      { status: 201, body: { data: { line_1: SECRET_STREET } } },
      { status: 201, body: { data: { id: "" } } },
    ]) {
      createReplies = [reply];
      createCalls = [];
      const created = await createAddress(auth, cookies, {
        line_1: "1 High Street",
      });
      expect(created.res.status).toBe(502);
      expect(created.body.code).toBe("account_address_create_failed");
      expect(created.body.message).toBe(
        "Elastic Path rejected the account-address create."
      );
      expect(created.body.id).toBeUndefined();
      expect(JSON.stringify(created.body)).not.toContain(SECRET_STREET);
    }
  });

  it("fails closed when the address belongs to another account", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    createReplies = [
      {
        status: 201,
        body: {
          data: addressResource("acct-north", {
            relationships: { account: { id: "acct-south", type: "account" } },
          }),
        },
      },
    ];

    const { res, body } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
    });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_address_create_failed");
    expect(body.id).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("acct-south");
    expect(JSON.stringify(body)).not.toContain(SECRET_STREET);
    expectNoSecrets(body);
  });

  it("accepts a created address that does not name its account", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    const data = addressResource("acct-north");
    delete (data as { relationships?: unknown }).relationships;
    createReplies = [{ status: 201, body: { data } }];

    const { res, body } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
    });
    expect(res.status).toBe(200);
    expect(body.id).toBe("addr-new");
    expect(body.line_1).toBe(SECRET_STREET);
    expect(body.relationships).toBeUndefined();
  });

  it("forwards a sparse address that omits the default mandatory fields", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    createCalls = [];

    const { res } = await createAddress(auth, cookies, { city: "Lahore" });
    expect(res.status).toBe(200);
    expect(createCalls[0].body).toEqual({
      data: { type: "address", city: "Lahore" },
    });
  });

  it("uppercases a known country code before calling Elastic Path", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    createCalls = [];

    const { res } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
      country: " pk ",
    });
    expect(res.status).toBe(200);
    expect(createCalls[0].body).toEqual({
      data: {
        type: "address",
        line_1: "1 High Street",
        country: "PK",
      },
    });
  });

  it.each(["Pakistan", "XX", "uk"])(
    "rejects %s before calling Elastic Path",
    async (country) => {
      const auth = buildAuth();
      const cookies = await selectedSession(auth);
      createCalls = [];

      const { res, body } = await createAddress(auth, cookies, {
        line_1: "1 High Street",
        country,
      });
      expect(res.status).toBe(400);
      expect(body.code).toBe("invalid_input");
      expect(body.message).toBe("country must be a two-letter country code.");
      expect(createCalls).toEqual([]);
    }
  );

  it("surfaces an Elastic Path 400 detail and not the rest of the error", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    createReplies = [
      {
        status: 400,
        body: {
          errors: [
            {
              detail: "country is not a valid ISO code",
              title: "Bad Request",
              source: "/data/attributes/country",
            },
          ],
          links: { self: "https://secret.example/leak" },
          meta: { token: "meta-token" },
        },
      },
    ];

    const { res, body } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
    });
    expect(res.status).toBe(400);
    expect(body.code).toBe("account_address_create_failed");
    expect(body.message).toBe("country is not a valid ISO code");
    expect(Object.keys(body).sort()).toEqual(["code", "error", "message"]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Bad Request");
    expect(serialized).not.toContain("/data/attributes/country");
    expect(serialized).not.toContain("secret.example");
    expect(serialized).not.toContain("meta-token");
    expect(loggedText()).not.toContain("secret.example");
  });

  it("uses an Elastic Path 400 title when detail is absent", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    createReplies = [
      {
        status: 400,
        body: { errors: [{ detail: 12, title: "Postcode is invalid" }] },
      },
    ];

    const { res, body } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
    });
    expect(res.status).toBe(400);
    expect(body.message).toBe("Postcode is invalid");
    expect(JSON.stringify(body)).not.toContain("12");
  });

  it.each([404, 500])(
    "keeps a generic message for Elastic Path %s",
    async (status) => {
      const auth = buildAuth();
      const cookies = await selectedSession(auth);
      createReplies = [
        {
          status,
          body: {
            errors: [{ detail: SECRET_STREET, title: "Bad Request" }],
            links: { self: "https://secret.example/leak" },
          },
        },
      ];

      const { res, body } = await createAddress(auth, cookies, {
        line_1: "1 High Street",
      });
      expect(res.status).toBe(status);
      expect(body.code).toBe("account_address_create_failed");
      expect(body.message).toBe(
        "Elastic Path rejected the account-address create."
      );
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(SECRET_STREET);
      expect(serialized).not.toContain("Bad Request");
      expect(serialized).not.toContain("secret.example");
    }
  );

  it("reports a transport failure as 502", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    createThrow = new Error(`socket down ${SECRET_STREET}`);

    const { res, body } = await createAddress(auth, cookies, {
      line_1: "1 High Street",
    });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_address_create_failed");
    expect(body.message).toBe("Elastic Path was unreachable.");
    expect(JSON.stringify(body)).not.toContain(SECRET_STREET);
    expect(loggedText()).not.toContain(SECRET_STREET);
    expect(loggedText()).not.toContain(accountTokenFor("acct-north"));
  });
});
