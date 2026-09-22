import { sessionCookiesAreSecure } from "../ep-plugin/ep-plugin";

// better-auth records its secure-cookie decision in the cookie names it puts
// on ctx.context.authCookies; that is what a real endpoint context carries.
function ctxWithCookieName(name: string) {
  return { context: { authCookies: { sessionData: { name } } } };
}

describe("sessionCookiesAreSecure", () => {
  it("follows the __Secure- prefix better-auth put on the session_data cookie", () => {
    expect(
      sessionCookiesAreSecure(ctxWithCookieName("__Secure-better-auth.session_data"))
    ).toBe(true);
    expect(
      sessionCookiesAreSecure(ctxWithCookieName("better-auth.session_data"))
    ).toBe(false);
  });

  it("prefers the cookie name over the options when both are present", () => {
    expect(
      sessionCookiesAreSecure({
        context: {
          authCookies: { sessionData: { name: "better-auth.session_data" } },
          options: { advanced: { useSecureCookies: true } },
          baseURL: "https://shop.example",
        },
      })
    ).toBe(false);
  });

  it("falls back to advanced.useSecureCookies when there are no cookie names", () => {
    expect(
      sessionCookiesAreSecure({
        context: { options: { advanced: { useSecureCookies: false } }, baseURL: "https://shop.example" },
      })
    ).toBe(false);
    expect(
      sessionCookiesAreSecure({
        context: { options: { advanced: { useSecureCookies: true } }, baseURL: "http://localhost:3000" },
      })
    ).toBe(true);
  });

  it("falls back to the baseURL scheme, as better-auth does", () => {
    expect(sessionCookiesAreSecure({ context: { baseURL: "https://shop.example" } })).toBe(true);
    expect(sessionCookiesAreSecure({ context: { options: { baseURL: "https://shop.example" } } })).toBe(true);
    expect(sessionCookiesAreSecure({ context: { baseURL: "http://localhost:3000" } })).toBe(false);
  });

  it("is false for a context with none of the above", () => {
    expect(sessionCookiesAreSecure({})).toBe(false);
    expect(sessionCookiesAreSecure(undefined)).toBe(false);
  });
});
