/**
 * Choosing the shopper's cart at an identity transition (#536).
 *
 * These tests drive the plugin's endpoints the way a storefront does — cookies
 * in, cookies out — and assert what a shopper or a consuming developer can
 * observe: which cart the session points at afterwards, which requests the
 * package sent to Elastic Path, and that a broken merchant rule still lets the
 * shopper in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";
import { getCurrentEpSession } from "../../../ep-server-functions/session-context";
import type { EpSessionCartResolver } from "../session-cart";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const PROFILE = "profile-1";
const USERNAME = "buyer@example.com";
const PASSWORD = "Passw0rd!";

const NORTH = { id: "acct-north", name: "Acme North" };
const SOUTH = { id: "acct-south", name: "Acme South" };

interface CartRecord {
  id: string;
  name?: string;
  accountIds: string[];
  updatedAt: string;
  createdAt: string;
}

interface StoreShape {
  accounts: { id: string; name: string }[];
  memberId: string;
  carts: CartRecord[];
  /** When set, `GET /v2/carts` answers with this status instead of a list. */
  cartListStatus: number | null;
}

let store: StoreShape;
let originalFetch: typeof fetch;
let epCalls: { method: string; url: string; headers: Record<string, string> }[];

function accountTokenFor(id: string): string {
  return `token-${id}`;
}

function accountForToken(token: string | undefined): string | null {
  if (!token) return null;
  const match = store.accounts.find((a) => accountTokenFor(a.id) === token);
  return match?.id ?? null;
}

function isoIn(seconds: number): string {
  return new Date((Math.floor(Date.now() / 1000) + seconds) * 1000).toISOString();
}

function cart(
  id: string,
  opts: { accountIds?: string[]; updatedAt?: string } = {}
): CartRecord {
  return {
    id,
    name: id,
    accountIds: opts.accountIds ?? [],
    updatedAt: opts.updatedAt ?? isoIn(-3600),
    createdAt: isoIn(-7200),
  };
}

