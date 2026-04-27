import { createEpSession } from "../session";
import { EpTokenData, EpAccountData } from "../cookies";

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

const validAccountData: EpAccountData = {
  accountId: "acc-123",
  accountName: "Acme Corp",
  accountMemberId: "member-456",
  token: "account-token-xyz",
  expires: Math.floor(Date.now() / 1000) + 86400,
};

const config = {
  clientId: "my-client-id",
  host: "https://useast.api.elasticpath.com",
};

function encode(data: any): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

function mockOAuthSuccess() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        access_token: "fresh-token",
        expires: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "Bearer",
      }),
  });
}

describe("createEpSession", () => {
  it("parses ep_token cookie and does not call OAuth", async () => {
    const cookies = { ep_token: encode(validTokenData) };
    const session = await createEpSession(cookies, config);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(session.session).toEqual({
      accessToken: "existing-token",
      expires: validTokenData.expires,
      clientId: "my-client-id",
      host: "https://useast.api.elasticpath.com",
    });
  });

  it("resolves OAuth when no cookies present", async () => {
    mockOAuthSuccess();
    const session = await createEpSession({}, config);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(session.session?.accessToken).toBe("fresh-token");
  });

  it("resolves OAuth when ep_token cookie is expired", async () => {
    mockOAuthSuccess();
    const expired = {
      ...validTokenData,
      expires: Math.floor(Date.now() / 1000) - 60,
    };
    const session = await createEpSession(
      { ep_token: encode(expired) },
      config
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(session.session?.accessToken).toBe("fresh-token");
  });
});

describe("EpSession.headers", () => {
  it("returns Authorization header for anonymous session", async () => {
    const session = await createEpSession(
      { ep_token: encode(validTokenData) },
      config
    );
    const h = session.headers();
    expect(h["Authorization"]).toBe("Bearer existing-token");
    expect(h["EP-Account-Management-Authentication-Token"]).toBeUndefined();
  });

  it("adds EPAM header when authenticated", async () => {
    const session = await createEpSession(
      {
        ep_token: encode(validTokenData),
        ep_account: encode(validAccountData),
      },
      config
    );
    const h = session.headers();
    expect(h["Authorization"]).toBe("Bearer existing-token");
    expect(h["EP-Account-Management-Authentication-Token"]).toBe(
      "account-token-xyz"
    );
  });
});

describe("EpSession.providerProps", () => {
  it("returns serverToken when session is resolved", async () => {
    const session = await createEpSession(
      { ep_token: encode(validTokenData) },
      config
    );
    expect(session.providerProps()).toEqual({
      serverToken: "existing-token",
    });
  });
});

describe("EpSession.commitCookies", () => {
  it("sets ep_token cookie when token was freshly resolved", async () => {
    mockOAuthSuccess();
    const session = await createEpSession({}, config);

    const appendHeader = jest.fn();
    session.commitCookies({ appendHeader });

    expect(appendHeader).toHaveBeenCalledTimes(1);
    expect(appendHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("ep_token=")
    );
  });

  it("is no-op when token came from cookie", async () => {
    const session = await createEpSession(
      { ep_token: encode(validTokenData) },
      config
    );

    const appendHeader = jest.fn();
    session.commitCookies({ appendHeader });

    expect(appendHeader).not.toHaveBeenCalled();
  });
});

describe("EpSession.isAuthenticated", () => {
  it("is true when ep_account cookie is present and not expired", async () => {
    const session = await createEpSession(
      {
        ep_token: encode(validTokenData),
        ep_account: encode(validAccountData),
      },
      config
    );
    expect(session.isAuthenticated).toBe(true);
    expect(session.user).toEqual(validAccountData);
  });

  it("is false when no ep_account cookie", async () => {
    const session = await createEpSession(
      { ep_token: encode(validTokenData) },
      config
    );
    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  it("is false when ep_account cookie is expired", async () => {
    const expiredAccount = {
      ...validAccountData,
      expires: Math.floor(Date.now() / 1000) - 60,
    };
    const session = await createEpSession(
      {
        ep_token: encode(validTokenData),
        ep_account: encode(expiredAccount),
      },
      config
    );
    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });
});

describe("EpSession multi-tenant", () => {
  it("resolves using middleware headers when no cookie", async () => {
    mockOAuthSuccess();
    const session = await createEpSession({}, config, {
      "x-ep-client-id": "tenant-client-id",
      "x-ep-host": "https://tenant.api.elasticpath.com",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://tenant.api.elasticpath.com/oauth/access_token");
    expect(opts.body).toContain("client_id=tenant-client-id");
  });
});
