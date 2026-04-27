/**
 * createEpAuth adapter (PRD #273) — public surface preservation.
 *
 * Internally `createEpAuth` now wraps `betterAuth({plugins:[epPlugin(...)]})`
 * with stateless cookie-cache mode, but the consumer-facing shape is
 * unchanged from the pre-#273 implementation:
 *
 *   epAuth.api.getSession({ cookies, headers })
 *     → Promise<EpSession>
 *     → { session, user, cart, isAuthenticated, headers(), providerProps(),
 *         commitCookies() }
 *
 * Catchall pages (and the existing `EpSession` consumers) keep working
 * with no source change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";

const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const FAKE_TOKEN = "adapter-fake-token";
const FAKE_EXPIRES = Math.floor(Date.now() / 1000) + 3600;

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({
          access_token: FAKE_TOKEN,
          token_type: "Bearer",
          expires: FAKE_EXPIRES,
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("createEpAuth adapter (PRD #273)", () => {
  it("returns the EpSession public shape from getSession()", async () => {
    const epAuth = createEpAuth({
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      secret: "x".repeat(48),
      checkout: { sessionSecret: "dev-secret-min-16-chars" },
    });

    // Anonymous visit — no cookies.
    const session = await epAuth.api.getSession({
      cookies: {},
      headers: {},
    });

    // EpSession-shape contract — every field the catchall page reads.
    expect(session).toMatchObject({
      session: expect.objectContaining({
        accessToken: FAKE_TOKEN,
        clientId: EP_CLIENT_ID,
        host: EP_HOST,
        expires: FAKE_EXPIRES,
      }),
      user: null,
      cart: null,
      isAuthenticated: false,
    });
    expect(typeof session.headers).toBe("function");
    expect(typeof session.providerProps).toBe("function");
    expect(typeof session.commitCookies).toBe("function");
  });

  it("providerProps() returns serverToken when authenticated session exists", async () => {
    const epAuth = createEpAuth({
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      secret: "x".repeat(48),
      checkout: { sessionSecret: "dev-secret-min-16-chars" },
    });

    const session = await epAuth.api.getSession({
      cookies: {},
      headers: {},
    });

    expect(session.providerProps()).toEqual({ serverToken: FAKE_TOKEN });
  });

  it("commitCookies() emits the better-auth Set-Cookie headers", async () => {
    const epAuth = createEpAuth({
      clientId: EP_CLIENT_ID,
      host: EP_HOST,
      secret: "x".repeat(48),
      checkout: { sessionSecret: "dev-secret-min-16-chars" },
    });

    const session = await epAuth.api.getSession({
      cookies: {},
      headers: {},
    });

    const headers: Array<[string, string]> = [];
    session.commitCookies({
      appendHeader(name: string, value: string) {
        headers.push([name, value]);
      },
    });

    expect(headers.length).toBeGreaterThan(0);
    const all = headers.map(([_, v]) => v).join("\n");
    expect(all).toContain("better-auth.session_token");
    expect(all).toContain("better-auth.session_data");
  });

  it("config validation: rejects checkout.sessionSecret shorter than 16 chars", () => {
    expect(() =>
      createEpAuth({
        clientId: EP_CLIENT_ID,
        host: EP_HOST,
        secret: "x".repeat(48),
        checkout: { sessionSecret: "too-short" },
      })
    ).toThrow(/at least 16/);
  });
});