function installFetch() {
  epCalls = [];
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
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

    epCalls.push({ method, url: u, headers });

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
      return json(
        {
          meta: {
            account_member_id: store.memberId,
            results: { total: store.accounts.length },
          },
          data: store.accounts.map((account) => ({
            account_id: account.id,
            account_name: account.name,
            token: accountTokenFor(account.id),
            type: "account_management_authentication_token",
            expires: isoIn(86400),
          })),
        },
        201
      );
    }

    if (u.startsWith(`${EP_HOST}/v2/carts?`) || u === `${EP_HOST}/v2/carts`) {
      if (store.cartListStatus) {
        return json({ errors: [{ detail: "nope" }] }, store.cartListStatus);
      }
      const accountId = accountForToken(
        headers["EP-Account-Management-Authentication-Token"]
      );
      const visible = store.carts.filter(
        (c) => accountId != null && c.accountIds.includes(accountId)
      );
      return json({
        data: visible.map((c) => ({
          id: c.id,
          type: "cart",
          name: c.name,
          meta: {
            timestamps: { created_at: c.createdAt, updated_at: c.updatedAt },
          },
        })),
        meta: { results: { total: visible.length } },
      });
    }

    const associate = u.match(
      new RegExp(`^${EP_HOST}/v2/carts/([^/]+)/relationships/accounts$`)
    );
    if (associate && method === "POST") {
      const target = store.carts.find((c) => c.id === associate[1]);
      const accountId = accountForToken(
        headers["EP-Account-Management-Authentication-Token"]
      );
      if (!target || !accountId) return json({ errors: [] }, 404);
      if (!target.accountIds.includes(accountId)) {
        target.accountIds.push(accountId);
      }
      return json({ data: [{ type: "account", id: accountId }] });
    }

    // Anything else is the resolver acting on its own behalf.
    return json({ data: { id: "acted" } });
  }) as any;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  store = { accounts: [NORTH], memberId: "member-1", carts: [], cartListStatus: null };
  installFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function buildAuth(options: { sessionCartResolver?: EpSessionCartResolver } = {}) {
  return betterAuth({
    secret: SECRET,
    baseURL: "http://localhost:3000",
    plugins: [
      epPlugin({
        clientId: EP_CLIENT_ID,
        host: EP_HOST,
        passwordProfileId: PROFILE,
        sessionCartResolver: options.sessionCartResolver,
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

async function setCart(auth: any, cookies: string, cartId: string) {
  const res = await auth.api.epCart({
    body: { cartId },
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return mergeCookies(cookies, res);
}

async function signIn(auth: any, cookies: string) {
  const res = await auth.api.epAccountLogin({
    body: { username: USERNAME, password: PASSWORD },
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return { res, cookies: mergeCookies(cookies, res) };
}

async function select(auth: any, cookies: string, accountId: string | null) {
  const res = await auth.api.epAccountSelect({
    body: { accountId },
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return { res, cookies: mergeCookies(cookies, res) };
}

describe("the cart a shopper keeps when they sign in", () => {
  it("keeps the guest cart by default", async () => {
    store.carts = [
      cart("cart-guest"),
      cart("cart-saved", { accountIds: [NORTH.id] }),
    ];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");

    const { res } = await signIn(auth, cookies);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.epCartId).toBe("cart-guest");
  });

  it("never combines quantities: it copies no lines between carts", async () => {
    store.carts = [
      cart("cart-guest"),
      cart("cart-saved", { accountIds: [NORTH.id] }),
    ];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");
    await signIn(auth, cookies);

    expect(
      epCalls.filter((c) => /\/v2\/carts\/[^/]+\/items/.test(c.url))
    ).toEqual([]);
  });

  it("leaves the losing cart in place", async () => {
    store.carts = [
      cart("cart-guest"),
      cart("cart-saved", { accountIds: [NORTH.id] }),
    ];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");
    await signIn(auth, cookies);

    expect(epCalls.filter((c) => c.method === "DELETE")).toEqual([]);
    expect(store.carts.map((c) => c.id)).toContain("cart-saved");
  });

  it("adopts the most recently updated account cart when there is no guest cart", async () => {
    store.carts = [
      cart("cart-stale", { accountIds: [NORTH.id], updatedAt: isoIn(-86400) }),
      cart("cart-fresh", { accountIds: [NORTH.id], updatedAt: isoIn(-60) }),
      cart("cart-middle", { accountIds: [NORTH.id], updatedAt: isoIn(-3600) }),
    ];
    const auth = buildAuth();
    const cookies = await anonymous(auth);

    const { res } = await signIn(auth, cookies);
    const body = await res.json();

    expect(body.session.epCartId).toBe("cart-fresh");
  });

  it("points at no cart when the shopper has none anywhere", async () => {
    const auth = buildAuth();
    const cookies = await anonymous(auth);

    const { res } = await signIn(auth, cookies);
    const body = await res.json();

    expect(body.session.epCartId).toBeUndefined();
  });

  it("associates the guest cart with the account it just joined", async () => {
    store.carts = [cart("cart-guest")];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");
    await signIn(auth, cookies);

    expect(
      store.carts.find((c) => c.id === "cart-guest")?.accountIds
    ).toEqual([NORTH.id]);
  });

  it("does not re-associate a cart the account already owns", async () => {
    store.carts = [cart("cart-saved", { accountIds: [NORTH.id] })];
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    await signIn(auth, cookies);

    expect(
      epCalls.filter((c) => c.url.includes("/relationships/accounts"))
    ).toEqual([]);
  });
});

describe("a storefront's own rule", () => {
  it("chooses the cart that wins", async () => {
    store.carts = [
      cart("cart-guest"),
      cart("cart-saved", { accountIds: [NORTH.id] }),
    ];
    const seen: any[] = [];
    const auth = buildAuth({
      sessionCartResolver: (input) => {
        seen.push(input);
        return { keep: "cart-saved" };
      },
    });
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");

    const { res } = await signIn(auth, cookies);
    const body = await res.json();

    expect(body.session.epCartId).toBe("cart-saved");
    expect(seen).toHaveLength(1);
    expect(seen[0].trigger).toBe("login");
    expect(seen[0].guestCartId).toBe("cart-guest");
    expect(seen[0].accountId).toBe(NORTH.id);
    expect(seen[0].accountCarts.map((c: any) => c.id)).toEqual(["cart-saved"]);
  });

  it("reads and writes carts under the shopper's new identity", async () => {
    store.carts = [
      cart("cart-guest"),
      cart("cart-saved", { accountIds: [NORTH.id] }),
    ];
    let ctx: any = null;
    const auth = buildAuth({
      sessionCartResolver: async (input) => {
        ctx = getCurrentEpSession();
        await fetch(`${ctx.host}/v2/carts/${input.guestCartId}/items`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            "EP-Account-Management-Authentication-Token": ctx.accountToken,
          },
          body: "{}",
        });
        return { keep: input.guestCartId! };
      },
    });
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");
    await signIn(auth, cookies);

    expect(ctx).toEqual({
      host: EP_HOST,
      clientId: EP_CLIENT_ID,
      accessToken: "anon-token",
      accountId: NORTH.id,
      accountToken: accountTokenFor(NORTH.id),
    });
    const write = epCalls.find((c) => c.url.endsWith("/cart-guest/items"));
    expect(write?.headers["EP-Account-Management-Authentication-Token"]).toBe(
      accountTokenFor(NORTH.id)
    );
  });

  it("does not block the shopper when it throws, and says so", async () => {
    store.carts = [
      cart("cart-guest"),
      cart("cart-saved", { accountIds: [NORTH.id] }),
    ];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const auth = buildAuth({
      sessionCartResolver: () => {
        throw new Error("merchant bug");
      },
    });
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");

    const { res } = await signIn(auth, cookies);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.epCartId).toBe("cart-guest");
    expect(logged.mock.calls.join(" ")).toContain("merchant bug");
  });

  it("falls back to the default when it names a cart it was not offered", async () => {
    store.carts = [
      cart("cart-guest"),
      cart("cart-saved", { accountIds: [NORTH.id] }),
      cart("cart-elsewhere", { accountIds: [SOUTH.id] }),
    ];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const auth = buildAuth({
      sessionCartResolver: () => ({ keep: "cart-elsewhere" }),
    });
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");

    const { res } = await signIn(auth, cookies);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.epCartId).toBe("cart-guest");
    expect(logged.mock.calls.join(" ")).toContain("cart-elsewhere");
  });

  it("does not block the shopper when Elastic Path will not list the account's carts", async () => {
    store.cartListStatus = 502;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");

    const { res } = await signIn(auth, cookies);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.epCartId).toBe("cart-guest");
  });
});

describe("the rule a storefront developer would actually write", () => {
  // Reads as obviously correct: keep what the shopper built when they are
  // arriving, use the organisation's own cart when they move between
  // organisations. It must not cost a multi-organisation member their cart.
  const merchantRule: EpSessionCartResolver = ({
    trigger,
    guestCartId,
    accountCarts,
  }) =>
    trigger === "login" && guestCartId
      ? { keep: guestCartId }
      : { keep: accountCarts[0]?.id ?? guestCartId! };

  it("keeps the cart of a member who belongs to one organisation", async () => {
    store.accounts = [NORTH];
    store.carts = [
      cart("cart-guest"),
      cart("cart-saved", { accountIds: [NORTH.id] }),
    ];
    const auth = buildAuth({ sessionCartResolver: merchantRule });
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");

    const { res } = await signIn(auth, cookies);
    const body = await res.json();

    expect(body.session.epCartId).toBe("cart-guest");
  });

  it("keeps the cart of a member who belongs to several", async () => {
    store.accounts = [NORTH, SOUTH];
    store.carts = [
      cart("cart-guest"),
      cart("cart-saved", { accountIds: [NORTH.id] }),
    ];
    const auth = buildAuth({ sessionCartResolver: merchantRule });
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");
    const signedIn = await signIn(auth, cookies);

    const { res } = await select(auth, signedIn.cookies, NORTH.id);
    const body = await res.json();

    expect(body.session.epCartId).toBe("cart-guest");
  });
});

describe("switching organisation", () => {
  it("never carries the previous organisation's cart across", async () => {
    store.accounts = [NORTH, SOUTH];
    store.carts = [
      cart("cart-north", { accountIds: [NORTH.id] }),
      cart("cart-south", { accountIds: [SOUTH.id] }),
    ];
    const offered: any[] = [];
    const auth = buildAuth({
      sessionCartResolver: (input) => {
        offered.push(input);
        return { keep: input.accountCarts[0].id };
      },
    });
    let cookies = await anonymous(auth);
    const signedIn = await signIn(auth, cookies);
    cookies = signedIn.cookies;
    const north = await select(auth, cookies, NORTH.id);
    cookies = north.cookies;

    const south = await select(auth, cookies, SOUTH.id);
    const body = await south.res.json();

    expect(body.session.epCartId).toBe("cart-south");
    const last = offered[offered.length - 1];
    expect(last.trigger).toBe("accountSwitch");
    expect(last.guestCartId).toBeNull();
    expect(last.accountCarts.map((c: any) => c.id)).toEqual(["cart-south"]);
  });

  it("offers the guest cart when the shopper is choosing their first organisation", async () => {
    store.accounts = [NORTH, SOUTH];
    store.carts = [cart("cart-guest")];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");
    const signedIn = await signIn(auth, cookies);
    cookies = signedIn.cookies;

    const { res } = await select(auth, cookies, NORTH.id);
    const body = await res.json();

    expect(body.session.epCartId).toBe("cart-guest");
  });

  it("calls that first choice a login, and only a later change a switch", async () => {
    store.accounts = [NORTH, SOUTH];
    store.carts = [
      cart("cart-north", { accountIds: [NORTH.id] }),
      cart("cart-south", { accountIds: [SOUTH.id] }),
    ];
    const triggers: string[] = [];
    const auth = buildAuth({
      sessionCartResolver: (input) => {
        triggers.push(input.trigger);
        return { keep: input.accountCarts[0].id };
      },
    });
    let cookies = await anonymous(auth);
    const signedIn = await signIn(auth, cookies);
    const first = await select(auth, signedIn.cookies, NORTH.id);
    await select(auth, first.cookies, SOUTH.id);

    expect(triggers).toEqual(["login", "accountSwitch"]);
  });
});

describe("a checkout in flight", () => {
  it("is torn down by a login, because it was priced for someone else", async () => {
    store.carts = [cart("cart-guest")];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");

    const res = await (auth.api as any).epAccountLogin({
      body: { username: USERNAME, password: PASSWORD },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });

    const cleared = setCookieHeaders(res).filter((c) =>
      c.startsWith("ep_checkout_session=")
    );
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatch(/Max-Age=0/i);
  });
});

describe("a second shopper signing in on the same browser", () => {
  // The cart pointer belongs to whoever was acting for an account. Leaving it
  // behind is the same defect the logout fix closes, reached another way.
  it("does not inherit the previous member's cart when they belong to several accounts", async () => {
    store.accounts = [NORTH];
    store.carts = [cart("cart-first-member", { accountIds: [NORTH.id] })];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-first-member");
    const first = await signIn(auth, cookies);
    expect((await first.res.json()).session.epCartId).toBe("cart-first-member");

    // A second member signs in without the first signing out, and belongs to
    // several accounts, so nothing is selected.
    store.accounts = [NORTH, SOUTH];
    const second = await signIn(auth, first.cookies);
    const body = await second.res.json();

    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epCartId).toBeUndefined();
  });

  it("does not then offer the previous account's cart at the next selection", async () => {
    store.accounts = [NORTH];
    store.carts = [
      cart("cart-north-owned", { accountIds: [NORTH.id] }),
      cart("cart-south-owned", { accountIds: [SOUTH.id] }),
    ];
    const offered: (string | null)[] = [];
    const auth = buildAuth({
      sessionCartResolver: (input) => {
        offered.push(input.guestCartId);
        return { keep: input.accountCarts[0]?.id ?? input.guestCartId! };
      },
    });
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-north-owned");
    const first = await signIn(auth, cookies);

    store.accounts = [NORTH, SOUTH];
    const second = await signIn(auth, first.cookies);
    const chosen = await select(auth, second.cookies, SOUTH.id);
    const body = await chosen.res.json();

    expect(offered[offered.length - 1]).toBeNull();
    expect(body.session.epCartId).toBe("cart-south-owned");
    expect(
      store.carts.find((c) => c.id === "cart-north-owned")?.accountIds
    ).toEqual([NORTH.id]);
  });

  it("does not inherit the cart of a member who belonged to no account", async () => {
    // The narrow case: nothing in the envelope says "an account was held",
    // because there never was one — only the member id distinguishes them.
    store.accounts = [];
    store.carts = [cart("cart-unscoped-member")];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-unscoped-member");
    const first = await signIn(auth, cookies);
    expect((await first.res.json()).session.epCartId).toBe(
      "cart-unscoped-member"
    );

    store.accounts = [NORTH];
    store.memberId = "member-2";
    const second = await signIn(auth, first.cookies);
    const body = await second.res.json();

    expect(body.session.epMemberId).toBe("member-2");
    expect(body.session.epCartId).not.toBe("cart-unscoped-member");
    expect(
      store.carts.find((c) => c.id === "cart-unscoped-member")?.accountIds
    ).toEqual([]);
  });

  it("keeps the cart when the same member signs in again", async () => {
    store.accounts = [];
    store.carts = [cart("cart-same-member")];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-same-member");
    const first = await signIn(auth, cookies);
    const second = await signIn(auth, first.cookies);
    const body = await second.res.json();

    expect(body.session.epCartId).toBe("cart-same-member");
  });

  it("calls re-authenticating a login, not a switch", async () => {
    store.accounts = [NORTH];
    store.carts = [cart("cart-saved", { accountIds: [NORTH.id] })];
    const triggers: string[] = [];
    const auth = buildAuth({
      sessionCartResolver: (input) => {
        triggers.push(input.trigger);
        return { keep: input.accountCarts[0]?.id ?? input.guestCartId! };
      },
    });
    const cookies = await anonymous(auth);
    const first = await signIn(auth, cookies);
    await signIn(auth, first.cookies);

    expect(triggers).toEqual(["login", "login"]);
  });
});

describe("paths this change touched but the cases above do not reach", () => {
  it("resolves the cart for the older client-supplied-token login too", async () => {
    store.accounts = [NORTH];
    store.carts = [
      cart("cart-guest-legacy"),
      cart("cart-saved-legacy", { accountIds: [NORTH.id] }),
    ];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest-legacy");

    const res = await (auth.api as any).epAccountLogin({
      body: {
        epMemberId: "member-1",
        epAccountId: NORTH.id,
        epAccountToken: accountTokenFor(NORTH.id),
        epAccountExpires: isoIn(86400),
      },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.epCartId).toBe("cart-guest-legacy");
    expect(
      setCookieHeaders(res).filter((c) => c.startsWith("ep_checkout_session="))
    ).toHaveLength(1);
  });

  it("leaves the cart alone when the account credential merely rolls", async () => {
    store.accounts = [NORTH];
    store.carts = [cart("cart-rolling")];
    let asked = 0;
    const auth = buildAuth({
      sessionCartResolver: (input) => {
        asked += 1;
        return { keep: input.guestCartId ?? input.accountCarts[0].id };
      },
    });
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-rolling");
    const signedIn = await signIn(auth, cookies);
    const askedAfterLogin = asked;

    const res = await (auth.api as any).epAccountRoll({
      body: {},
      headers: new Headers({ cookie: signedIn.cookies }),
      asResponse: true,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.epCartId).toBe("cart-rolling");
    expect(asked).toBe(askedAfterLogin);
  });

  it("offers the cart again when a shopper deselects and picks an account back up", async () => {
    store.accounts = [NORTH];
    store.carts = [cart("cart-through-deselect")];
    const triggers: string[] = [];
    const auth = buildAuth({
      sessionCartResolver: (input) => {
        triggers.push(input.trigger);
        return { keep: input.guestCartId ?? input.accountCarts[0].id };
      },
    });
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-through-deselect");
    const signedIn = await signIn(auth, cookies);
    const off = await select(auth, signedIn.cookies, null);
    expect((await off.res.json()).session.epCartId).toBeUndefined();

    const back = await select(auth, off.cookies, NORTH.id);
    const body = await back.res.json();

    expect(body.session.epCartId).toBe("cart-through-deselect");
    expect(triggers[triggers.length - 1]).toBe("login");
  });
});

describe("signing out", () => {
  it("clears the cart pointer so the next shopper does not inherit it", async () => {
    store.carts = [cart("cart-guest")];
    const auth = buildAuth();
    let cookies = await anonymous(auth);
    cookies = await setCart(auth, cookies, "cart-guest");
    const signedIn = await signIn(auth, cookies);

    const res = await (auth.api as any).epAccountLogout({
      body: {},
      headers: new Headers({ cookie: signedIn.cookies }),
      asResponse: true,
    });
    const body = await res.json();

    expect(body.session.epCartId).toBeUndefined();
  });
});
