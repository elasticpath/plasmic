/**
 * Regression guard for the security claim in ADR-0001: the access token is
 * attached to requests but never written to browser storage.
 *
 * This drives the real SDK client rather than a fake, because the claim is
 * about what the SDK does with the storage option — not about what we pass it.
 * The SDK's localStorage adapter no-ops when `window` is undefined, so a fake
 * window is installed here; without it this test would pass even if the memory
 * adapter were removed, which is the vacuous version of it.
 */
import { epRequestPort } from "./client";
import { buildEntriesRequest } from "./request";

describe("epRequestPort against the real SDK", () => {
  const realFetch = global.fetch;
  const realWindow = (globalThis as any).window;

  afterEach(() => {
    global.fetch = realFetch;
    if (realWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = realWindow;
    }
  });

  it("attaches the minted token as a bearer without writing it to browser storage", async () => {
    const setItem = jest.fn();
    (globalThis as any).window = {
      localStorage: {
        getItem: () => null,
        setItem,
        removeItem: jest.fn(),
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    global.fetch = (async (input: any, init: any = {}) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      const headers: Record<string, string> = {};
      const source = input?.headers ?? init?.headers;
      if (source && typeof source.forEach === "function") {
        source.forEach((value: string, key: string) => {
          headers[key.toLowerCase()] = value;
        });
      }
      calls.push({ url, headers });

      const body = url.includes("/oauth/access_token")
        ? {
            access_token: "minted-token",
            expires_in: 3600,
            identifier: "implicit",
            token_type: "Bearer",
          }
        : { data: [] };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const port = epRequestPort({
      host: "https://euwest.api.elasticpath.com",
      clientId: "abc123",
    });

    // Routed through the real builder, and matched on the whole URL. Selecting
    // the call with `includes` let a malformed URL satisfy this test, which is
    // how a doubled host survived here undetected.
    await port(buildEntriesRequest({ customApi: "faqs" }));

    const entriesCall = calls.find(
      (c) =>
        c.url ===
        "https://euwest.api.elasticpath.com/v2/extensions/faqs?page[total_method]=observed"
    );
    expect(entriesCall).toBeDefined();
    expect(entriesCall!.headers.authorization).toBe("Bearer minted-token");
    expect(setItem).not.toHaveBeenCalled();
  });
});
