import { parseShopperHeader, resolveCartId } from "../resolve-cart-id";

describe("parseShopperHeader", () => {
  it("parses valid JSON header", () => {
    const result = parseShopperHeader({
      "x-shopper-context": JSON.stringify({ cartId: "cart-123" }),
    });
    expect(result.cartId).toBe("cart-123");
  });

  it("returns {} when header is missing", () => {
    const result = parseShopperHeader({});
    expect(result).toEqual({});
  });

  it("returns {} when header is malformed JSON", () => {
    const result = parseShopperHeader({
      "x-shopper-context": "not-json{",
    });
    expect(result).toEqual({});
  });

  it("returns {} when header is an array (multi-value)", () => {
    const result = parseShopperHeader({
      "x-shopper-context": ["a", "b"],
    });
    expect(result).toEqual({});
  });

  it("returns {} when header is undefined", () => {
    const result = parseShopperHeader({
      "x-shopper-context": undefined,
    });
    expect(result).toEqual({});
  });
});

describe("resolveCartId", () => {
  it("returns header cartId when present (highest priority)", () => {
    const result = resolveCartId(
      { "x-shopper-context": JSON.stringify({ cartId: "header-cart" }) },
      { ep_cart: "cookie-cart" }
    );
    expect(result).toBe("header-cart");
  });

  it("returns cookie cartId when header has no cartId", () => {
    const result = resolveCartId(
      { "x-shopper-context": JSON.stringify({ accountId: "acct-1" }) },
      { ep_cart: "cookie-cart" }
    );
    expect(result).toBe("cookie-cart");
  });

  it("returns cookie cartId when header is missing", () => {
    const result = resolveCartId({}, { ep_cart: "cookie-cart" });
    expect(result).toBe("cookie-cart");
  });

  it("returns null when neither header nor cookie has cartId", () => {
    const result = resolveCartId({}, {});
    expect(result).toBeNull();
  });

  it("uses custom cookie name", () => {
    const result = resolveCartId({}, { my_cart: "custom-cookie" }, "my_cart");
    expect(result).toBe("custom-cookie");
  });

  it("returns null when cookie is undefined", () => {
    const result = resolveCartId({}, { ep_cart: undefined });
    expect(result).toBeNull();
  });
});
