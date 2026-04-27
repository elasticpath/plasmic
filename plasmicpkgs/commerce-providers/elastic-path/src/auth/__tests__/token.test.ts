import { resolveEpToken } from "../token";

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("resolveEpToken", () => {
  it("calls EP OAuth and returns EpTokenData", async () => {
    const oauthResponse = {
      access_token: "resolved-token-abc",
      expires: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: "Bearer",
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(oauthResponse),
    });

    const result = await resolveEpToken(
      "my-client-id",
      "https://useast.api.elasticpath.com"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://useast.api.elasticpath.com/oauth/access_token"
    );
    expect(opts.method).toBe("POST");
    expect(opts.body).toContain("grant_type=implicit");
    expect(opts.body).toContain("client_id=my-client-id");

    expect(result).toEqual({
      accessToken: "resolved-token-abc",
      expires: oauthResponse.expires,
      expiresIn: 3600,
      tokenType: "Bearer",
      clientId: "my-client-id",
      host: "https://useast.api.elasticpath.com",
    });
  });

  it("throws on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    await expect(
      resolveEpToken("bad-id", "https://useast.api.elasticpath.com")
    ).rejects.toThrow("network down");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });
    await expect(
      resolveEpToken("bad-id", "https://useast.api.elasticpath.com")
    ).rejects.toThrow();
  });
});
