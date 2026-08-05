/**
 * ADR-0001 makes `epAuth.config.trustedOrigins` the one origin trust list:
 * the proxy's CORS reflection and the origin gate both read it. That only
 * holds if the list agrees with what better-auth itself accepts.
 *
 * A superset is the dangerous direction — the proxy would set CORS headers
 * and the gate would pass a request that better-auth then rejects mid-flight,
 * which is the silent cart-id-persistence 403 the ADR exists to remove. So
 * rather than re-asserting our own resolution, this asks better-auth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";

const EP_HOST = "https://api.test.elasticpath.com";
let originalFetch: typeof fetch;
let originalEnvOrigins: string | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalEnvOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({
          access_token: "tok",
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
  if (originalEnvOrigins === undefined) {
    delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  } else {
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = originalEnvOrigins;
  }
  vi.restoreAllMocks();
});

/**
 * better-auth's own resolved trust list, straight off its context.
 *
 * Deliberately not probed through the request handler: better-auth sets
 * `skipOriginCheck` to true whenever `isTest()` (create-context.mjs), so
 * under Vitest its handler accepts every origin and any assertion made that
 * way would pass vacuously.
 */
async function betterAuthTrustedOrigins(auth: any): Promise<string[]> {
  const ctx = await auth.handler.$context;
  return ctx.trustedOrigins;
}

describe("config.trustedOrigins parity with better-auth", () => {
  it("matches better-auth's resolved list exactly", async () => {
    process.env.BETTER_AUTH_TRUSTED_ORIGINS =
      "https://studio.elasticpathdev.com";
    const auth = createEpAuth({
      clientId: "cid",
      host: EP_HOST,
      secret: "z".repeat(48),
      baseURL: "http://localhost:3456",
      // Deliberately omits the baseURL origin: an explicit list replaces the
      // defaults, but better-auth re-adds its own origin regardless.
      trustedOrigins: ["http://localhost:3003"],
    });

    const theirs = new Set(await betterAuthTrustedOrigins(auth));
    const ours = new Set(auth.config.trustedOrigins);

    // Advertising an origin better-auth rejects is the split-brain ADR-0001
    // removes: the proxy would send CORS headers and the gate would pass a
    // request that then 403s at the auth boundary.
    expect(
      [...ours].filter((o) => !theirs.has(o)),
      "origins we advertise that better-auth does not trust"
    ).toEqual([]);
    // The reverse gap is milder but still breaks the single-list promise.
    expect(
      [...theirs].filter((o) => !ours.has(o)),
      "origins better-auth trusts that we do not advertise"
    ).toEqual([]);
  });

  it("carries the baseURL origin and the env-var origins into the list", async () => {
    process.env.BETTER_AUTH_TRUSTED_ORIGINS =
      "https://studio.elasticpathdev.com, https://second.example.com";
    const auth = createEpAuth({
      clientId: "cid",
      host: EP_HOST,
      secret: "z".repeat(48),
      baseURL: "http://localhost:3456",
      trustedOrigins: ["http://localhost:3003"],
    });

    expect(auth.config.trustedOrigins).toEqual(
      expect.arrayContaining([
        "http://localhost:3003",
        "http://localhost:3456",
        "https://studio.elasticpathdev.com",
        "https://second.example.com",
      ])
    );
  });
});
