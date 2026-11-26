import { readFileSync } from "node:fs";
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
const FOREIGN_TOKEN = "foreign-account-token";
const NORTH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOUTH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
  pathname: string;
  orderId: string;
  authorization: string | null;
  accountToken: string | null;
  include: string | null;
  status: number;
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

function detailDocument(
  accountId: string | undefined,
  patch: Record<string, unknown> = {}
) {
  return {
    data: {
      type: "order",
      id: ORDER,
      order_number: "1001",
      status: "complete",
      payment: "paid",
      shipping: "fulfilled",
      external_ref: "secret-ext",
      anonymized: true,
      payment_intent_id: "pi_secret",
      custom_attributes: { note: "secret-attr" },
      customer: {
        id: "cust-secret",
        email: "secret@example.com",
        name: "Secret",
      },
      contact: { email: "buyer@example.com", name: "Ada Lovelace" },
      billing_address: {
        first_name: "Ada",
        last_name: "Lovelace",
        line_1: "12 Analytical Engines",
        line_2: "",
        line_3: "Floor 3",
        city: "London",
        postcode: "SW1A 1AA",
        country: "GB",
        phone_number: "secret-billing-phone",
        instructions: "secret-billing-instructions",
      },
      shipping_address: {
        first_name: "Ada",
        last_name: "Lovelace",
        line_1: "12 Analytical Engines",
        line_2: "",
        city: "London",
        country: "GB",
        phone_number: "02079460000",
        instructions: "Leave at reception",
      },
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
        account:
          accountId === undefined
            ? undefined
            : { id: "not-the-owner", data: { type: "account", id: accountId } },
        items: {
          data: [{ type: "order_item", id: "item-1" }, { id: "item-ship" }],
        },
        customer: { data: { id: "cust-secret" } },
      },
      token: FOREIGN_TOKEN,
      ...patch,
    },
    included: {
      items: [
        {
          id: "item-1",
          name: "Deck shoe",
          sku: "deck-shoe",
          quantity: 2,
          product_id: "prod-1",
          custom_inputs: { secret: "item-secret" },
          discounts: [{ code: "secret-discount" }],
          meta: {
            display_price: {
              with_tax: {
                unit: {
                  amount: 250,
                  currency: "USD",
                  formatted: "$2.50",
                  float_price: 999,
                },
                value: {
                  amount: 500,
                  currency: "JPY",
                  formatted: "¥500",
                  float_price: 999,
                },
                without_tax: { amount: 200, currency: "USD", formatted: "$2.00" },
              },
            },
          },
        },
        {
          id: "item-ship",
          name: "Shipping",
          sku: "__ep_shipping",
          quantity: 1,
          product_id: "  ",
        },
        { id: "   ", name: "Dropped" },
      ],
      tax_items: [{ id: "tax-secret" }],
      promotions: [{ id: "promo-secret" }],
    },
  };
}

