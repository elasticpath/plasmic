/**
 * Account-member self-signup (#678).
 *
 * Registration mints through the same account-token call as login, then shares
 * login's session, checkout and cart path. These tests drive that endpoint the
 * way a storefront does, and the safe response through the redacting handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";
import { DEFAULT_HOST_ALLOWLIST } from "../../host-allowlist";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpAuthRoutes } from "../auth-routes";
import {
  createEpIdentityClient,
  epIdentityErrorCode,
} from "../../../identity/client";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const PROFILE = "profile-1";
const USERNAME = "buyer";
const PASSWORD = "Passw0rd!";
const NAME = "Buyer";
const EMAIL = "buyer@example.com";

const ACCOUNTS = [
  { id: "acct-north", name: "Acme North" },
  { id: "acct-south", name: "Acme South" },
];

const REGISTER_BODY = {
  username: USERNAME,
  password: PASSWORD,
  name: NAME,
  email: EMAIL,
};

let originalFetch: typeof fetch;
let tokenCalls: { body: any; headers: Record<string, string>; url: string }[];
let settingsCalls: number;
/** When set, a self-signup token call answers with this status and detail. */
let signupFailure: { status: number; detail: string } | null;

interface StoreShape {
  accounts: { id: string; name: string }[];
  profiles: { id: string; name: string }[];
  /** When false, the settings read itself fails. */
  settingsOk: boolean;
}

let store: StoreShape;

function accountTokenFor(id: string): string {
  return `token-${id}`;
}

function expiresIso(): string {
  return new Date(Date.now() + 86400_000).toISOString();
}

function installFetch() {
  tokenCalls = [];
  settingsCalls = 0;
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
      settingsCalls += 1;
      if (!store.settingsOk) {
        return json({ errors: [{ detail: "settings unavailable" }] }, 500);
      }
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
      if (
        body.data.authentication_mechanism === "self_signup" &&
        signupFailure
      ) {
        return json(
          { errors: [{ detail: signupFailure.detail }] },
          signupFailure.status
        );
      }
      return json(
        {
          meta: {
            account_member_id: "member-1",
            results: { total: store.accounts.length },
          },
          data: store.accounts.map((account) => ({
            account_id: account.id,
            account_name: account.name,
            token: accountTokenFor(account.id),
            type: "account_management_authentication_token",
            expires: expiresIso(),
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
  signupFailure = null;
  store = {
    accounts: [...ACCOUNTS],
    profiles: [{ id: PROFILE, name: "password" }],
    settingsOk: true,
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

async function register(auth: any, cookies: string, body: unknown = REGISTER_BODY) {
  const res = await (auth.api as any).epAccountRegister({
    body,
    headers: new Headers({ cookie: cookies }),
    asResponse: true,
  });
  return { res, cookies: mergeCookies(cookies, res) };
}

function checkoutCleared(res: Response): boolean {
  return setCookieHeaders(res).some((c) => c.startsWith("ep_checkout_session="));
}

describe("registering an account member", () => {
  it("sends the configured password profile and does not discover one", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const { res } = await register(auth, cookies);

    expect(res.status).toBe(200);
    expect(settingsCalls).toBe(0);
    expect(tokenCalls[0].body.data).toEqual({
      type: "account_management_authentication_token",
      authentication_mechanism: "self_signup",
      password_profile_id: PROFILE,
      username: USERNAME,
      password: PASSWORD,
      name: NAME,
      email: EMAIL,
    });
  });

  it("discovers the store's only password profile when none is configured", async () => {
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    const { res } = await register(auth, cookies);

    expect(res.status).toBe(200);
    expect(settingsCalls).toBe(1);
    expect(tokenCalls[0].body.data.password_profile_id).toBe(PROFILE);
  });

  it("keeps password_profile_unresolved when the profile cannot be read", async () => {
    store.profiles = [];
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    const { res } = await register(auth, cookies);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("password_profile_unresolved");
    expect(checkoutCleared(res)).toBe(false);
  });

  it("keeps password_profile_ambiguous when the realm carries several", async () => {
    store.profiles = [
      { id: PROFILE, name: "password" },
      { id: "profile-2", name: "secondary" },
    ];
    const auth = buildAuth();
    const cookies = await anonymous(auth);
    const { res } = await register(auth, cookies);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("password_profile_ambiguous");
    expect(body.message).toContain("passwordProfileId");
    expect(checkoutCleared(res)).toBe(false);
  });

  it("signs up a member of no account as authenticated and unscoped", async () => {
    store.accounts = [];
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const { res } = await register(auth, cookies);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.epMemberId).toBe("member-1");
    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epAnchorToken).toBeUndefined();
    expect(body.accounts).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.name).toBe(NAME);
  });

  it("places a member of exactly one account into it", async () => {
    store.accounts = [ACCOUNTS[0]];
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const { res } = await register(auth, cookies);

    const body = await res.json();
    expect(body.session.epAccount.id).toBe("acct-north");
    expect(body.session.epAccount.name).toBe("Acme North");
    expect(body.session.epAnchorToken).toBeUndefined();
    expect(body.accounts).toEqual([{ id: "acct-north", name: "Acme North" }]);
    expect(body.total).toBe(1);
  });

  it("leaves a member of several accounts with none selected", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    const { res } = await register(auth, cookies);

    const body = await res.json();
    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epAnchorToken.token).toBe(accountTokenFor("acct-north"));
    expect(body.accounts).toEqual([
      { id: "acct-north", name: "Acme North" },
      { id: "acct-south", name: "Acme South" },
    ]);
    expect(body.total).toBe(2);
    expect(body.user).toMatchObject({ email: EMAIL, name: NAME });
  });
});

describe("a register body that is not four strings", () => {
  it.each([
    ["a missing email", { username: USERNAME, password: PASSWORD, name: NAME }],
    [
      "a non-string name",
      { username: USERNAME, password: PASSWORD, name: 1, email: EMAIL },
    ],
  ])("%s is invalid_input and does not call Elastic Path or clear checkout", async (_label, body) => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    tokenCalls = [];

    const { res } = await register(auth, cookies, body);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_input");
    expect(tokenCalls).toEqual([]);
    expect(checkoutCleared(res)).toBe(false);
  });
});

