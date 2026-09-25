/**
 * Account-member sign-in, roster and account switch (#535).
 *
 * The package mints the account token itself, so no Elastic Path credential
 * passes through the browser at any point. These tests drive the plugin's
 * endpoints the way a storefront does — cookies in, cookies out — and assert
 * what a caller can observe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";
import { DEFAULT_HOST_ALLOWLIST } from "../../host-allowlist";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpAuthRoutes } from "../auth-routes";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const PROFILE = "profile-1";
const USERNAME = "buyer@example.com";
const PASSWORD = "Passw0rd!";

const ACCOUNTS = [
  { id: "acct-north", name: "Acme North" },
  { id: "acct-south", name: "Acme South" },
];

let originalFetch: typeof fetch;
/** Account tokens EP hands out, newest first, so a roll is observable. */
let tokenGeneration = 0;
let tokenCalls: { body: any; headers: Record<string, string>; url: string }[];

function accountTokenFor(id: string): string {
  return `token-${id}-gen${tokenGeneration}`;
}

function expiresIso(seconds: number): string {
  return new Date((Math.floor(Date.now() / 1000) + seconds) * 1000).toISOString();
}

interface StoreShape {
  accounts: { id: string; name: string }[];
  ttlSeconds: number;
  profiles: { id: string; name: string }[];
}

let store: StoreShape;

function installFetch() {
  tokenCalls = [];
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
      return json({ data: store.profiles });
    }

    if (u.startsWith(`${EP_HOST}/v2/account-members/tokens`)) {
      const body = JSON.parse(init.body);
      tokenCalls.push({ url: u, body, headers: init.headers });
      const data = body.data;
      if (data.authentication_mechanism === "password") {
        if (data.password_profile_id !== PROFILE) {
          return json(
            { errors: [{ detail: "authentication failed" }] },
            400
          );
        }
        if (data.username !== USERNAME || data.password !== PASSWORD) {
          return json(
            { errors: [{ detail: "authentication failed" }] },
            400
          );
        }
      } else if (!init.headers["EP-Account-Management-Authentication-Token"]) {
        return json({ errors: [{ detail: "missing account token" }] }, 400);
      }

      const parsed = new URL(u);
      const limit = Number(parsed.searchParams.get("page[limit]") ?? 100);
      const offset = Number(parsed.searchParams.get("page[offset]") ?? 0);
      const page = store.accounts.slice(offset, offset + limit);
      return json(
        {
          meta: {
            account_member_id: "member-1",
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

    throw new Error(`Unexpected URL: ${u}`);
  }) as any;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  tokenGeneration = 0;
  store = {
    accounts: [...ACCOUNTS],
    ttlSeconds: 86400,
    profiles: [{ id: PROFILE, name: "password" }],
  };
  installFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function buildAuth(options: { passwordProfileId?: string } = {}) {
  return betterAuth({
    secret: SECRET,
    baseURL: "http://localhost:3000",
    plugins: [
      epPlugin({
        hostAllowlist: DEFAULT_HOST_ALLOWLIST,
        clientId: EP_CLIENT_ID,
        host: EP_HOST,
        passwordProfileId: options.passwordProfileId,
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

function setCookieHeaders(res: Response): string[] {
  const out: string[] = [];
  res.headers.forEach((v: string, k: string) => {
    if (k.toLowerCase() === "set-cookie") out.push(v);
  });
  return out;
}

async function anonymous(auth: any) {
  const res = await auth.api.epAnonymous({
    body: {},
    headers: new Headers(),
    asResponse: true,
  });
  return mergeCookies("", res);
}

async function signIn(auth: any, cookies: string, body: any = {}) {
  const res = await auth.api.epAccountLogin({
    body: { username: USERNAME, password: PASSWORD, ...body },
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return { res, cookies: mergeCookies(cookies, res) };
}

describe("signing in as an account member", () => {
  it("mints the token server-side and returns the roster in the same call", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const { res } = await signIn(auth, cookies);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toEqual([
      { id: "acct-north", name: "Acme North" },
      { id: "acct-south", name: "Acme South" },
    ]);
    expect(body.total).toBe(2);
    expect(body.session.epMemberId).toBe("member-1");
  });

  it("puts no Elastic Path credential in what the browser receives", async () => {
    const epAuth = createEpAuth({
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      secret: SECRET,
      baseURL: "http://localhost:3000",
      passwordProfileId: PROFILE,
    });
    const routes = createEpAuthRoutes(epAuth);
    const cookies = await anonymous(epAuth.handler);

    const res = await routes.POST(
      new Request("http://localhost:3000/api/ep/ep/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookies },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
      })
    );

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(accountTokenFor("acct-north"));
    expect(raw).not.toContain(accountTokenFor("acct-south"));
    expect(raw).not.toContain("anon-token");
    expect(JSON.parse(raw).accounts).toEqual([
      { id: "acct-north", name: "Acme North" },
      { id: "acct-south", name: "Acme South" },
    ]);
  });

  it("leaves a member of several accounts with none selected", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const { res } = await signIn(auth, cookies);

    const body = await res.json();
    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epAnchorToken.token).toBe(
      accountTokenFor("acct-north")
    );
  });

  it("places a member of exactly one account into it", async () => {
    store.accounts = [ACCOUNTS[0]];
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const { res } = await signIn(auth, cookies);

    const body = await res.json();
    expect(body.session.epAccount.id).toBe("acct-north");
    expect(body.session.epAnchorToken).toBeUndefined();
    expect(body.total).toBe(1);
  });

  it("signs in a member of no account as authenticated and unscoped", async () => {
    store.accounts = [];
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const { res } = await signIn(auth, cookies);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.epMemberId).toBe("member-1");
    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epAnchorToken).toBeUndefined();
    expect(body.total).toBe(0);
  });

  it("reports a wrong password as a failed sign-in", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const res = await (auth.api as any).epAccountLogin({
      body: { username: USERNAME, password: "wrong" },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("invalid_credentials");
  });

  it("discovers the store's only password profile when none is configured", async () => {
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    const { res } = await signIn(auth, cookies);

    expect(res.status).toBe(200);
    expect(tokenCalls[0].body.data.password_profile_id).toBe(PROFILE);
  });

  it("asks to be told which profile when the realm carries several", async () => {
    store.profiles = [
      { id: PROFILE, name: "password" },
      { id: "profile-2", name: "secondary" },
    ];
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    const { res } = await signIn(auth, cookies);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("password_profile_ambiguous");
    expect(body.message).toContain("passwordProfileId");
  });
});

describe("reading the roster", () => {
  it("returns ids and names, never tokens", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));

    const res = await (auth.api as any).epAccountRoster({
      body: {},
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({
      accounts: [
        { id: "acct-north", name: "Acme North" },
        { id: "acct-south", name: "Acme South" },
      ],
      total: 2,
    });
    expect(raw).not.toContain(accountTokenFor("acct-north"));
  });

  it("reaches an account past the first page", async () => {
    store.accounts = Array.from({ length: 150 }, (_, i) => ({
      id: `acct-${i}`,
      name: `Account ${i}`,
    }));
    const auth = buildAuth({ passwordProfileId: PROFILE });
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));

    const res = await (auth.api as any).epAccountRoster({
      body: { offset: 100 },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });

    const body = await res.json();
    expect(body.total).toBe(150);
    expect(body.accounts).toHaveLength(50);
    expect(body.accounts[0].id).toBe("acct-100");
  });

  it("turns away a session with no account member", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);

    const res = await (auth.api as any).epAccountRoster({
      body: {},
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_account_member");
  });

  it("answers an empty roster for a member who belongs to no account", async () => {
    store.accounts = [];
    const auth = buildAuth({ passwordProfileId: PROFILE });
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));

    const res = await (auth.api as any).epAccountRoster({
      body: {},
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [], total: 0 });
  });
});

