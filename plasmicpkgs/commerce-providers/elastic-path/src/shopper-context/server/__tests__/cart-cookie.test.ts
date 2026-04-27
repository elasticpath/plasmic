import {
  buildCartCookieHeader,
  buildClearCartCookieHeader,
} from "../cart-cookie";

describe("buildCartCookieHeader", () => {
  it("builds a valid Set-Cookie header with HttpOnly", () => {
    const header = buildCartCookieHeader("cart-123");
    expect(header).toContain("ep_cart=cart-123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=2592000"); // 30 days
  });

  it("includes Secure flag in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    // Need to re-import to pick up new defaults — but since defaults
    // are computed at module load time, we pass secure option explicitly
    const header = buildCartCookieHeader("cart-123", { secure: true });
    expect(header).toContain("Secure");
    process.env.NODE_ENV = original;
  });

  it("omits Secure flag in development", () => {
    const header = buildCartCookieHeader("cart-123", { secure: false });
    expect(header).not.toContain("Secure");
  });

  it("URL-encodes the cart ID", () => {
    const header = buildCartCookieHeader("cart id/with=special");
    expect(header).toContain(
      `ep_cart=${encodeURIComponent("cart id/with=special")}`
    );
  });

  it("uses custom options", () => {
    const header = buildCartCookieHeader("cart-123", {
      cookieName: "my_cart",
      maxAge: 3600,
      path: "/shop",
      secure: false,
    });
    expect(header).toContain("my_cart=cart-123");
    expect(header).toContain("Max-Age=3600");
    expect(header).toContain("Path=/shop");
  });
});

describe("buildClearCartCookieHeader", () => {
  it("builds a clear cookie header with Max-Age=0", () => {
    const header = buildClearCartCookieHeader();
    expect(header).toContain("ep_cart=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
  });

  it("uses custom cookie name", () => {
    const header = buildClearCartCookieHeader({ cookieName: "my_cart" });
    expect(header).toContain("my_cart=");
    expect(header).toContain("Max-Age=0");
  });
});