describe("session versus body precedence", () => {
  it("reports no_session before invalid_input on login", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const res = await auth.api.epAccountLogin({
      body: { username: 1 },
      headers: new Headers(),
      asResponse: true,
    });

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_session");
    expect(tokenCalls).toEqual([]);
  });

  it("reports invalid_input for a login body once a session exists", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    tokenCalls = [];

    const res = await auth.api.epAccountLogin({
      body: { password: PASSWORD },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_input");
    expect(tokenCalls).toEqual([]);
    expect(checkoutCleared(res)).toBe(false);
  });

  it("reports no_session before invalid_input on register", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const res = await (auth.api as any).epAccountRegister({
      body: { username: 1 },
      headers: new Headers(),
      asResponse: true,
    });

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_session");
    expect(tokenCalls).toEqual([]);
  });

  it("reports invalid_input for a register body once a session exists", async () => {
    const auth = buildAuth({ passwordProfileId: PROFILE });
    const cookies = await anonymous(auth);
    tokenCalls = [];

    const { res } = await register(auth, cookies, { username: USERNAME });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_input");
    expect(tokenCalls).toEqual([]);
    expect(checkoutCleared(res)).toBe(false);
  });
});

function mountedAuth() {
  return createEpAuth({
    clientId: EP_CLIENT_ID,
    host: EP_HOST,
    secret: SECRET,
    baseURL: "http://localhost:3000",
    passwordProfileId: PROFILE,
    checkout: { sessionSecret: "register-test-secret-at-least-16" },
  } as any);
}

/**
 * The browser: cookies in, and every call goes through `createEpAuthRoutes`.
 */
