/**
 * The session cart is set by server code only: after a cart write creates a
 * cart, `persistCartId` records it on the envelope. The browser cannot name a
 * cart, because a cart id alone grants access to that cart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";
import { createEpAuthRoutes } from "../auth-routes";
import { persistCartId } from "../persist-cart-id";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const ORIGIN = "http://localhost:3000";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({
          access_token: "tok-cart-test",
          token_type: "Bearer",
          expires: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function buildAuth() {
  return createEpAuth({
    clientId: EP_CLIENT_ID,
    host: EP_HOST,
    secret: SECRET,
    baseURL: ORIGIN,
  });
}

function mergeCookies(prior: string, setCookies: string[]): string {
  const map = new Map<string, string>();
  for (const part of prior.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  for (const value of setCookies) {
    const head = value.split(";")[0];
    const eq = head.indexOf("=");
    if (eq > 0) map.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
  }
  return [...map.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

function setCookiesOf(res: Response): string[] {
  const out: string[] = [];
  res.headers.forEach((v: string, k: string) => {
    if (k.toLowerCase() === "set-cookie") out.push(v);
  });
  return out;
}

async function anonymousCookies(auth: ReturnType<typeof buildAuth>) {
  const res = await (auth.handler.api as any).epAnonymous({
    body: {},
    headers: new Headers(),
    asResponse: true,
  });
  return {
    cookie: mergeCookies("", setCookiesOf(res)),
    body: await res.json(),
  };
}

async function storedSession(
  auth: ReturnType<typeof buildAuth>,
  cookie: string
): Promise<any> {
  return (
    (await auth.handler.api.getSession({
      headers: new Headers({ cookie }),
    } as any)) as any
  ).session;
}

describe("the session cart", () => {
  it("is recorded by server code after it creates a cart, keeping the rest of the envelope", async () => {
    const auth = buildAuth();
    const anon = await anonymousCookies(auth);

    const setCookies = await persistCartId(
      auth,
      new Request(`${ORIGIN}/api/ep/proxy/addCartItem`, {
        method: "POST",
        headers: { cookie: anon.cookie, origin: ORIGIN },
      }),
      "cart-abc-123"
    );

    const session = await storedSession(
      auth,
      mergeCookies(anon.cookie, setCookies)
    );
    expect(session.epCartId).toBe("cart-abc-123");
    expect(session.id).toBe(anon.body.session.id);
    expect(session.epAccessToken).toBe("tok-cart-test");
  });

  it("is not recorded when there is no session to record it on", async () => {
    const auth = buildAuth();

    const setCookies = await persistCartId(
      auth,
      new Request(`${ORIGIN}/api/ep/proxy/addCartItem`, { method: "POST" }),
      "cart-abc-123"
    );

    expect(setCookies).toEqual([]);
  });

  it("cannot be set by the browser", async () => {
    const auth = buildAuth();
    const anon = await anonymousCookies(auth);
    const routes = createEpAuthRoutes(auth);

    const res = await routes.POST(
      new Request(`${ORIGIN}/api/ep/ep/cart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: anon.cookie,
          origin: ORIGIN,
        },
        body: JSON.stringify({ cartId: "someone-elses-cart" }),
      })
    );

    expect(res.status).toBe(404);
    const session = await storedSession(
      auth,
      mergeCookies(anon.cookie, setCookiesOf(res))
    );
    expect(session.epCartId).toBeUndefined();
  });
});
