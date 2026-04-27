import { createEpAuth } from "../create-ep-auth";
import { EpTokenData } from "../cookies";

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

const validTokenData: EpTokenData = {
  accessToken: "existing-token",
  expires: Math.floor(Date.now() / 1000) + 3600,
  expiresIn: 3600,
  tokenType: "Bearer",
  clientId: "my-client-id",
  host: "https://useast.api.elasticpath.com",
};

function encode(data: any): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

describe("createEpAuth", () => {
  it("returns an instance with api.getSession that resolves a session", async () => {
    const epAuth = createEpAuth({
      clientId: "my-client-id",
      host: "https://useast.api.elasticpath.com",
    });

    const req = {
      cookies: { ep_token: encode(validTokenData) },
    };

    const session = await epAuth.api.getSession(req);
    expect(session.session?.accessToken).toBe("existing-token");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses default basePath and cartMergeStrategy", () => {
    const epAuth = createEpAuth({
      clientId: "my-client-id",
      host: "https://useast.api.elasticpath.com",
    });

    expect(epAuth.config.basePath).toBe("/api/ep");
    expect(epAuth.config.cartMergeStrategy).toBe("merge");
  });

  it("accepts custom basePath and cartMergeStrategy", () => {
    const epAuth = createEpAuth({
      clientId: "my-client-id",
      host: "https://useast.api.elasticpath.com",
      basePath: "/api/store",
      cartMergeStrategy: "replace",
    });

    expect(epAuth.config.basePath).toBe("/api/store");
    expect(epAuth.config.cartMergeStrategy).toBe("replace");
  });

  it("throws when checkout.sessionSecret is too short", () => {
    expect(() =>
      createEpAuth({
        clientId: "my-client-id",
        host: "https://useast.api.elasticpath.com",
        checkout: { sessionSecret: "short" },
      })
    ).toThrow(/sessionSecret/);
  });

  it("accepts valid checkout.sessionSecret", () => {
    expect(() =>
      createEpAuth({
        clientId: "my-client-id",
        host: "https://useast.api.elasticpath.com",
        checkout: { sessionSecret: "this-is-at-least-16-chars" },
      })
    ).not.toThrow();
  });

  it("config is frozen after creation", () => {
    const epAuth = createEpAuth({
      clientId: "my-client-id",
      host: "https://useast.api.elasticpath.com",
    });

    expect(Object.isFrozen(epAuth.config)).toBe(true);
  });

  it("getSession passes middleware headers for multi-tenant", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "tenant-token",
          expires: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "Bearer",
        }),
    });

    const epAuth = createEpAuth({
      clientId: "default-client",
      host: "https://default.api.elasticpath.com",
    });

    const req = {
      cookies: {},
      headers: {
        "x-ep-client-id": "tenant-client",
        "x-ep-host": "https://tenant.api.elasticpath.com",
      },
    };

    const session = await epAuth.api.getSession(req);
    expect(session.session?.accessToken).toBe("tenant-token");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://tenant.api.elasticpath.com/oauth/access_token");
  });
});
