/**
 * /ep/anonymous endpoint — mints an anonymous EP token via OAuth implicit
 * grant against {host}/oauth/access_token, persists the result via
 * `setSessionCookie` (the maintainer-accepted stateless pattern; see
 * memory/project_better_auth_stateless_findings.md).
 *
 * We mock fetch at the EP boundary so the test doesn't reach real EP.
 * What we verify:
 *   1. The endpoint hits {host}/oauth/access_token with grant_type=implicit
 *      and client_id from the plugin options.
 *   2. The endpoint's response includes Set-Cookie headers carrying the
 *      better-auth session cookies (session_token + session_data).
 *   3. The response body carries an `epAccessToken` matching the mocked
 *      EP token, plus epClientId / epHost / epExpires.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";

const SECRET = "x".repeat(48);
const EP_HOST = "https://api.test.elasticpath.com";
const EP_CLIENT_ID = "test-client-id";
const FAKE_TOKEN = "fake-anonymous-access-token-abc123";
const FAKE_EXPIRES = Math.floor(Date.now() / 1000) + 3600;

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u === `${EP_HOST}/oauth/access_token`) {
      // EP's implicit-grant response shape.
      return new Response(
        JSON.stringify({
          access_token: FAKE_TOKEN,
          token_type: "Bearer",
          expires: FAKE_EXPIRES,
          expires_in: 3600,
          identifier: "implicit",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("/ep/anonymous endpoint (PRD #273)", () => {
  it("uses resolveConfig() over static options when provided", async () => {
    // The legacy auth's middleware-header escape hatch (`x-ep-client-id` /
    // `x-ep-host`) is preserved here as a per-request `resolveConfig`
    // callback. Lets consumers pull clientId/host from the Plasmic loader
    // bundle on each call instead of pinning at plugin construction.
    const dynamicClientId = "dynamic-resolved-client";
    const dynamicHost = "https://dynamic.api.elasticpath.com";

    // Re-mock fetch so the test ALSO passes when the URL is the dynamic
    // host (default mock only knew EP_HOST). Override the default and
    // assert we hit the dynamic one.
    (globalThis.fetch as any).mockImplementation(async (url: any) => {
      if (String(url) === `${dynamicHost}/oauth/access_token`) {
        return new Response(
          JSON.stringify({
            access_token: "dyn-token",
            token_type: "Bearer",
            expires: FAKE_EXPIRES,
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const auth = betterAuth({
      secret: SECRET,
      baseURL: "http://localhost:3000",
      plugins: [
        epPlugin({
          clientId: "static-fallback",
          host: "https://static.example.com",
          resolveConfig: async () => ({
            clientId: dynamicClientId,
            host: dynamicHost,
          }),
        }),
      ],
      session: {
        cookieCache: { enabled: true, strategy: "jwe", refreshCache: true },
      },
    });

    const result = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    expect(result.status).toBe(200);

    const body = await result.json();
    expect(body.session.epClientId).toBe(dynamicClientId);
    expect(body.session.epHost).toBe(dynamicHost);

    // Verify EP was hit at the DYNAMIC host with the DYNAMIC clientId.
    const calls = (globalThis.fetch as any).mock.calls;
    const dynamicCall = calls.find(
      (c: any) => String(c[0]) === `${dynamicHost}/oauth/access_token`
    );
    expect(dynamicCall).toBeDefined();
    expect(String(dynamicCall[1].body)).toContain(
      `client_id=${dynamicClientId}`
    );
  });

  it("falls back to static options when resolveConfig returns null", async () => {
    const auth = betterAuth({
      secret: SECRET,
      baseURL: "http://localhost:3000",
      plugins: [
        epPlugin({
          clientId: EP_CLIENT_ID,
          host: EP_HOST,
          resolveConfig: async () => null,
        }),
      ],
    });

    const result = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });
    const body = await result.json();
    expect(body.session.epClientId).toBe(EP_CLIENT_ID);
    expect(body.session.epHost).toBe(EP_HOST);
  });

  it("mints an EP token and persists the session via Set-Cookie", async () => {
    const auth = betterAuth({
      secret: SECRET,
      baseURL: "http://localhost:3000",
      plugins: [epPlugin({ clientId: EP_CLIENT_ID, host: EP_HOST })],
      session: {
        cookieCache: { enabled: true, strategy: "jwe", refreshCache: true },
      },
    });

    // Invoke the endpoint via auth.api. The endpoint signature is from
    // better-auth's createAuthEndpoint contract — `request` is optional;
    // we pass an empty request so the endpoint's body (no input args)
    // works with no headers.
    const result = await (auth.api as any).epAnonymous({
      body: {},
      headers: new Headers(),
      asResponse: true,
    });

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);

    // Two Set-Cookie headers — session_token + session_data.
    const setCookies: string[] = [];
    result.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() === "set-cookie") setCookies.push(value);
    });
    expect(
      setCookies.some((c) => c.includes("better-auth.session_token"))
    ).toBe(true);
    expect(
      setCookies.some((c) => c.includes("better-auth.session_data"))
    ).toBe(true);

    // Response body carries the EP fields the catchall page needs.
    const body = await result.json();
    expect(body.session.epAccessToken).toBe(FAKE_TOKEN);
    expect(body.session.epClientId).toBe(EP_CLIENT_ID);
    expect(body.session.epHost).toBe(EP_HOST);
    expect(body.session.epExpires).toBe(FAKE_EXPIRES);

    // Assert the EP fetch happened with the right shape.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = (globalThis.fetch as any).mock.calls[0];
    expect(String(calledUrl)).toBe(`${EP_HOST}/oauth/access_token`);
    expect(calledInit.method).toBe("POST");
    expect(String(calledInit.body)).toContain(
      `grant_type=implicit`
    );
    expect(String(calledInit.body)).toContain(`client_id=${EP_CLIENT_ID}`);
  });
});
