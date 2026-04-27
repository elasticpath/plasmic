import {
  parseEpTokenCookie,
  buildEpTokenCookieHeader,
  isTokenExpired,
  parseEpAccountCookie,
  buildEpAccountCookieHeader,
  parseEpCartCookie,
  buildEpCartCookieHeader,
  EpTokenData,
  EpAccountData,
} from "../cookies";

const validTokenData: EpTokenData = {
  accessToken: "abc123-token",
  expires: Math.floor(Date.now() / 1000) + 3600,
  expiresIn: 3600,
  tokenType: "Bearer",
  clientId: "my-client-id",
  host: "https://useast.api.elasticpath.com",
};

describe("parseEpTokenCookie", () => {
  it("parses valid base64-encoded JSON", () => {
    const encoded = Buffer.from(JSON.stringify(validTokenData)).toString(
      "base64"
    );
    const result = parseEpTokenCookie(encoded);
    expect(result).toEqual(validTokenData);
  });

  it("returns null for empty string", () => {
    expect(parseEpTokenCookie("")).toBeNull();
  });

  it("returns null for invalid base64", () => {
    expect(parseEpTokenCookie("not!valid!base64!@#$")).toBeNull();
  });

  it("returns null for valid base64 but invalid JSON", () => {
    const encoded = Buffer.from("not json").toString("base64");
    expect(parseEpTokenCookie(encoded)).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const partial = Buffer.from(
      JSON.stringify({ accessToken: "abc" })
    ).toString("base64");
    expect(parseEpTokenCookie(partial)).toBeNull();
  });
});

describe("buildEpTokenCookieHeader", () => {
  it("produces a Set-Cookie string with correct attributes", () => {
    const header = buildEpTokenCookieHeader(validTokenData);
    expect(header).toContain("ep_token=");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=2592000");
  });

  it("includes Secure flag when secure option is true", () => {
    const header = buildEpTokenCookieHeader(validTokenData, { secure: true });
    expect(header).toContain("Secure");
  });

  it("omits Secure flag when secure option is false", () => {
    const header = buildEpTokenCookieHeader(validTokenData, { secure: false });
    expect(header).not.toContain("Secure");
  });

  it("round-trips losslessly through build then parse", () => {
    const header = buildEpTokenCookieHeader(validTokenData);
    const cookieValue = header.split("=").slice(1).join("=").split(";")[0];
    const parsed = parseEpTokenCookie(cookieValue);
    expect(parsed).toEqual(validTokenData);
  });
});

describe("isTokenExpired", () => {
  it("returns true when expires is in the past", () => {
    const expired: EpTokenData = {
      ...validTokenData,
      expires: Math.floor(Date.now() / 1000) - 60,
    };
    expect(isTokenExpired(expired)).toBe(true);
  });

  it("returns false when expires is in the future", () => {
    const valid: EpTokenData = {
      ...validTokenData,
      expires: Math.floor(Date.now() / 1000) + 3600,
    };
    expect(isTokenExpired(valid)).toBe(false);
  });

  it("returns true when expires is exactly now", () => {
    const borderline: EpTokenData = {
      ...validTokenData,
      expires: Math.floor(Date.now() / 1000),
    };
    expect(isTokenExpired(borderline)).toBe(true);
  });
});

const validAccountData: EpAccountData = {
  accountId: "acc-123",
  accountName: "Acme Corp",
  accountMemberId: "member-456",
  token: "account-token-xyz",
  expires: Math.floor(Date.now() / 1000) + 86400,
};

describe("parseEpAccountCookie", () => {
  it("parses valid base64-encoded JSON", () => {
    const encoded = Buffer.from(JSON.stringify(validAccountData)).toString(
      "base64"
    );
    expect(parseEpAccountCookie(encoded)).toEqual(validAccountData);
  });

  it("returns null for malformed input", () => {
    expect(parseEpAccountCookie("")).toBeNull();
    expect(parseEpAccountCookie("garbage")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const partial = Buffer.from(
      JSON.stringify({ accountId: "acc-123" })
    ).toString("base64");
    expect(parseEpAccountCookie(partial)).toBeNull();
  });
});

describe("buildEpAccountCookieHeader", () => {
  it("produces a Set-Cookie string with HttpOnly and dynamic Max-Age", () => {
    const header = buildEpAccountCookieHeader(validAccountData);
    expect(header).toContain("ep_account=");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toMatch(/Max-Age=\d+/);
  });

  it("round-trips losslessly", () => {
    const header = buildEpAccountCookieHeader(validAccountData);
    const cookieValue = header.split("=").slice(1).join("=").split(";")[0];
    expect(parseEpAccountCookie(cookieValue)).toEqual(validAccountData);
  });
});

describe("parseEpCartCookie", () => {
  it("returns the cart UUID string", () => {
    expect(parseEpCartCookie("cart-uuid-123")).toBe("cart-uuid-123");
  });

  it("returns null for empty string", () => {
    expect(parseEpCartCookie("")).toBeNull();
  });
});

describe("buildEpCartCookieHeader", () => {
  it("produces a Set-Cookie string with 30-day Max-Age", () => {
    const header = buildEpCartCookieHeader("cart-uuid-123");
    expect(header).toContain("ep_cart=cart-uuid-123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=2592000");
  });

  it("round-trips losslessly", () => {
    const header = buildEpCartCookieHeader("my-cart-id");
    const cookieValue = header.split("=")[1].split(";")[0];
    expect(parseEpCartCookie(cookieValue)).toBe("my-cart-id");
  });
});
