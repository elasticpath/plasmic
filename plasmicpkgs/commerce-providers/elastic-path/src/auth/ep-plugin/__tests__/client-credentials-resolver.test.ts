/**
 * Client Credentials Token Resolver — request-scoped, memoized minter for
 * EP's `client_credentials` OAuth grant.
 *
 * The resolver is built per-request (in the host app's checkout-context
 * factory). Each instance memoizes the token in a closure: subsequent calls
 * within the same request return the same token. Different resolver
 * instances do not share state.
 *
 * Tested behaviors (slice 1):
 *   1. Posts to {host}/oauth/access_token with grant_type=client_credentials,
 *      client_id, client_secret in form-urlencoded body.
 *   2. Memoizes per-instance: one mint per resolver, no matter how many calls.
 *   3. Distinct instances mint independently — no shared cache.
 *   4. Throws on non-2xx EP response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClientCredentialsTokenResolver } from "../client-credentials-resolver";

const HOST = "https://api.test.elasticpath.com";
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";

let originalFetch: typeof fetch;
let fetchMock: ReturnType<typeof vi.fn>;

function makeOkResponse(token: string) {
  return new Response(
    JSON.stringify({
      access_token: token,
      token_type: "Bearer",
      expires: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      identifier: "client_credentials",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn(async () => makeOkResponse("admin-token-1"));
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("createClientCredentialsTokenResolver", () => {
  it("posts grant_type=client_credentials with client_id and client_secret", async () => {
    const resolver = createClientCredentialsTokenResolver({
      host: HOST,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    const token = await resolver();

    expect(token).toBe("admin-token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${HOST}/oauth/access_token`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );

    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("client_secret")).toBe(CLIENT_SECRET);
  });

  it("memoizes within an instance: many calls, one mint", async () => {
    const resolver = createClientCredentialsTokenResolver({
      host: HOST,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    const [a, b, c] = await Promise.all([resolver(), resolver(), resolver()]);
    const d = await resolver();

    expect(a).toBe("admin-token-1");
    expect(b).toBe("admin-token-1");
    expect(c).toBe("admin-token-1");
    expect(d).toBe("admin-token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not share cache across resolver instances", async () => {
    let n = 0;
    fetchMock.mockImplementation(async () => {
      n += 1;
      return makeOkResponse(`admin-token-${n}`);
    });

    const a = createClientCredentialsTokenResolver({
      host: HOST,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
    const b = createClientCredentialsTokenResolver({
      host: HOST,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    expect(await a()).toBe("admin-token-1");
    expect(await b()).toBe("admin-token-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on non-2xx response from EP", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ detail: "bad creds" }] }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    const resolver = createClientCredentialsTokenResolver({
      host: HOST,
      clientId: CLIENT_ID,
      clientSecret: "wrong-secret",
    });

    await expect(resolver()).rejects.toThrow(/401/);
  });
});
