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

// Read off the context, not the handler: better-auth disables origin
// checks under isTest(), so a handler probe would pass vacuously.
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
      trustedOrigins: ["http://localhost:3003"],
    });

    const theirs = new Set(await betterAuthTrustedOrigins(auth));
    const ours = new Set(auth.config.trustedOrigins);

    expect(
      [...ours].filter((o) => !theirs.has(o)),
      "origins we advertise that better-auth does not trust"
    ).toEqual([]);
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