describe("selecting and switching account", () => {
  async function signedIn(auth: any) {
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    return cookies;
  }

  async function select(auth: any, cookies: string, accountId: string | null) {
    const res = await (auth.api as any).epAccountSelect({
      body: { accountId },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    return { res, cookies: mergeCookies(cookies, res) };
  }

  it("selects without re-entering a password", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await signedIn(auth);
    const { res } = await select(auth, cookies, "acct-south");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.epAccount.id).toBe("acct-south");
    expect(body.session.epAccount.name).toBe("Acme South");
    expect(body.session.epAnchorToken).toBeUndefined();
    // No password reached Elastic Path on the switch.
    const switchCall = tokenCalls[tokenCalls.length - 1];
    expect(switchCall.body.data).not.toHaveProperty("password");
  });

  it("re-mints, so the switch carries a token minted for the new account", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await signedIn(auth);
    tokenGeneration = 1;
    const { res } = await select(auth, cookies, "acct-south");

    expect((await res.json()).session.epAccount.token).toBe(
      "token-acct-south-gen1"
    );
  });

  it("clears the cart pointer and the checkout session on a switch", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    let cookies = await signedIn(auth);
    ({ cookies } = await select(auth, cookies, "acct-north"));

    const cartRes = await (auth.api as any).epCart({
      body: { cartId: "cart-1" },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    cookies = mergeCookies(cookies, cartRes);
    expect((await cartRes.json()).session.epCartId).toBe("cart-1");

    const { res } = await select(auth, cookies, "acct-south");
    expect((await res.json()).session.epCartId).toBeUndefined();
    expect(
      setCookieHeaders(res).some(
        (c) => c.startsWith("ep_checkout_session=") && /Max-Age=0/.test(c)
      )
    ).toBe(true);
  });

  it("leaves the previous selection untouched when the switch fails", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    let cookies = await signedIn(auth);
    ({ cookies } = await select(auth, cookies, "acct-north"));

    const cartRes = await (auth.api as any).epCart({
      body: { cartId: "cart-1" },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    cookies = mergeCookies(cookies, cartRes);

    const liveFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      if (String(url).includes("/v2/account-members/tokens")) {
        return new Response(
          JSON.stringify({ errors: [{ detail: "upstream is down" }] }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
      return (liveFetch as any)(url, init);
    }) as any;

    const { res } = await select(auth, cookies, "acct-south");
    expect(res.status).toBe(502);
    expect(setCookieHeaders(res)).toEqual([]);

    globalThis.fetch = liveFetch;
    const after = await (auth.api as any).epAccountRoster({
      body: {},
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    expect(after.status).toBe(200);

    const session = await (auth.api as any).epAccountSelect({
      body: { accountId: "acct-north" },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    const body = await session.json();
    expect(body.session.epAccount.id).toBe("acct-north");
    expect(body.session.epCartId).toBe("cart-1");
  });

  it("changes nothing when the already-selected account is selected again", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    let cookies = await signedIn(auth);
    ({ cookies } = await select(auth, cookies, "acct-north"));
    const cartRes = await (auth.api as any).epCart({
      body: { cartId: "cart-1" },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    cookies = mergeCookies(cookies, cartRes);

    const callsBefore = tokenCalls.length;
    const { res } = await select(auth, cookies, "acct-north");
    const body = await res.json();

    expect(tokenCalls.length).toBe(callsBefore);
    expect(body.session.epCartId).toBe("cart-1");
    expect(setCookieHeaders(res)).toEqual([]);
  });

  it("rejects an account the member does not belong to", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await signedIn(auth);
    const { res } = await select(auth, cookies, "acct-elsewhere");

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("account_not_found");
  });

  it("deselects by demoting the credential to an anchor", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    let cookies = await signedIn(auth);
    ({ cookies } = await select(auth, cookies, "acct-north"));

    const { res } = await select(auth, cookies, null);
    const body = await res.json();
    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epAnchorToken.token).toBe(
      accountTokenFor("acct-north")
    );
    expect(body.session.epMemberId).toBe("member-1");
  });

  it("turns away a session with no account member", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const { res } = await select(auth, cookies, "acct-north");

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_account_member");
  });
});

describe("a lapsed account credential", () => {
    async function signedInAndLapsed(auth: any) {
    store.accounts = [ACCOUNTS[0]];
    store.ttlSeconds = 1;
    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));
    // Walk past the credential's expiry without making a call, which is the
    // idle shopper rolling cannot reach.
    vi.setSystemTime(Date.now() + 5_000);
    return cookies;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("states the lapse rather than sending a dead token to Elastic Path", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await signedInAndLapsed(auth);

    const res = await (auth.api as any).epAccountSelect({
      body: { accountId: "acct-south" },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("account_lapsed");
  });

  it("does not report a lapsed roster as an empty one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await signedInAndLapsed(auth);

    const res = await (auth.api as any).epAccountRoster({
      body: {},
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("account_lapsed");
  });
});

describe("rolling the account credential", () => {
  it("refreshes a token near expiry with nothing visible to the shopper", async () => {
    store.accounts = [ACCOUNTS[0]];
    store.ttlSeconds = 1800;
    const epAuth = createEpAuth({
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      secret: SECRET,
      baseURL: "http://localhost:3000",
      passwordProfileId: PROFILE,
    });
    const auth = epAuth.handler;

    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));

    tokenGeneration = 1;
    store.ttlSeconds = 86400;
    const session = await epAuth.api.getSession({
      cookies: Object.fromEntries(
        cookies.split("; ").map((c) => {
          const eq = c.indexOf("=");
          return [c.slice(0, eq), decodeURIComponent(c.slice(eq + 1))];
        })
      ),
    });

    expect(session.session?.account?.token).toBe("token-acct-north-gen1");
    expect(session.session?.account?.id).toBe("acct-north");
    expect(session.isAuthenticated).toBe(true);
  });

  it("leaves a token with plenty of life alone", async () => {
    store.accounts = [ACCOUNTS[0]];
    const epAuth = createEpAuth({
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      secret: SECRET,
      baseURL: "http://localhost:3000",
      passwordProfileId: PROFILE,
    });
    const auth = epAuth.handler;

    let cookies = await anonymous(auth);
    ({ cookies } = await signIn(auth, cookies));

    const callsBefore = tokenCalls.length;
    await epAuth.api.getSession({
      cookies: Object.fromEntries(
        cookies.split("; ").map((c) => {
          const eq = c.indexOf("=");
          return [c.slice(0, eq), decodeURIComponent(c.slice(eq + 1))];
        })
      ),
    });

    expect(tokenCalls.length).toBe(callsBefore);
  });
});
