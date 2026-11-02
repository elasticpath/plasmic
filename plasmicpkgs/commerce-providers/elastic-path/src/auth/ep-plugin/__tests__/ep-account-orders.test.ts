import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { getCookieCache, setCookieCache } from "better-auth/cookies";
import { epPlugin } from "../ep-plugin";
import { DEFAULT_HOST_ALLOWLIST } from "../../host-allowlist";
import { EP_ACCOUNT_TOKEN_HEADER } from "../envelope";
import { toAccountOrder } from "../account-orders";

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
const NORTH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOUTH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ACCOUNTS = [
  { id: NORTH, name: "Acme North" },
  { id: SOUTH, name: "Acme South" },
];

let originalFetch: typeof fetch;
let tokenGeneration = 0;
let store: {
  accounts: { id: string; name: string }[];
  ttlSeconds: number;
};
let orderCalls: {
  url: string;
  pathname: string;
  authorization: string | null;
  accountToken: string | null;
  limit: string | null;
  offset: string | null;
  filter: string | null;
  include: string | null;
  sort: string | null;
}[];
let fetchUrls: string[];
let orderReplies: Array<{ status: number; body: unknown }>;
let orderThrow: Error | null;
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

function ownedOrder(
  id: string,
  accountId = NORTH,
  patch: Record<string, unknown> = {}
) {
  return {
    type: "order",
    id,
    order_number: `N-${id}`,
    status: "complete",
    payment: "paid",
    shipping: "fulfilled",
    external_ref: "secret-ext",
    anonymized: true,
    payment_intent_id: "pi_secret",
    custom_attributes: { note: "secret-attr" },
    customer: { id: "cust-secret", email: "secret@example.com", name: "Secret" },
    contact: { email: "secret-contact@example.com", name: "Secret Contact" },
    billing_address: { line_1: SECRET_STREET },
    shipping_address: { line_1: SECRET_STREET },
    links: { self: "https://api.test.elasticpath.com/secret-link" },
    meta: {
      timestamps: {
        created_at: "2024-01-02T03:04:05Z",
        updated_at: "secret-meta",
      },
      is_manual: true,
      display_price: {
        with_tax: {
          amount: 2500,
          currency: "USD",
          formatted: "$25.00",
          float_price: 999,
        },
        without_tax: { amount: 2000, currency: "USD", formatted: "$20.00" },
      },
    },
    relationships: {
      account: {
        id: "not-the-owner",
        data: { type: "account", id: accountId },
      },
      items: { data: [{ id: "item-secret" }] },
    },
    token: FOREIGN_TOKEN,
    ...patch,
  };
}

function orderPage(
  count: number,
  accountId = NORTH,
  total: number = count
) {
  return {
    data: Array.from({ length: count }, (_, index) =>
      ownedOrder(`order-${index}`, accountId)
    ),
    links: { next: "https://evil.example/next" },
    meta: { results: { total }, token: FOREIGN_TOKEN },
  };
}

function installFetch() {
  orderCalls = [];
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
      const raw = typeof init.body === "string" ? init.body : "";
      if (raw.includes("client_credentials")) {
        throw new Error("client credentials must not be minted");
      }
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
    if (parsed.pathname === "/v2/orders") {
      orderCalls.push({
        url: u,
        pathname: parsed.pathname,
        authorization: headerValue(request.headers, "Authorization"),
        accountToken: headerValue(request.headers, EP_ACCOUNT_TOKEN_HEADER),
        limit: parsed.searchParams.get("page[limit]"),
        offset: parsed.searchParams.get("page[offset]"),
        filter: parsed.searchParams.get("filter"),
        include: parsed.searchParams.get("include"),
        sort: parsed.searchParams.get("sort"),
      });
      if (orderThrow) throw orderThrow;
      const reply = orderReplies.shift() ?? {
        status: 200,
        body: orderPage(0, NORTH, 0),
      };
      return json(reply.body, reply.status);
    }

    throw new Error(`Unexpected URL: ${u}`);
  }) as any;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  tokenGeneration = 0;
  orderReplies = [];
  orderThrow = null;
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

