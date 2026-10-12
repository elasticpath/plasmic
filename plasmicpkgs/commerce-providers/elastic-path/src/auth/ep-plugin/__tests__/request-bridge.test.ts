/**
 * The request bridge `createEpAuth` registers, which hands the page request's
 * session to the catalog-search server pass in another copy of the package.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readEpRequestBridge } from "../../../ep-server-functions/request-bridge";
import { createEpAuth } from "../create-ep-auth-better";

const nextRequest = vi.hoisted(() => ({
  headers: undefined as Headers | undefined,
}));

vi.mock("next/headers.js", () => ({
  async headers() {
    if (!nextRequest.headers) {
      throw new Error("`headers` was called outside a request scope.");
    }
    return nextRequest.headers;
  },
}));

const EP_HOST = "https://api.test.elasticpath.com";
const ORIGIN = "http://localhost:3000";

let originalFetch: typeof fetch;
let tokensMinted: number;

beforeEach(() => {
  nextRequest.headers = undefined;
  tokensMinted = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/oauth/access_token") {
      return new Response(
        JSON.stringify({
          access_token: `anon-token-${++tokensMinted}`,
          token_type: "Bearer",
          expires: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function storefrontAuth() {
  return createEpAuth({
    clientId: "test-client-id",
    host: EP_HOST,
    secret: "x".repeat(48),
    baseURL: ORIGIN,
  });
}

async function shopperCookie(auth: ReturnType<typeof storefrontAuth>) {
  const anon: Response = await (auth.handler.api as any).epAnonymous({
    body: {},
    headers: new Headers(),
    asResponse: true,
  });
  const pairs: string[] = [];
  anon.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") pairs.push(value.split(";")[0]);
  });
  return pairs.join("; ");
}

describe("the request bridge", () => {
  it("hands a server render the page request's session", async () => {
    const auth = storefrontAuth();
    nextRequest.headers = new Headers({ cookie: await shopperCookie(auth) });

    const session = await readEpRequestBridge()?.requestSession();

    expect(session).toMatchObject({
      accessToken: "anon-token-1",
      host: EP_HOST,
      clientId: "test-client-id",
    });
  });

  it("has no session outside a request scope", async () => {
    storefrontAuth();

    expect(await readEpRequestBridge()?.requestSession()).toBeNull();
    expect(tokensMinted).toBe(0);
  });

  it("reads the nonce Next.js middleware forwards as x-nonce", async () => {
    storefrontAuth();
    nextRequest.headers = new Headers({ "x-nonce": "from-header" });

    expect(await readEpRequestBridge()?.requestNonce()).toBe("from-header");
  });

  it("reads the nonce from the request's content security policy", async () => {
    storefrontAuth();
    nextRequest.headers = new Headers({
      "content-security-policy":
        "default-src 'self'; script-src 'self' 'nonce-from-csp' 'strict-dynamic'",
    });

    expect(await readEpRequestBridge()?.requestNonce()).toBe("from-csp");
  });

  it("has no nonce when the request carries none", async () => {
    storefrontAuth();
    nextRequest.headers = new Headers();

    expect(await readEpRequestBridge()?.requestNonce()).toBeUndefined();
  });

  it("hands a server render the session the page already read, minting no second token", async () => {
    const auth = storefrontAuth();
    nextRequest.headers = new Headers();

    const page = await auth.api.getSession({ cookies: {} });
    const bridged = await readEpRequestBridge()?.requestSession();

    expect(tokensMinted).toBe(1);
    expect(bridged?.accessToken).toBe(page.session?.accessToken);
  });
});

describe("getSession within one page request", () => {
  it("reads the session once for every caller", async () => {
    const auth = storefrontAuth();
    nextRequest.headers = new Headers();

    const [first, second] = await Promise.all([
      auth.api.getSession({ cookies: {} }),
      auth.api.getSession({ cookies: {} }),
    ]);
    const third = await auth.api.getSession({ cookies: {} });

    expect(tokensMinted).toBe(1);
    expect(second.session?.accessToken).toBe(first.session?.accessToken);
    expect(third.session?.accessToken).toBe(first.session?.accessToken);
  });

  it("reads again for different cookies", async () => {
    const auth = storefrontAuth();
    nextRequest.headers = new Headers();

    await auth.api.getSession({ cookies: { "shop-currency": "EUR" } });
    await auth.api.getSession({ cookies: { "shop-currency": "GBP" } });

    expect(tokensMinted).toBe(2);
  });

  it("reads again in the next page request", async () => {
    const auth = storefrontAuth();

    nextRequest.headers = new Headers();
    await auth.api.getSession({ cookies: {} });
    nextRequest.headers = new Headers();
    await auth.api.getSession({ cookies: {} });

    expect(tokensMinted).toBe(2);
  });

  it("reads every time outside a request scope", async () => {
    const auth = storefrontAuth();

    await auth.api.getSession({ cookies: {} });
    await auth.api.getSession({ cookies: {} });

    expect(tokensMinted).toBe(2);
  });
});
