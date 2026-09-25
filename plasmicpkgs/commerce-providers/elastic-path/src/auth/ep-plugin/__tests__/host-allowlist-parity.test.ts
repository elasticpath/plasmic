import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";
import { extractEpProviderConfig } from "../../extract-ep-provider-config";
import { DEFAULT_HOST_ALLOWLIST } from "../../host-allowlist";
import { buildEpCtx } from "../../../ep-server-functions/build-ep-ctx";
import { isUsableAuth } from "../../../ep-server-functions/ep-client";

const CONSTRUCTOR_HOST = "https://useast.api.elasticpath.com";
const CUSTOM_HOST = "https://commerce.acme.test";

let originalFetch: typeof fetch;
let originalEnvHosts: string | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalEnvHosts = process.env.EP_HOST_ALLOWLIST;
  delete process.env.EP_HOST_ALLOWLIST;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url).endsWith("/oauth/access_token")) {
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
  if (originalEnvHosts === undefined) {
    delete process.env.EP_HOST_ALLOWLIST;
  } else {
    process.env.EP_HOST_ALLOWLIST = originalEnvHosts;
  }
  vi.restoreAllMocks();
});

function bundleNaming(host: string) {
  return {
    bundle: {
      projects: [{ globalContextsProviderFileName: "global__p.js" }],
      modules: {
        server: [
          {
            type: "code",
            fileName: "global__p.js",
            code: `g.createElement(e, {
              clientId:o&&"clientId"in o?o.clientId:"bundle-cid",
              customHost:o&&"customHost"in o?o.customHost:"${host}",
              host:o&&"host"in o?o.host:"custom"
            })`,
          },
        ],
      },
    },
  };
}

function authReadingBundle(
  bundle: unknown,
  hostAllowlist?: string[]
): {
  auth: ReturnType<typeof createEpAuth>;
  received: Array<readonly string[]>;
} {
  const received: Array<readonly string[]> = [];
  const auth = createEpAuth({
    clientId: "constructor-cid",
    host: CONSTRUCTOR_HOST,
    secret: "z".repeat(48),
    hostAllowlist,
    resolveConfig: async ({ hostAllowlist }) => {
      received.push(hostAllowlist);
      return extractEpProviderConfig(bundle as any, { hostAllowlist });
    },
  });
  return { auth, received };
}

function mintedHosts(): string[] {
  return (globalThis.fetch as any).mock.calls.map((c: any) =>
    String(c[0]).replace(/\/oauth\/access_token$/, "")
  );
}

describe("EP host allow-list parity", () => {
  it("hands the option to every check when it is passed to createEpAuth", async () => {
    const { auth, received } = authReadingBundle(bundleNaming(CUSTOM_HOST), [
      "commerce.acme.test",
    ]);

    const session = await auth.api.getSession({ cookies: {} });
    const ctx = buildEpCtx(session);

    expect(received).toEqual([
      [...DEFAULT_HOST_ALLOWLIST, "commerce.acme.test"],
    ]);
    expect(auth.config.hostAllowlist).toEqual(received[0]);
    expect(mintedHosts()).toEqual([CUSTOM_HOST]);
    expect(session.session?.host).toBe(CUSTOM_HOST);
    expect(ctx).toEqual(
      expect.objectContaining({
        host: CUSTOM_HOST,
        clientId: "bundle-cid",
        accessToken: "tok",
      })
    );
  });

  it("hands EP_HOST_ALLOWLIST to every check when no option is passed", async () => {
    process.env.EP_HOST_ALLOWLIST = " commerce.acme.test , ,";
    const { auth, received } = authReadingBundle(bundleNaming(CUSTOM_HOST));

    const session = await auth.api.getSession({ cookies: {} });

    expect(received).toEqual([
      [...DEFAULT_HOST_ALLOWLIST, "commerce.acme.test"],
    ]);
    expect(mintedHosts()).toEqual([CUSTOM_HOST]);
    expect(buildEpCtx(session).host).toBe(CUSTOM_HOST);
  });

  it("extends the defaults with the union of the option and the env var", () => {
    process.env.EP_HOST_ALLOWLIST = "*.acme.test,commerce.acme.test";
    const { auth } = authReadingBundle(bundleNaming(CUSTOM_HOST), [
      "commerce.acme.test",
      "elasticpath.com",
    ]);

    expect(auth.config.hostAllowlist).toEqual([
      ...DEFAULT_HOST_ALLOWLIST,
      "commerce.acme.test",
      "*.acme.test",
    ]);
    expect(Object.isFrozen(auth.config.hostAllowlist)).toBe(true);
  });

  it("mints against the constructor host when the bundle names a host off the list", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { auth } = authReadingBundle(bundleNaming(CUSTOM_HOST));

    const session = await auth.api.getSession({ cookies: {} });

    expect(mintedHosts()).toEqual([CONSTRUCTOR_HOST]);
    expect(session.session?.host).toBe(CONSTRUCTOR_HOST);
    expect(buildEpCtx(session).host).toBe(CONSTRUCTOR_HOST);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0][0]);
    expect(message).toContain("commerce.acme.test");
    expect(message).toContain("EP host allow-list");
    expect(message).toContain("hostAllowlist");
    expect(message).toContain("EP_HOST_ALLOWLIST");
    expect(message).toContain("custom domain");
    expect(message).not.toMatch(/Self Managed/);
  });

  it("rejects an off-list host the closure returns without the extractor", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const auth = createEpAuth({
      clientId: "constructor-cid",
      host: CONSTRUCTOR_HOST,
      secret: "z".repeat(48),
      resolveConfig: async () => ({ clientId: "bundle-cid", host: CUSTOM_HOST }),
    });

    const session = await auth.api.getSession({ cookies: {} });

    expect(mintedHosts()).toEqual([CONSTRUCTOR_HOST]);
    expect(session.session?.clientId).toBe("constructor-cid");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("EP_HOST_ALLOWLIST");
  });

  it("fails soft when the fallback mint is refused", async () => {
    (globalThis.fetch as any).mockImplementation(
      async () => new Response("unauthorized", { status: 401 })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { auth } = authReadingBundle(bundleNaming(CUSTOM_HOST));

    const session = await auth.api.getSession({ cookies: {} });

    expect(session.session).toBeNull();
    expect(isUsableAuth(buildEpCtx(session))).toBe(false);
  });

  it("builds a context the server functions refuse from an empty session", () => {
    expect(isUsableAuth(buildEpCtx({ session: null, cart: null }))).toBe(false);
  });
});