function browserFor(epAuth: any) {
  const routes = createEpAuthRoutes(epAuth);
  let jar = "";

  const browserFetch = (async (input: any, init: any = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (jar) headers.set("cookie", jar);
    const response = await (init.method === "GET" ? routes.GET : routes.POST)(
      new Request(`http://localhost:3000${String(input)}`, {
        method: init.method,
        headers,
        body: init.body,
      })
    );
    jar = mergeCookies(jar, response);
    return response;
  }) as typeof fetch;

  return {
    client: createEpIdentityClient({ fetch: browserFetch }),
    routes,
    cookie: () => jar,
  };
}

describe("the browser response", () => {
  it("returns login's shape and no server credential", async () => {
    const epAuth = mountedAuth();
    const routes = createEpAuthRoutes(epAuth);
    const anon = await routes.POST(
      new Request("http://localhost:3000/api/ep/ep/anonymous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    );
    const cookies = mergeCookies("", anon);

    const res = await routes.POST(
      new Request("http://localhost:3000/api/ep/ep/account/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookies },
        body: JSON.stringify(REGISTER_BODY),
      })
    );

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(accountTokenFor("acct-north"));
    expect(raw).not.toContain(accountTokenFor("acct-south"));
    expect(raw).not.toContain("anon-token");
    expect(raw).not.toContain(PASSWORD);
    expect(raw).not.toContain(EP_HOST);
    expect(raw).not.toContain(EP_CLIENT_ID);

    const body = JSON.parse(raw);
    expect(body.user).toMatchObject({ email: EMAIL, name: NAME });
    expect(body.session.epMemberId).toBe("member-1");
    expect(body.session.epAccount).toBeUndefined();
    expect(body.session.epAccessToken).toBeUndefined();
    expect(body.session.epAnchorToken).toBeUndefined();
    expect(body.session.token).toBeUndefined();
    expect(body.accounts).toEqual([
      { id: "acct-north", name: "Acme North" },
      { id: "acct-south", name: "Acme South" },
    ]);
    expect(body.total).toBe(2);
  });

  it("keeps an Elastic Path 400 and its detail, and does not call it invalid_credentials", async () => {
    signupFailure = {
      status: 400,
      detail: "Password must contain a number",
    };
    const browser = browserFor(mountedAuth());
    await browser.client.signInAnonymously();

    const err = await browser.client.register(REGISTER_BODY).catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.code).toBe("registration_rejected");
    expect(err.code).not.toBe("invalid_credentials");
    expect(err.code).not.toBe("no_session");
    expect(err.message).toBe("Password must contain a number");
    expect(epIdentityErrorCode(err)).toBe("registration_rejected");

    const session = await browser.client.getSession();
    expect(session?.session.epMemberId).toBeUndefined();
  });

  it("keeps the member signed in on the session it wrote", async () => {
    store.accounts = [ACCOUNTS[0]];
    const browser = browserFor(mountedAuth());
    await browser.client.signInAnonymously();

    await browser.client.register(REGISTER_BODY);
    const session = await browser.client.getSession();

    expect(session?.session.epMemberId).toBe("member-1");
    expect(session?.session.epAccount?.id).toBe("acct-north");
    expect(session?.user).toMatchObject({ email: EMAIL, name: NAME });
  });

  it.each([
    [401, 401],
    [503, 502],
  ])(
    "treats an Elastic Path %i as a failed token call, not a rejected registration",
    async (upstream, expected) => {
      signupFailure = { status: upstream, detail: "token request failed" };
      const browser = browserFor(mountedAuth());
      await browser.client.signInAnonymously();

      const err = await browser.client.register(REGISTER_BODY).catch((e) => e);

      expect(err.status).toBe(expected);
      expect(err.code).toBe("account_token_mint_failed");
      expect(epIdentityErrorCode(err)).not.toBe("no_session");

      const session = await browser.client.getSession();
      expect(session?.session.id).toBeTruthy();
      expect(session?.session.epMemberId).toBeUndefined();
    }
  );
});
