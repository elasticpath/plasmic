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
});
