/**
 * The envelope's lifetime and its own cookie name.
 *
 * Two defects meet here. The envelope fell back to better-auth's
 * 300-second `cookieCache` default while the cart it points at lives
 * seven days, and every HTTPS deployment wrote `__Secure-`-prefixed
 * cookies it then looked up unprefixed — so `/ep/refresh`, account set,
 * account clear and cart-id persist all read nothing in production and
 * everything on `http://localhost`.
 *
 * These run against a real better-auth instance with a real cookie
 * round-trip, because both defects live in the gap between what
 * better-auth writes and what the plugin reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";
import { ENVELOPE_LIFETIME_SECONDS } from "../envelope";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const CART_ID = "63b53d4f-d88a-48b3-b416-8cb1470aad8d";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({
          access_token: "anon-token",
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

/**
 * `createEpAuth` is the thing consumers call, and the session options it
 * passes are exactly what this file is asserting — so build the same
 * better-auth instance it does rather than a hand-written one.
 */
function buildAuth(baseURL: string) {
  return betterAuth({
    secret: SECRET,
    baseURL,
    plugins: [epPlugin({ clientId: EP_CLIENT_ID, host: EP_HOST })],
    session: {
      expiresIn: ENVELOPE_LIFETIME_SECONDS,
      cookieCache: {
        enabled: true,
        strategy: "jwe",
        refreshCache: true,
        maxAge: ENVELOPE_LIFETIME_SECONDS,
      },
    },
  } as any);
}

function setCookies(res: Response): string[] {
  const out: string[] = [];
  res.headers.forEach((v: string, k: string) => {
    if (k.toLowerCase() === "set-cookie") out.push(v);
  });
  return out;
}

function cookieHeader(res: Response): string {
  const pairs: Record<string, string> = {};
  for (const raw of setCookies(res)) {
    const head = raw.split(";")[0];
    const eq = head.indexOf("=");
    if (eq < 0) continue;
    pairs[head.slice(0, eq).trim()] = head.slice(eq + 1).trim();
  }
  return Object.keys(pairs)
    .map((name) => `${name}=${pairs[name]}`)
    .join("; ");
}

function maxAgeOf(res: Response, cookieName: string): number | null {
  for (const raw of setCookies(res)) {
    if (!raw.startsWith(`${cookieName}=`)) continue;
    const match = /(?:^|;\s*)Max-Age=(-?\d+)/i.exec(raw);
    if (match) return Number(match[1]);
  }
  return null;
}

async function mintAnonymous(auth: any, baseURL: string): Promise<Response> {
  return auth.handler(
    new Request(`${baseURL}/api/auth/ep/anonymous`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseURL },
      body: "{}",
    })
  );
}

describe("the envelope outlives the cart it points at", () => {
  it("gives the session_data cookie the cart's seven-day lifetime", async () => {
    const baseURL = "http://localhost:3000";
    const res = await mintAnonymous(buildAuth(baseURL), baseURL);

    expect(maxAgeOf(res, "better-auth.session_data")).toBe(
      ENVELOPE_LIFETIME_SECONDS
    );
  });

  it("dates the session itself on the cart clock, not the EP token's hour", async () => {
    const baseURL = "http://localhost:3000";
    const res = await mintAnonymous(buildAuth(baseURL), baseURL);
    const body = await res.json();

    const secondsOut =
      new Date(body.session.expiresAt).getTime() / 1000 - Date.now() / 1000;

    expect(secondsOut).toBeGreaterThan(ENVELOPE_LIFETIME_SECONDS - 120);
  });

  it("re-dates the session on refresh, so an active shopper never lapses", async () => {
    const baseURL = "http://localhost:3000";
    const auth = buildAuth(baseURL);
    const minted = await mintAnonymous(auth, baseURL);
    const cookie = cookieHeader(minted);
    const mintedExpiry = new Date((await minted.json()).session.expiresAt);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const refreshed = await auth.handler(
      new Request(`${baseURL}/api/auth/ep/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseURL,
          cookie,
        },
        body: "{}",
      })
    );
    const refreshedExpiry = new Date((await refreshed.json()).session.expiresAt);

    expect(refreshedExpiry.getTime()).toBeGreaterThan(mintedExpiry.getTime());
  });
});

describe("an HTTPS deployment reads its own session cookie", () => {
  const baseURL = "https://store.example.com";

  it("writes the __Secure- prefixed cookie better-auth chose", async () => {
    const res = await mintAnonymous(buildAuth(baseURL), baseURL);

    expect(
      setCookies(res).some((c) =>
        c.startsWith("__Secure-better-auth.session_data=")
      )
    ).toBe(true);
  });

  it("preserves the shopper's identity across /ep/refresh", async () => {
    const auth = buildAuth(baseURL);
    const minted = await mintAnonymous(auth, baseURL);
    const mintedUserId = (await minted.json()).user.id;

    const refreshed = await auth.handler(
      new Request(`${baseURL}/api/auth/ep/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseURL,
          cookie: cookieHeader(minted),
        },
        body: "{}",
      })
    );

    // Before the fix the prefixed cookie was invisible, so refresh fell
    // through to "no prior session" and minted a brand new identity —
    // silently dropping the cart pointer with it.
    expect((await refreshed.json()).user.id).toBe(mintedUserId);
  });

  it("persists a cartId through /ep/cart", async () => {
    const auth = buildAuth(baseURL);
    const minted = await mintAnonymous(auth, baseURL);

    const res = await auth.handler(
      new Request(`${baseURL}/api/auth/ep/cart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseURL,
          cookie: cookieHeader(minted),
        },
        body: JSON.stringify({ cartId: CART_ID }),
      })
    );

    expect(res.status).toBe(200);
    expect((await res.json()).session.epCartId).toBe(CART_ID);
  });
});