function installFetch() {
  orderCalls = [];
  fetchUrls = [];
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const request =
      typeof Request !== "undefined" && url instanceof Request
        ? { u: url.url, headers: url.headers as HeadersInit }
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
      throw new Error("detail read must not list orders");
    }
    if (parsed.pathname.startsWith("/v2/orders/") && parsed.pathname.endsWith("/items")) {
      throw new Error("detail read must not call getOrderItems");
    }
    if (parsed.pathname.startsWith("/v2/orders/")) {
      orderCalls.push({
        pathname: parsed.pathname,
        orderId: decodeURIComponent(parsed.pathname.slice("/v2/orders/".length)),
        authorization: headerValue(request.headers, "Authorization"),
        accountToken: headerValue(request.headers, EP_ACCOUNT_TOKEN_HEADER),
        include: parsed.searchParams.get("include"),
        status: 0,
      });
      if (orderThrow) throw orderThrow;
      const reply = orderReplies.shift() ?? {
        status: 200,
        body: detailDocument(NORTH),
      };
      orderCalls[orderCalls.length - 1].status = reply.status;
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

async function readOrder(auth: any, cookies: string, body: unknown) {
  const res = await auth.api.epAccountOrderRead({
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
  expect(text).not.toContain("secret@example.com");
  expect(text).not.toContain("secret-billing-phone");
  expect(text).not.toContain("secret-billing-instructions");
  expect(text).not.toContain("item-secret");
  expect(text).not.toContain("secret-discount");
  expect(text).not.toContain("tax-secret");
  expect(text).not.toContain("promo-secret");
  expect(text).not.toContain("cust-secret");
  expect(text).not.toContain("without_tax");
  expect(text).not.toContain("999");
  expect(text).not.toContain("anchor-must-not-be-sent");
  expect(text).not.toContain("client_credentials");
}

describe("reading one account order", () => {
  async function signedSelected() {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    const cookies = await signedIn(auth);
    orderCalls = [];
    fetchUrls = [];
    return { auth, cookies };
  }

  it("reads through getAnOrder, not the anchor, client credentials, or checkout", () => {
    const plugin = readFileSync(new URL("../ep-plugin.ts", import.meta.url), "utf8");
    const handler = plugin.slice(
      plugin.indexOf("epAccountOrderRead:"),
      plugin.indexOf("epAccountAddressCreate:")
    );
    expect(handler).toContain("readAccountOrder");
    expect(handler).not.toContain("heldAccountCredential");
    expect(handler).not.toContain("getAnOrder");
    expect(handler).not.toContain("getOrderItems");
    expect(handler).not.toContain("client_credentials");
    expect(handler).not.toContain("readOrderTotal");

    const reader = readFileSync(
      new URL("../account-order-detail.ts", import.meta.url),
      "utf8"
    );
    expect(reader).toContain("getAnOrder");
    expect(reader).toContain('include: ["items"]');
    expect(reader).toContain("EP_ACCOUNT_TOKEN_HEADER");
    expect(reader).not.toContain("getOrderItems");
    expect(reader).not.toContain("getCustomerOrders");
    expect(reader).not.toContain("heldAccountCredential");
    expect(reader).not.toContain("client_credentials");
    expect(reader).not.toContain("readOrderTotal");
  });

  it("refuses a missing session before it reads the body", async () => {
    const auth = buildAuth();
    const { res, body } = await readOrder(auth, "", { id: "not-a-uuid" });
    expect(res.status).toBe(401);
    expect(body.code).toBe("no_session");
    expect(orderCalls).toEqual([]);
  });

  it("checks the body before the account gates", async () => {
    const auth = buildAuth();
    const anon = await anonymous(auth);
    orderCalls = [];
    const noMember = await readOrder(auth, anon, { id: ORDER });
    expect(noMember.res.status).toBe(401);
    expect(noMember.body.code).toBe("no_account_member");
    expect(orderCalls).toEqual([]);

    orderCalls = [];
    const noMemberBadBody = await readOrder(auth, anon, { id: "order-1" });
    expect(noMemberBadBody.res.status).toBe(400);
    expect(noMemberBadBody.body.code).toBe("invalid_input");
    expect(orderCalls).toEqual([]);

    store.accounts = [...ACCOUNTS];
    const unselected = await signedIn(auth);
    orderCalls = [];
    const noSelection = await readOrder(auth, unselected, { id: ORDER });
    expect(noSelection.res.status).toBe(401);
    expect(noSelection.body.code).toBe("no_selected_account");
    expect(orderCalls).toEqual([]);
  });

  it.each([
    [{}, "Body must include only an order id."],
    [{ id: ORDER, accountId: NORTH }, "Body must include only an order id."],
    [{ id: ORDER, token: "browser-token" }, "Body must include only an order id."],
    [{ id: ORDER, include: "items" }, "Body must include only an order id."],
    [{ id: 7 }, "id must be a string."],
    [{ id: "order-1" }, "id must be a UUID."],
    [{ id: `  ${ORDER}  ` }, null],
  ])("validates the order id before Elastic Path %#", async (body, message) => {
    const { auth, cookies } = await signedSelected();
    const read = await readOrder(auth, cookies, body);
    if (message) {
      expect(read.res.status).toBe(400);
      expect(read.body.code).toBe("invalid_input");
      expect(read.body.message).toBe(message);
      expect(orderCalls).toEqual([]);
    } else {
      expect(read.res.status).toBe(200);
      expect(orderCalls[0].orderId).toBe(ORDER);
    }
  });

  it("does not call Elastic Path for a lapsed selected account", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    store.ttlSeconds = 1;
    const cookies = await signedIn(auth);
    vi.setSystemTime(Date.now() + 5_000);
    orderCalls = [];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(401);
    expect(body.code).toBe("account_lapsed");
    expect(orderCalls).toEqual([]);
  });

  it("does not put a non-canonical account id on the order read", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await signedIn(auth);
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccount.id = `eq(account_id,${SOUTH})`;
    });
    orderCalls = [];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.message).toBe("Elastic Path rejected the account-order read.");
    expect(orderCalls).toEqual([]);
    expectNoSecrets(body);
  });

  it("reads with the implicit bearer, the selected account token, and included items", async () => {
    const auth = buildAuth();
    store.accounts = [ACCOUNTS[0]];
    let cookies = await signedIn(auth);
    cookies = await replaceCachedSession(auth, cookies, (session) => {
      session.epAccessToken = SESSION_IMPLICIT;
      session.epAnchorToken = {
        token: "anchor-must-not-be-sent",
        expires: Math.floor(Date.now() / 1000) + 3600,
      };
    });
    orderCalls = [];
    fetchUrls = [];

    const { res, body } = await readOrder(auth, cookies, {
      id: ORDER.toUpperCase(),
    });

    expect(res.status).toBe(200);
    expect(orderCalls).toEqual([
      {
        pathname: `/v2/orders/${ORDER}`,
        orderId: ORDER,
        authorization: `Bearer ${SESSION_IMPLICIT}`,
        accountToken: accountTokenFor(NORTH),
        include: "items",
        status: 200,
      },
    ]);
    expect(fetchUrls.join("\n")).not.toContain("client_credentials");
    expect(fetchUrls.join("\n")).not.toContain("/items");
    expect(body).toEqual({
      id: ORDER,
      order_number: "1001",
      status: "complete",
      payment: "paid",
      shipping: "fulfilled",
      meta: {
        timestamps: { created_at: "2024-01-02T03:04:05Z" },
        display_price: {
          with_tax: {
            amount: 2500,
            currency: "USD",
            formatted: "$25.00",
            float_price: 25,
          },
        },
      },
      contact: { name: "Ada Lovelace", email: "buyer@example.com" },
      shipping_address: {
        first_name: "Ada",
        last_name: "Lovelace",
        line_1: "12 Analytical Engines",
        line_2: "",
        city: "London",
        country: "GB",
        phone_number: "02079460000",
        instructions: "Leave at reception",
      },
      billing_address: {
        first_name: "Ada",
        last_name: "Lovelace",
        line_1: "12 Analytical Engines",
        line_2: "",
        line_3: "Floor 3",
        city: "London",
        postcode: "SW1A 1AA",
        country: "GB",
      },
      items: [
        {
          id: "item-1",
          name: "Deck shoe",
          sku: "deck-shoe",
          quantity: 2,
          product_id: "prod-1",
          meta: {
            display_price: {
              with_tax: {
                unit: {
                  amount: 250,
                  currency: "USD",
                  formatted: "$2.50",
                  float_price: 2.5,
                },
                value: {
                  amount: 500,
                  currency: "JPY",
                  formatted: "¥500",
                  float_price: 500,
                },
              },
            },
          },
        },
        {
          id: "item-ship",
          name: "Shipping",
          sku: "__ep_shipping",
          quantity: 1,
        },
      ],
    });
    expectNoSecrets(body);
  });

  it.each([
    ["empty strings", { name: "", email: "" }],
    ["whitespace", { name: "  ", email: "\t" }],
  ])("omits a contact made of %s", async (_label, contact) => {
    const { auth, cookies } = await signedSelected();
    orderReplies = [{ status: 200, body: detailDocument(NORTH, { contact }) }];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(200);
    expect(body.contact).toBeUndefined();
    expect(body.shipping_address.line_2).toBe("");
    expect(body.billing_address.line_2).toBe("");
  });

  it("keeps the usable contact field and drops the blank one", async () => {
    const { auth, cookies } = await signedSelected();
    orderReplies = [
      {
        status: 200,
        body: detailDocument(NORTH, {
          contact: { name: "  ", email: "buyer@example.com" },
        }),
      },
    ];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(200);
    expect(body.contact).toEqual({ email: "buyer@example.com" });
    expect(body.shipping_address.line_2).toBe("");
  });

  it("keeps both usable contact fields", async () => {
    const { auth, cookies } = await signedSelected();
    orderReplies = [
      {
        status: 200,
        body: detailDocument(NORTH, {
          contact: { name: "Ada Lovelace", email: "buyer@example.com" },
          shipping_address: {
            first_name: "Ada",
            line_1: "12 Analytical Engines",
            line_2: "",
            line_3: "",
          },
        }),
      },
    ];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(200);
    expect(body.contact).toEqual({
      name: "Ada Lovelace",
      email: "buyer@example.com",
    });
    expect(body.shipping_address).toEqual({
      first_name: "Ada",
      line_1: "12 Analytical Engines",
      line_2: "",
      line_3: "",
    });
  });

  it("matches an uppercase account relationship", async () => {
    const { auth, cookies } = await signedSelected();
    orderReplies = [
      { status: 200, body: detailDocument(NORTH.toUpperCase()) },
    ];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(200);
    expect(body.id).toBe(ORDER);
    expect(body.items).toHaveLength(2);
  });

  it.each([
    ["foreign account", SOUTH],
    ["guest order", undefined],
    ["missing relationship", ""],
    ["malformed ownership", "not-a-uuid"],
  ])("returns the same not-found for a %s", async (_label, accountId) => {
    const { auth, cookies } = await signedSelected();
    const document = detailDocument(accountId === "" ? undefined : accountId);
    if (accountId === "") {
      delete (document.data as { relationships?: unknown }).relationships;
    }
    orderReplies = [{ status: 200, body: document }];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(404);
    expect(body).toEqual({
      error: "account_order_not_found",
      code: "account_order_not_found",
      message: "That order could not be found.",
    });
    expect(body.id).toBeUndefined();
    expect(body.items).toBeUndefined();
    expectNoSecrets(body);
  });

  it("returns the same not-found when the order id is unusable", async () => {
    const { auth, cookies } = await signedSelected();
    const document = detailDocument(NORTH);
    document.data.id = "   ";
    orderReplies = [{ status: 200, body: document }];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(404);
    expect(body).toEqual({
      error: "account_order_not_found",
      code: "account_order_not_found",
      message: "That order could not be found.",
    });
    expect(body.items).toBeUndefined();
    expectNoSecrets(body);
  });

  it("returns the same not-found for an upstream 404", async () => {
    const { auth, cookies } = await signedSelected();
    orderReplies = [
      {
        status: 404,
        body: { errors: [{ detail: "secret upstream order" }] },
      },
    ];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(404);
    expect(body.code).toBe("account_order_not_found");
    expect(body.message).toBe("That order could not be found.");
    expect(JSON.stringify(body)).not.toContain("secret upstream order");
    expectNoSecrets(body);
  });

  it("hides an upstream rejection", async () => {
    const { auth, cookies } = await signedSelected();
    const failure = {
      status: 500,
      body: { errors: [{ detail: "secret upstream" }] },
    };
    // The shopper SDK retries a rejected GET. A later default 200 would hide it.
    orderReplies = Array.from({ length: 6 }, () => failure);

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(orderCalls.length).toBeGreaterThan(1);
    expect(orderCalls.every((call) => call.status === 500)).toBe(true);
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.message).toBe("Elastic Path rejected the account-order read.");
    expect(JSON.stringify(body)).not.toContain("secret upstream");
    expectNoSecrets(body);
  });

  it("reports a transport failure as unreachable", async () => {
    const { auth, cookies } = await signedSelected();
    orderThrow = new Error("socket down secret-link");

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.message).toBe("Elastic Path was unreachable.");
    expectNoSecrets(body);
  });

  it("fails when item relationships have no included items", async () => {
    const { auth, cookies } = await signedSelected();
    const document = detailDocument(NORTH);
    document.included = { items: [] } as typeof document.included;
    orderReplies = [{ status: 200, body: document }];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.message).toBe("Elastic Path rejected the account-order read.");
    expect(body.items).toBeUndefined();
    expectNoSecrets(body);
  });

  it("fails when a related item is missing from the included items", async () => {
    const { auth, cookies } = await signedSelected();
    const document = detailDocument(NORTH);
    document.included.items = [
      { id: "someone-elses-item", name: "Dropped", sku: "x", quantity: 1 },
    ];
    orderReplies = [{ status: 200, body: document }];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(502);
    expect(body.code).toBe("account_orders_read_failed");
    expect(body.message).toBe("Elastic Path rejected the account-order read.");
    expect(body.items).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("someone-elses-item");
    expectNoSecrets(body);
  });

  it("returns an empty item list when the order has no items", async () => {
    const { auth, cookies } = await signedSelected();
    const document = detailDocument(NORTH);
    delete (document.data.relationships as { items?: unknown }).items;
    delete (document.included as { items?: unknown }).items;
    orderReplies = [{ status: 200, body: document }];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(200);
    expect(body.items).toEqual([]);
    expectNoSecrets(body);
  });

  it("omits a price that is missing its formatted text", async () => {
    const { auth, cookies } = await signedSelected();
    const document = detailDocument(NORTH);
    const item = (document.included.items as Array<Record<string, any>>)[0];
    delete item.meta.display_price.with_tax.unit.formatted;
    item.quantity = 1.5;
    orderReplies = [{ status: 200, body: document }];

    const { res, body } = await readOrder(auth, cookies, { id: ORDER });
    expect(res.status).toBe(200);
    expect(body.items[0].quantity).toBeUndefined();
    expect(body.items[0].meta.display_price.with_tax.unit).toBeUndefined();
    expect(body.items[0].meta.display_price.with_tax.value.float_price).toBe(500);
    expectNoSecrets(body);
  });
});
