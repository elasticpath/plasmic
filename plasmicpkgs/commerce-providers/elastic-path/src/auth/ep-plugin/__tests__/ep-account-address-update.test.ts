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
let updateCalls: {
  url: string;
  method: string;
  accountId: string | null;
  addressId: string | null;
  authorization: string | null;
  accountToken: string | null;
  body: unknown;
}[];
let fetchUrls: string[];
let updateReplies: Array<{ status: number; body: unknown }>;
let updateThrow: Error | null;
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
    id: "addr-1",
    name: "Home",
    first_name: "Ada",
    last_name: "Lovelace",
    company_name: "Analytical",
    phone_number: "555",
    instructions: "behind the bin",
    line_1: SECRET_STREET,
    line_2: "Unit 2",
    city: "Updated City",
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
    const match = parsed.pathname.match(
      /^\/v2\/accounts\/([^/]+)\/addresses\/([^/]+)$/
    );
    if (match && request.method === "PUT") {
      updateCalls.push({
        url: u,
        method: request.method,
        accountId: decodeURIComponent(match[1]),
        addressId: decodeURIComponent(match[2]),
        authorization: headerValue(request.headers, "Authorization"),
        accountToken: headerValue(request.headers, EP_ACCOUNT_TOKEN_HEADER),
        body: request.body,
      });
      if (updateThrow) throw updateThrow;
      const reply = updateReplies.shift() ?? {
        status: 200,
        body: { data: addressResource(decodeURIComponent(match[1])) },
      };
      return json(reply.body, reply.status);
    }

    throw new Error(`Unexpected URL: ${u}`);
  }) as any;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  tokenGeneration = 0;
  updateReplies = [];
  updateThrow = null;
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