async function readOrders(auth: any, cookies: string, body: unknown = {}) {
  const res = await auth.api.epAccountOrders({
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
  expect(text).not.toContain(accountTokenFor(NORTH));
  expect(text).not.toContain(accountTokenFor(SOUTH));
  expect(text).not.toContain("anon-token");
  expect(text).not.toContain(SESSION_IMPLICIT);
  expect(text).not.toContain(FOREIGN_TOKEN);
  expect(text).not.toContain("secret-link");
  expect(text).not.toContain("secret-meta");
  expect(text).not.toContain("secret-ext");
  expect(text).not.toContain("secret-attr");
  expect(text).not.toContain("pi_secret");
  expect(text).not.toContain(SECRET_STREET);
  expect(text).not.toContain("secret@example.com");
  expect(text).not.toContain("anchor-must-not-be-sent");
}

describe("reading account order history", () => {
  it("does not reach orders through the anchor, client credentials, or getAnOrder", () => {
    const plugin = readFileSync(new URL("../ep-plugin.ts", import.meta.url), "utf8");
    const orders = plugin.slice(
      plugin.indexOf("epAccountOrders:"),
      plugin.indexOf("epAccountAddressCreate:")
    );
    expect(orders).toContain("readAccountOrders");
    expect(orders).not.toContain("heldAccountCredential");
    expect(orders).not.toContain("getAnOrder");
    expect(orders).not.toContain("client_credentials");

    const reader = readFileSync(
      new URL("../account-orders.ts", import.meta.url),
      "utf8"
    );
    expect(reader).toContain("getCustomerOrders");
    expect(reader).not.toContain("getAnOrder");
    expect(reader).not.toContain("heldAccountCredential");
    expect(reader).not.toContain("client_credentials");
    expect(reader).not.toContain("createClientCredentials");
  });

  it("refuses when there is no session and does not call Elastic Path", async () => {
    const auth = buildAuth();
    const { res, body } = await readOrders(auth, "");
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_session");
    expect(orderCalls).toEqual([]);
  });

  it("refuses an anonymous session", async () => {
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    orderCalls = [];
    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_account_member");
    expect(orderCalls).toEqual([]);
  });

  it("rejects a body field before calling Elastic Path", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderCalls = [];

    for (const body of [
      { accountId: SOUTH },
      { orderId: "order-1" },
      { filter: `eq(account_id,${SOUTH})` },
      { limit: 1 },
      { offset: 100 },
      { page: { limit: 1, offset: 0 } },
      { sort: "created_at" },
      { include: "items" },
      { token: "browser-token" },
      { accountToken: "browser-account-token" },
      { headers: { Authorization: "Bearer browser" } },
      { client: { id: "browser" } },
    ]) {
      orderCalls = [];
      const read = await readOrders(auth, cookies, body);
      expect(read.res.status).toBe(400);
      expect(read.body.code).toBe("invalid_input");
      expect(orderCalls).toEqual([]);
    }
  });

  it("does not call Elastic Path when the member has no organisation", async () => {
    const auth = buildAuth();
    store.accounts = [];
    const cookies = await signedIn(auth);
    orderCalls = [];
    fetchUrls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(body.orders).toBeUndefined();
    expect(orderCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("does not use the anchor when none of several organisations is selected", async () => {
    const auth = buildAuth();
    const cookies = await signedIn(auth);
    orderCalls = [];
    fetchUrls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(body.orders).toBeUndefined();
    expect(orderCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("does not call Elastic Path for a lapsed selected account", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    store.ttlSeconds = 1;
    const cookies = await signedIn(auth);
    vi.setSystemTime(Date.now() + 5_000);
    orderCalls = [];
    fetchUrls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("account_lapsed");
    expect(body.orders).toBeUndefined();
    expect(orderCalls).toEqual([]);
    expect(fetchUrls).toEqual([]);
  });

  it("refuses a selected slot that has no token", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await signedIn(auth);
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccount = { id: NORTH, name: "Acme North" };
      session.epAnchorToken = {
        token: "anchor-must-not-be-sent",
        expires: Math.floor(Date.now() / 1000) + 3600,
      };
    });
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_selected_account");
    expect(orderCalls).toEqual([]);
    expectNoSecrets(body);
  });

  it("does not put a non-canonical account id in the filter", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await signedIn(auth);
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccount.id = `eq(account_id,${SOUTH})`;
    });
    orderCalls = [];
    fetchUrls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(400);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.orders).toBeUndefined();
    expect(body.message).toBe("Elastic Path rejected the account-order read.");
    expect(orderCalls).toEqual([]);
    expect(fetchUrls.filter((url) => url.includes("/v2/orders"))).toEqual([]);
    expectNoSecrets(body);
  });

  it("accepts an uppercase account id and filters with its lowercase form", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await signedIn(auth);
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccount.id = NORTH.toUpperCase();
    });
    orderReplies = [
      {
        status: 200,
        body: orderPage(1, NORTH.toUpperCase(), 1),
      },
    ];
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0].filter).toBe(`eq(account_id,${NORTH})`);
    expect(orderCalls[0].filter).not.toContain(NORTH.toUpperCase());
    expect(body.orders.map((order: { id: string }) => order.id)).toEqual([
      "order-0",
    ]);
    expect(body.total).toBe(1);
  });

  it("accepts a mixed-case account id and an uppercase owned relationship", async () => {
    const mixed = NORTH.split("")
      .map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char))
      .join("");
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await signedIn(auth);
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccount.id = mixed;
    });
    orderReplies = [{ status: 200, body: orderPage(1, NORTH.toUpperCase(), 1) }];
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(orderCalls[0].filter).toBe(`eq(account_id,${NORTH})`);
    expect(body.orders).toEqual([
      expect.objectContaining({ id: "order-0" }),
    ]);
    expect(body.total).toBe(1);
    expect(JSON.stringify(body)).not.toContain(SOUTH);
  });

  it("reads with the selected account id and token, not the anchor", async () => {
    const auth = buildAuth();
    let cookies = await signedIn(auth);
    cookies = await selectAccount(auth, cookies, SOUTH);
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccessToken = SESSION_IMPLICIT;
      session.epAnchorToken = {
        token: "anchor-must-not-be-sent",
        expires: Math.floor(Date.now() / 1000) + 3600,
      };
    });
    orderReplies = [{ status: 200, body: orderPage(1, SOUTH, 1) }];
    orderCalls = [];
    fetchUrls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(orderCalls).toEqual([
      {
        url: orderCalls[0].url,
        pathname: "/v2/orders",
        authorization: `Bearer ${SESSION_IMPLICIT}`,
        accountToken: accountTokenFor(SOUTH),
        limit: "100",
        offset: "0",
        filter: `eq(account_id,${SOUTH})`,
        include: null,
        sort: null,
      },
    ]);
    expect(orderCalls[0].url).not.toContain("/v2/orders/");
    expect(orderCalls[0].accountToken).not.toBe("anchor-must-not-be-sent");
    expect(orderCalls[0].accountToken).not.toBe(accountTokenFor(NORTH));
    expect(fetchUrls.filter((url) => url.includes("/oauth/"))).toEqual([]);
    expect(fetchUrls.join("\n")).not.toContain("client_credentials");
    expect(body).toEqual({
      orders: [
        {
          id: "order-0",
          order_number: "N-order-0",
          status: "complete",
          payment: "paid",
          shipping: "fulfilled",
          created_at: "2024-01-02T03:04:05Z",
          total: {
            amount: 2500,
            currency: "USD",
            formatted: "$25.00",
            float_price: 25,
          },
        },
      ],
      total: 1,
    });
    expectNoSecrets(body);
    expect(JSON.stringify(body)).not.toContain("not-the-owner");
    expect(JSON.stringify(body)).not.toContain('"relationships"');
    expect(JSON.stringify(body)).not.toContain("is_manual");
    expect(JSON.stringify(body)).not.toContain("999");
  });

  it("returns an empty list only after a selected account has none", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderReplies = [{ status: 200, body: { data: [], meta: { results: { total: 0 } } } }];
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(body).toEqual({ orders: [], total: 0 });
    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0].filter).toBe(`eq(account_id,${NORTH})`);
  });

  it("drops rows that are not orders of this account", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderReplies = [
      {
        status: 200,
        body: {
          data: [
            ownedOrder("order-home", NORTH),
            ownedOrder("order-guest", NORTH, { relationships: undefined }),
            ownedOrder("order-direct-only", NORTH, {
              relationships: { account: { id: NORTH } },
            }),
            ownedOrder("order-foreign-data", NORTH, {
              relationships: {
                account: { id: NORTH, data: { id: SOUTH } },
              },
            }),
            ownedOrder("order-malformed", NORTH, {
              relationships: {
                account: { id: NORTH, data: { id: `${NORTH}/../secret` } },
              },
            }),
            ownedOrder("order-not-uuid", NORTH, {
              relationships: { account: { data: { id: "not-a-uuid" } } },
            }),
            ownedOrder("order-data-wins", NORTH, {
              relationships: {
                account: { id: SOUTH, data: { id: NORTH } },
              },
            }),
            ownedOrder("order-blank", NORTH, { id: "   " }),
            { order_number: "missing-id", relationships: { account: { data: { id: NORTH } } } },
            ownedOrder("order-unknown", NORTH, {
              status: "shipped",
              payment: "void",
              shipping: "partial",
              order_number: "  ",
              meta: {
                timestamps: { created_at: "2024-05-01T00:00:00Z" },
                display_price: {
                  with_tax: { amount: 100, currency: "USD" },
                },
              },
            }),
          ],
          meta: { results: { total: 10 } },
        },
      },
    ];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(body.orders.map((order: { id: string }) => order.id)).toEqual([
      "order-home",
      "order-data-wins",
      "order-unknown",
    ]);
    expect(body.total).toBe(3);
    expect(body.total).not.toBe(10);
    expect(body.orders.map((order: { id: string }) => order.id)).not.toEqual(
      expect.arrayContaining(["order-malformed", "order-not-uuid", "order-foreign-data"])
    );
    const unknown = body.orders[2];
    expect(unknown.status).toBeUndefined();
    expect(unknown.payment).toBeUndefined();
    expect(unknown.shipping).toBeUndefined();
    expect(unknown.order_number).toBeUndefined();
    expect(unknown.total).toBeUndefined();
    expect(unknown.created_at).toBe("2024-05-01T00:00:00Z");
    expectNoSecrets(body);
    expect(JSON.stringify(body)).not.toContain(SOUTH);
  });

  it("computes float_price from the currency exponent and ignores the upstream decimal", () => {
    const usd = toAccountOrder(
      ownedOrder("usd", NORTH, {
        meta: {
          display_price: {
            with_tax: {
              amount: 2500,
              currency: "USD",
              formatted: "$25.00",
              float_price: 1,
            },
          },
        },
      }),
      NORTH
    );
    const jpy = toAccountOrder(
      ownedOrder("jpy", NORTH, {
        meta: {
          display_price: {
            with_tax: {
              amount: 2500,
              currency: "JPY",
              formatted: "¥2,500",
              float_price: 25,
            },
          },
        },
      }),
      NORTH
    );
    const kwd = toAccountOrder(
      ownedOrder("kwd", NORTH, {
        meta: {
          display_price: {
            with_tax: {
              amount: 2500,
              currency: "KWD",
              formatted: "KWD 2.500",
              float_price: 25,
            },
          },
        },
      }),
      NORTH
    );
    expect(usd?.total?.float_price).toBe(25);
    expect(jpy?.total?.float_price).toBe(2500);
    expect(kwd?.total?.float_price).toBe(2.5);
    expect(
      toAccountOrder(
        {
          id: "no-price",
          relationships: { account: { data: { id: NORTH } } },
          created_at: "2024-01-01T00:00:00Z",
        },
        NORTH
      )
    ).toEqual({ id: "no-price" });
  });

  it("walks pages internally and stops when the result total is covered", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderReplies = [
      { status: 200, body: orderPage(100, NORTH, 102) },
      { status: 200, body: orderPage(2, NORTH, 102) },
    ];
    orderCalls = [];
    fetchUrls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(orderCalls.map((call) => call.offset)).toEqual(["0", "100"]);
    expect(orderCalls.every((call) => call.limit === "100")).toBe(true);
    expect(orderCalls.every((call) => call.filter === `eq(account_id,${NORTH})`)).toBe(
      true
    );
    expect(orderCalls.every((call) => call.accountToken === accountTokenFor(NORTH))).toBe(
      true
    );
    expect(body.orders).toHaveLength(102);
    expect(body.total).toBe(102);
    expect(fetchUrls.some((url) => url.includes("evil.example"))).toBe(false);
  });

  it("keeps reading a short page when the result total says more remain", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderReplies = [
      { status: 200, body: orderPage(2, NORTH, 102) },
      { status: 200, body: orderPage(100, NORTH, 102) },
    ];
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(orderCalls.map((call) => call.offset)).toEqual(["0", "100"]);
    expect(body.orders).toHaveLength(102);
    expect(body.total).toBe(102);
  });

  it("stops a short page when the result total is missing", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    const page = orderPage(2, NORTH, 2);
    delete (page.meta.results as { total?: number }).total;
    orderReplies = [
      { status: 200, body: page },
      { status: 200, body: orderPage(100, NORTH, 99999) },
    ];
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(orderCalls).toHaveLength(1);
    expect(body.total).toBe(2);
  });

  it("keeps reading a full page when the result total is missing", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    const full = orderPage(100, NORTH, 100);
    delete (full.meta.results as { total?: number }).total;
    const rest = orderPage(1, NORTH, 1);
    delete (rest.meta.results as { total?: number }).total;
    orderReplies = [
      { status: 200, body: full },
      { status: 200, body: rest },
    ];
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(orderCalls.map((call) => call.offset)).toEqual(["0", "100"]);
    expect(body.orders).toHaveLength(101);
    expect(body.total).toBe(101);
  });

  it("ends a missing total when the page after a full page is empty", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    const full = orderPage(100, NORTH, 100);
    delete (full.meta.results as { total?: number }).total;
    orderReplies = [
      { status: 200, body: full },
      { status: 200, body: { data: [], meta: {} } },
    ];
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(200);
    expect(orderCalls.map((call) => call.offset)).toEqual(["0", "100"]);
    expect(body.orders).toHaveLength(100);
    expect(body.total).toBe(100);
  });

  it("fails when an empty page disagrees with a total that still has rows", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderReplies = [
      { status: 200, body: orderPage(100, NORTH, 250) },
      { status: 200, body: { data: [], meta: { results: { total: 250 } } } },
    ];
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.message).toBe(
      "Elastic Path did not return the full order history."
    );
    expect(body.orders).toBeUndefined();
    expect(orderCalls.map((call) => call.offset)).toEqual(["0", "100"]);
    expectNoSecrets(body);
  });

  it("fails when the reported total is smaller than the raw rows received", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderReplies = [{ status: 200, body: orderPage(100, NORTH, 50) }];
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(502);
    expect(body.message).toBe(
      "Elastic Path did not return the full order history."
    );
    expect(body.orders).toBeUndefined();
    expect(orderCalls).toHaveLength(1);
    expectNoSecrets(body);
  });

  it.each([
    ["null", null],
    ["an object", { id: SECRET_STREET }],
  ] as const)(
    "rejects a successful response whose data is %s",
    async (_label, data) => {
      const auth = buildAuth();
      store.accounts = [ACCOUNTS[0]];
      const cookies = await signedIn(auth);
      orderReplies = [
        {
          status: 200,
          body: { data, meta: { results: { total: 0 }, note: SECRET_STREET } },
        },
      ];
      orderCalls = [];

      const { res, body } = await readOrders(auth, cookies);
      expect(res.status).toBe(502);
      expect(body.code).toBe("account_orders_read_failed");
      expect(body.message).toBe("Elastic Path rejected the account-order read.");
      expect(body.orders).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(SECRET_STREET);
      expect(orderCalls).toHaveLength(1);
    }
  );

  it.each([
    [999, 200, 999],
    [1000, 200, 1000],
    [1001, 502, undefined],
  ] as const)(
    "reads %s raw orders as %s",
    async (count, status, retained) => {
      const auth = buildAuth();
      store.accounts = [ACCOUNTS[0]];
      const cookies = await signedIn(auth);
      const pages = Math.min(10, Math.ceil(count / 100));
      orderReplies = Array.from({ length: pages }, (_, index) => {
        const remaining = count - index * 100;
        const size = Math.min(100, remaining);
        return { status: 200, body: orderPage(size, NORTH, count) };
      });
      orderCalls = [];

      const { res, body } = await readOrders(auth, cookies);
      expect(res.status).toBe(status);
      expect(orderCalls).toHaveLength(pages);
      if (status === 200) {
        expect(body.orders).toHaveLength(retained);
        expect(body.total).toBe(retained);
      } else {
        expect(body.orders).toBeUndefined();
        expect(body.message).toBe(
          "Elastic Path did not return the full order history."
        );
      }
    }
  );

  it("fails a full history with no total once the page cap is reached", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderReplies = Array.from({ length: 10 }, () => {
      const page = orderPage(100, NORTH, 100);
      delete (page.meta.results as { total?: number }).total;
      return { status: 200, body: page };
    });
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(502);
    expect(body.orders).toBeUndefined();
    expect(body.message).toBe(
      "Elastic Path did not return the full order history."
    );
    expect(orderCalls).toHaveLength(10);
    expectNoSecrets(body);
  });

  it("fails the read when ten full pages still have another page", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderReplies = Array.from({ length: 11 }, () => ({
      status: 200,
      body: orderPage(100, NORTH, 99999),
    }));
    orderCalls = [];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.message).toBe(
      "Elastic Path did not return the full order history."
    );
    expect(body.orders).toBeUndefined();
    expect(orderCalls).toHaveLength(10);
    expect(orderCalls[9].offset).toBe("900");
    expectNoSecrets(body);
  });

  it("keeps an Elastic Path error status and does not echo the body", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderReplies = [
      {
        status: 403,
        body: {
          errors: [{ detail: SECRET_STREET, title: "Forbidden" }],
        },
      },
    ];

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(403);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.message).toBe("Elastic Path rejected the account-order read.");
    expect(body.orders).toBeUndefined();
    expectNoSecrets(body);
  });

  it("reports a transport failure as 502", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderThrow = new Error(`socket down ${SECRET_STREET}`);

    const { res, body } = await readOrders(auth, cookies);
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.message).toBe("Elastic Path was unreachable.");
    expectNoSecrets(body);
  });
});
