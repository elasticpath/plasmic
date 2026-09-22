/**
 * The identity client against the real handler: a storefront's journey,
 * driven through method calls, with cookies as the only identity input.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpAuthRoutes } from "../auth-routes";
import { epPlugin } from "../ep-plugin";
import { createEpIdentityClient } from "../../../identity/client";
import {
  EP_IDENTITY_OPERATION_NAMES,
  EP_IDENTITY_ROUTES,
} from "../../../identity/operations";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const PROFILE = "profile-1";
const USERNAME = "buyer@example.com";
const PASSWORD = "Passw0rd!";
const ANON_TOKEN = "anon-token-value";

const ACCOUNTS = [
  { id: "acct-north", name: "Acme North" },
  { id: "acct-south", name: "Acme South" },
];

function accountTokenFor(id: string): string {
  return `account-token-${id}`;
}

let originalFetch: typeof fetch;

function installEpFetch() {
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (u === `${EP_HOST}/oauth/access_token`) {
      return json({
        access_token: ANON_TOKEN,
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
      const body = JSON.parse(init.body);
      const data = body.data;
      if (
        data.authentication_mechanism === "password" &&
        (data.username !== USERNAME || data.password !== PASSWORD)
      ) {
        return json({ errors: [{ detail: "authentication failed" }] }, 400);
      }
      const expires = new Date(Date.now() + 86400_000).toISOString();
      return json(
        {
          meta: {
            account_member_id: "member-1",
            results: { total: ACCOUNTS.length },
          },
          data: ACCOUNTS.map((a) => ({
            account_id: a.id,
            account_name: a.name,
            token: accountTokenFor(a.id),
            type: "account_management_authentication_token",
            expires,
          })),
        },
        201
      );
    }
    throw new Error(`Unexpected URL: ${u}`);
  }) as any;
}

/**
 * Stands in for the browser: carries the cookie jar the way a browser
 * would, and routes the client's request at the mounted handler.
 */
function browserAt(basePath?: string) {
  const epAuth = createEpAuth({
    clientId: EP_CLIENT_ID,
    host: EP_HOST,
    secret: SECRET,
    basePath,
    passwordProfileId: PROFILE,
    checkout: { sessionSecret: "identity-client-test-secret-569" },
  } as any);
  const routes = createEpAuthRoutes(epAuth);

  let jar = "";
  const seen: string[] = [];

  const browserFetch = (async (input: any, init: any = {}) => {
    const path = String(input);
    seen.push(path);
    const headers = new Headers(init.headers ?? {});
    if (jar) headers.set("cookie", jar);

    const response = await (init.method === "GET" ? routes.GET : routes.POST)(
      new Request(`http://localhost:3000${path}`, {
        method: init.method,
        headers,
        body: init.body,
      })
    );

    const map = new Map<string, string>();
    for (const part of jar.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") return;
      const head = value.split(";")[0];
      const eq = head.indexOf("=");
      if (eq > 0) map.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
    });
    jar = Array.from(map.entries())
      .map(([n, v]) => `${n}=${v}`)
      .join("; ");

    return response;
  }) as unknown as typeof fetch;

  return {
    client: createEpIdentityClient({ basePath, fetch: browserFetch }),
    seen,
    get cookie() {
      return jar;
    },
  };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  installEpFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("the identity client against the mounted handler", () => {
  it("carries a shopper from anonymous through sign-in to a chosen organisation", async () => {
    const browser = browserAt();

    const anonymous = await browser.client.signInAnonymously();
    expect(anonymous.session.id).toBeTruthy();
    expect(anonymous.session.epMemberId).toBeUndefined();

    const signedIn = await browser.client.login({
      username: USERNAME,
      password: PASSWORD,
    });
    expect(signedIn.session.epMemberId).toBe("member-1");
    expect(signedIn.accounts).toEqual(ACCOUNTS);
    expect(signedIn.total).toBe(2);

    // A member of several organisations is placed in none of them.
    expect(signedIn.session.epAccount).toBeUndefined();

    const roster = await browser.client.roster();
    expect(roster.accounts).toEqual(ACCOUNTS);

    const selected = await browser.client.selectAccount({
      accountId: "acct-south",
    });
    expect(selected.session.epAccount).toEqual({
      id: "acct-south",
      name: "Acme South",
    });

    const session = await browser.client.getSession();
    expect(session?.session.epAccount?.id).toBe("acct-south");
  });

  it("hands back no Elastic Path credential at any point in that journey", async () => {
    const browser = browserAt();

    const seen = [
      await browser.client.signInAnonymously(),
      await browser.client.login({ username: USERNAME, password: PASSWORD }),
      await browser.client.roster(),
      await browser.client.selectAccount({ accountId: "acct-north" }),
      await browser.client.rollAccount(),
      await browser.client.getSession(),
      await browser.client.logout(),
    ];

    const wire = JSON.stringify(seen);
    expect(wire).not.toContain(ANON_TOKEN);
    expect(wire).not.toContain(accountTokenFor("acct-north"));
    expect(wire).not.toContain(accountTokenFor("acct-south"));
    expect(wire).not.toContain(EP_CLIENT_ID);
    expect(wire).not.toContain(EP_HOST);
  });

  it("states a refusal as the server's own code", async () => {
    const browser = browserAt();
    await browser.client.signInAnonymously();

    const err = await browser.client
      .login({ username: USERNAME, password: "wrong" })
      .catch((e) => e);

    expect(err.code).toBe("invalid_credentials");
    expect(err.status).toBe(401);
  });

  it("finds a handler the consumer mounted somewhere else", async () => {
    const browser = browserAt("/api/store");

    const anonymous = await browser.client.signInAnonymously();

    expect(anonymous.session.id).toBeTruthy();
    expect(browser.seen).toEqual(["/api/store/ep/anonymous"]);
  });

  it("points the envelope at a cart", async () => {
    const browser = browserAt();
    await browser.client.signInAnonymously();

    const updated = await browser.client.setCart({ cartId: "cart-42" });

    expect(updated.session.epCartId).toBe("cart-42");
  });
});

describe("the client and the plugin agree on where every operation lives", () => {
  it("mounts every operation the client calls, at the path it calls", () => {
    const endpoints = (
      epPlugin({ clientId: EP_CLIENT_ID, host: EP_HOST }) as any
    ).endpoints as Record<string, { path: string; options?: any }>;

    const mounted = new Map<string, string>();
    for (const endpoint of Object.values(endpoints)) {
      mounted.set(endpoint.path, endpoint.options?.method ?? "POST");
    }

    // `getSession` is better-auth's own endpoint, not one this plugin mounts.
    const pluginOperations = EP_IDENTITY_OPERATION_NAMES.filter(
      (name) => name !== "getSession"
    );

    for (const name of pluginOperations) {
      const route = EP_IDENTITY_ROUTES[name];
      expect([name, mounted.get(route.path)]).toEqual([name, route.method]);
    }
  });

  it("leaves no endpoint on the plugin without a client method", () => {
    const endpoints = (
      epPlugin({ clientId: EP_CLIENT_ID, host: EP_HOST }) as any
    ).endpoints as Record<string, { path: string }>;

    const called = new Set(
      Object.values(EP_IDENTITY_ROUTES).map((route) => route.path)
    );

    expect(
      Object.values(endpoints)
        .map((endpoint) => endpoint.path)
        .filter((path) => !called.has(path))
    ).toEqual([]);
  });
});
