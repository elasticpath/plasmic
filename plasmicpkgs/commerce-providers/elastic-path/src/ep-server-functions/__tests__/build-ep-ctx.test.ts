import { buildEpCtx } from "../build-ep-ctx";
import { isUsableAuth } from "../ep-client";

const HOST = "https://epcc-integration.global.ssl.fastly.net";

function sessionWith(
  overrides: Record<string, unknown> = {},
  cart: { id: string } | null = null
) {
  return {
    session: {
      accessToken: "tok-abc",
      expires: 1786630149,
      clientId: "cid-abc",
      host: HOST,
      account: null,
      lapsedAccount: null,
      ...overrides,
    },
    cart,
  };
}

describe("buildEpCtx", () => {
  it("carries the host and client id the session was minted against", () => {
    expect(buildEpCtx(sessionWith(), { locale: "en-GB" })).toEqual({
      accessToken: "tok-abc",
      host: HOST,
      clientId: "cid-abc",
      cartId: undefined,
      accountId: undefined,
      accountToken: undefined,
      locale: "en-GB",
      currency: undefined,
    });
  });

  it("carries the session cart", () => {
    expect(buildEpCtx(sessionWith({}, { id: "cart-1" })).cartId).toBe("cart-1");
  });

  it("carries the selected organisation's id and credential", () => {
    const ctx = buildEpCtx(
      sessionWith({
        account: {
          id: "acct-1",
          name: "Acme Industrial",
          token: "account-management-token",
          expires: 1786630149,
        },
      })
    );

    expect(ctx.accountId).toBe("acct-1");
    expect(ctx.accountToken).toBe("account-management-token");
  });

  it("carries no account credential when no organisation is selected", () => {
    const ctx = buildEpCtx(sessionWith());

    expect(ctx.accountId).toBeUndefined();
    expect(ctx.accountToken).toBeUndefined();
  });

  it("yields a context the server functions refuse when the session is empty", () => {
    const ctx = buildEpCtx({ session: null, cart: null });

    expect(ctx).toEqual(
      expect.objectContaining({ accessToken: "", host: "", clientId: "" })
    );
    expect(isUsableAuth(ctx)).toBe(false);
  });
});
