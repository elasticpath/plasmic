import {
  assignReturnTo,
  isSameSiteRedirect,
  readLocationSearch,
  readRedirectQuery,
  resolveReturnTo,
} from "../return-to";

describe("isSameSiteRedirect", () => {
  it.each([
    "/",
    "/account",
    "/account?welcome=1",
    "/account#orders",
    "/account?welcome=1#orders",
    "/account/../checkout",
  ])("accepts %s", (value) => {
    expect(isSameSiteRedirect(value)).toBe(true);
  });

  it.each([
    "",
    "//host",
    "//host/path",
    "/\\host",
    "/\\\\host",
    "/account\\extra",
    "https://shop.example/account",
    "https:",
    "HTTPS://shop.example/account",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "/account\n",
    "/account\tcheckout",
    "/account\u0000",
    "/account\u007F",
    " /account",
  ])("rejects %s", (value) => {
    expect(isSameSiteRedirect(value)).toBe(false);
  });

  it("does not reject a path only because it has trailing whitespace", () => {
    expect(isSameSiteRedirect("/account ")).toBe(true);
  });
});

describe("readRedirectQuery", () => {
  it("returns the decoded value once", () => {
    expect(readRedirectQuery("?redirect=%2Fcheckout")).toBe("/checkout");
    expect(readRedirectQuery("?redirect=%2Faccount%3Fwelcome%3D1")).toBe(
      "/account?welcome=1"
    );
  });

  it("does not decode a second time", () => {
    expect(readRedirectQuery("?redirect=%252Fcheckout")).toBe("%2Fcheckout");
  });

  it("returns null when redirect is missing or empty", () => {
    expect(readRedirectQuery("")).toBeNull();
    expect(readRedirectQuery("?welcome=1")).toBeNull();
    expect(readRedirectQuery("?redirect=")).toBeNull();
  });

  it("uses the first redirect value", () => {
    expect(readRedirectQuery("?redirect=/checkout&redirect=/account")).toBe(
      "/checkout"
    );
  });
});

describe("resolveReturnTo", () => {
  it("prefers a valid query redirect over the configured path", () => {
    expect(
      resolveReturnTo({
        search: "?redirect=/checkout",
        configured: "/account",
      })
    ).toBe("/checkout");
  });

  it("uses a decoded query redirect", () => {
    expect(
      resolveReturnTo({
        search: "?redirect=%2Fcheckout",
        configured: "/account",
      })
    ).toBe("/checkout");
  });

  it("falls back to a valid configured path when the query is unsafe", () => {
    expect(
      resolveReturnTo({
        search: "?redirect=//host",
        configured: "/account",
      })
    ).toBe("/account");
    expect(
      resolveReturnTo({
        search: "?redirect=%2F%2Fhost",
        configured: "/account",
      })
    ).toBe("/account");
    expect(
      resolveReturnTo({
        search: "?redirect=%252Fcheckout",
        configured: "/account",
      })
    ).toBe("/account");
  });

  it("returns null when the query and the configured path are both invalid", () => {
    expect(
      resolveReturnTo({
        search: "?redirect=javascript:alert(1)",
        configured: "https://shop.example/account",
      })
    ).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(resolveReturnTo({ search: "" })).toBeNull();
    expect(resolveReturnTo({ search: "?welcome=1", configured: "" })).toBeNull();
    expect(resolveReturnTo({ search: null })).toBeNull();
  });

  it("uses the configured path when there is no browser location", () => {
    expect(
      resolveReturnTo({ search: null, configured: "/account?welcome=1" })
    ).toBe("/account?welcome=1");
  });

  it("keeps a fragment and a normalized relative path as authored", () => {
    expect(
      resolveReturnTo({ search: null, configured: "/account#orders" })
    ).toBe("/account#orders");
    expect(
      resolveReturnTo({ search: null, configured: "/account/../checkout" })
    ).toBe("/account/../checkout");
    expect(resolveReturnTo({ search: null, configured: "/" })).toBe("/");
  });
});

describe("browser location", () => {
  const previous = (global as { window?: unknown }).window;

  afterEach(() => {
    if (previous === undefined) {
      delete (global as { window?: unknown }).window;
    } else {
      (global as { window?: unknown }).window = previous;
    }
  });

  it("reads no search and does not navigate when window is missing", () => {
    delete (global as { window?: unknown }).window;
    expect(readLocationSearch()).toBeNull();
    expect(() => assignReturnTo("/account")).not.toThrow();
  });

  it("reads search and assigns when a location exists", () => {
    const assign = jest.fn();
    (global as { window?: unknown }).window = {
      location: { search: "?redirect=%2Fcheckout", assign },
    };
    expect(readLocationSearch()).toBe("?redirect=%2Fcheckout");
    assignReturnTo("/checkout");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/checkout");
  });
});