async function updateAddress(auth: any, cookies: string, body: unknown) {
  const res = await auth.api.epAccountAddressUpdate({
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
  id: "addr-1",
  name: "Home",
  first_name: "Ada",
  last_name: "Lovelace",
  company_name: "Analytical",
  phone_number: "555",
  instructions: "behind the bin",
  line_1: SECRET_STREET,
  line_2: "Unit 2",
  city: "Updated City",
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
  updateCalls = [];
  fetchUrls = [];
  return cookies;
}

describe("updating a saved account address", () => {
  it("refuses when there is no session and does not call Elastic Path", async () => {
    const auth = buildAuth();
    const { res, body } = await updateAddress(auth, "", {
      id: "addr-1",
      city: "Manchester",
    });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_session");
    expect(updateCalls).toEqual([]);
  });

  it("refuses an anonymous session", async () => {
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    updateCalls = [];
    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_account_member");
    expect(updateCalls).toEqual([]);
  });

  it("rejects a bad body before calling Elastic Path", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    const bodies = [
      {},
      [],
      null,
      "addr-1",
      { city: "Manchester" },
      { id: "   " },
      { id: 12, city: "Manchester" },
      { id: "addr-1" },
      { id: "addr-1", city: 12 },
      { id: "addr-1", accountId: "acct-south", city: "Manchester" },
      { id: "addr-1", accountToken: "browser-token", city: "Manchester" },
      { id: "addr-1", token: "browser-token", city: "Manchester" },
      { id: "addr-1", type: "address", city: "Manchester" },
      { id: "addr-1", filter: "eq(country,GB)", city: "Manchester" },
      { id: "addr-1", limit: 1, city: "Manchester" },
      { id: "addr-1", offset: 10, city: "Manchester" },
      { id: "addr-1", page: { limit: 1 }, city: "Manchester" },
      { id: "addr-1", relationships: {}, city: "Manchester" },
      { id: "addr-1", meta: {}, city: "Manchester" },
      { id: "addr-1", links: {}, city: "Manchester" },
      { id: "addr-1", line_3: "Floor 2", city: "Manchester" },
      { id: "addr-1", client: {}, city: "Manchester" },
    ];

    for (const body of bodies) {
      updateCalls = [];
      const updated = await updateAddress(auth, cookies, body);
      expect(updated.res.status).toBe(400);
      expect(updated.body.code).toBe("invalid_input");
      expect(updateCalls).toEqual([]);
    }
  });

  it("preserves an explicit empty string and trims the address id", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    updateCalls = [];

    const { res } = await updateAddress(auth, cookies, {
      id: "  addr-foreign  ",
      phone_number: "",
      city: "  Manchester  ",
      country: "",
    });
    expect(res.status).toBe(200);
    expect(updateCalls[0].addressId).toBe("addr-foreign");
    expect(updateCalls[0].body).toEqual({
      data: {
        type: "address",
        phone_number: "",
        city: "Manchester",
        country: "",
      },
    });
    expect(JSON.stringify(updateCalls[0].body)).not.toContain('"id"');
  });

  it("uppercases a known country code and rejects an unknown one", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    updateCalls = [];

    const ok = await updateAddress(auth, cookies, {
      id: "addr-1",
      country: " pk ",
    });
    expect(ok.res.status).toBe(200);
    expect(updateCalls[0].body).toEqual({
      data: { type: "address", country: "PK" },
    });

    updateCalls = [];
    const rejected = await updateAddress(auth, cookies, {
      id: "addr-1",
      country: "XX",
    });
    expect(rejected.res.status).toBe(400);
    expect(rejected.body.message).toBe(
      "country must be a two-letter country code."
    );
    expect(updateCalls).toEqual([]);
  });

  it("does not call Elastic Path when the member has no organisation", async () => {
    const auth = buildAuth();
    store.accounts = [];
    const cookies = await signedIn(auth);
    updateCalls = [];
    fetchUrls = [];

    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(updateCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("does not use the anchor when none of several organisations is selected", async () => {
    const auth = buildAuth();
    const cookies = await signedIn(auth);
    updateCalls = [];
    fetchUrls = [];

    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(updateCalls).toEqual([]);
    expect(fetchUrls.filter((url) => url.includes("/addresses/"))).toEqual([]);
    expect(fetchUrls.filter((url) => url.includes("/oauth/"))).toEqual([]);
  });

  it("does not call Elastic Path for a lapsed selected account", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    store.ttlSeconds = 1;
    const cookies = await signedIn(auth);
    vi.setSystemTime(Date.now() + 5_000);
    updateCalls = [];
    fetchUrls = [];

    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(res.status).toBe(401);
    expect(body.code).toBe("account_lapsed");
    expect(updateCalls).toEqual([]);
    expect(fetchUrls.filter((url) => url.includes("/addresses/"))).toEqual([]);
  });

  it.each([
    ["access token", (session: any) => { delete session.epAccessToken; }],
    ["host", (session: any) => { delete session.epHost; }],
    ["client id", (session: any) => { delete session.epClientId; }],
  ])("does not call Elastic Path when the %s is missing", async (_label, strip) => {
    const auth = buildAuth();
    let cookies = await selectedSession(auth);
    cookies = await replaceCachedSession(auth, cookies, strip);
    updateCalls = [];

    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_address_update_failed");
    expect(body.message).toBe("Elastic Path was unreachable.");
    expect(updateCalls).toEqual([]);
  });

  it("updates beneath the selected account and returns the sanitized address", async () => {
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
    updateReplies = [
      { status: 200, body: { data: addressResource("acct-south") } },
    ];
    updateCalls = [];
    fetchUrls = [];

    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-other-account",
      city: "Manchester",
    });
    expect(res.status).toBe(200);
    expect(updateCalls).toEqual([
      {
        url: `${EP_HOST}/v2/accounts/acct-south/addresses/addr-other-account`,
        method: "PUT",
        accountId: "acct-south",
        addressId: "addr-other-account",
        authorization: `Bearer ${SESSION_IMPLICIT}`,
        accountToken: accountTokenFor("acct-south"),
        body: { data: { type: "address", city: "Manchester" } },
      },
    ]);
    expect(updateCalls[0].accountToken).not.toBe("anchor-must-not-be-sent");
    expect(fetchUrls.filter((url) => url.includes("/oauth/"))).toEqual([]);
    expect(body).toEqual(SANITIZED);
    expect(JSON.stringify(body)).not.toContain('"type"');
    expect(JSON.stringify(body)).not.toContain("relationships");
    expectNoSecrets(body);
  });

  it("fails closed when the success body has no address", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    for (const reply of [
      { status: 200, body: {} },
      { status: 200, body: { data: null } },
      { status: 200, body: { data: { city: "Manchester" } } },
      { status: 200, body: { data: { id: "" } } },
    ]) {
      updateReplies = [reply];
      const updated = await updateAddress(auth, cookies, {
        id: "addr-1",
        city: "Manchester",
      });
      expect(updated.res.status).toBe(502);
      expect(updated.body.code).toBe("account_address_update_failed");
      expect(updated.body.message).toBe(
        "Elastic Path rejected the account-address update."
      );
      expect(updated.body.id).toBeUndefined();
    }
  });

  it("fails closed when a successful response names another account", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    updateReplies = [
      {
        status: 200,
        body: {
          data: addressResource("acct-north", {
            relationships: { account: { id: "acct-south", type: "account" } },
          }),
        },
      },
    ];

    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_address_update_failed");
    expect(body.id).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("acct-south");
    expect(JSON.stringify(body)).not.toContain(SECRET_STREET);
    expectNoSecrets(body);
  });

  it("accepts an updated address that does not name its account", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    const data = addressResource("acct-north");
    delete (data as { relationships?: unknown }).relationships;
    updateReplies = [{ status: 200, body: { data } }];

    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(res.status).toBe(200);
    expect(body.id).toBe("addr-1");
    expect(body.relationships).toBeUndefined();
  });

  it("surfaces an Elastic Path 400 detail, then title, then the generic message", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);

    updateReplies = [
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
        },
      },
    ];
    const detail = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(detail.res.status).toBe(400);
    expect(detail.body.message).toBe("country is not a valid ISO code");
    expect(JSON.stringify(detail.body)).not.toContain("Bad Request");
    expect(JSON.stringify(detail.body)).not.toContain("secret.example");

    updateReplies = [
      {
        status: 400,
        body: { errors: [{ detail: "  ", title: "Postcode is invalid" }] },
      },
    ];
    const title = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(title.body.message).toBe("Postcode is invalid");

    updateReplies = [{ status: 400, body: { errors: [{ detail: 12 }] } }];
    const generic = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(generic.body.message).toBe(
      "Elastic Path rejected the account-address update."
    );
    expect(JSON.stringify(generic.body)).not.toContain("12");
  });

  it("keeps a foreign address id's 404 generic", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    updateReplies = [
      {
        status: 404,
        body: {
          errors: [
            {
              detail: SECRET_STREET,
              title: "Address not found",
            },
          ],
        },
      },
    ];
    updateCalls = [];

    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-other-account",
      city: "Manchester",
    });
    expect(updateCalls[0].url).toBe(
      `${EP_HOST}/v2/accounts/acct-north/addresses/addr-other-account`
    );
    expect(updateCalls[0].accountToken).toBe(accountTokenFor("acct-north"));
    expect(res.status).toBe(404);
    expect(body.code).toBe("account_address_update_failed");
    expect(body.message).toBe(
      "Elastic Path rejected the account-address update."
    );
    expect(JSON.stringify(body)).not.toContain(SECRET_STREET);
    expect(JSON.stringify(body)).not.toContain("Address not found");
  });

  it("reports a transport failure as 502", async () => {
    const auth = buildAuth();
    const cookies = await selectedSession(auth);
    updateThrow = new Error(`socket down ${SECRET_STREET}`);

    const { res, body } = await updateAddress(auth, cookies, {
      id: "addr-1",
      city: "Manchester",
    });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_address_update_failed");
    expect(body.message).toBe("Elastic Path was unreachable.");
    expect(JSON.stringify(body)).not.toContain(SECRET_STREET);
    expect(loggedText()).not.toContain(SECRET_STREET);
  });
});
