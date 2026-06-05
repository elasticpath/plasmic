import { deriveCartData, DerivableCart } from "../cart-data";

const CART: DerivableCart = {
  id: "cart-1",
  lineItems: [
    { id: "li-1", quantity: 2 },
    { id: "li-2", quantity: 1 },
  ],
  subtotalPrice: 179,
  totalPrice: 179,
  currency: { code: "USD" },
};

describe("deriveCartData", () => {
  it("returns null for a null/undefined cart", () => {
    expect(deriveCartData(null)).toBeNull();
    expect(deriveCartData(undefined)).toBeNull();
  });

  it("sums itemCount from line-item quantities and flags non-empty", () => {
    const data = deriveCartData(CART)!;
    expect(data.itemCount).toBe(3);
    expect(data.isEmpty).toBe(false);
  });

  it("flags an empty cart", () => {
    const data = deriveCartData({ ...CART, lineItems: [] })!;
    expect(data.isEmpty).toBe(true);
    expect(data.itemCount).toBe(0);
  });

  it("propagates the currency code, defaulting when absent", () => {
    expect(deriveCartData(CART)!.currencyCode).toBe("USD");
    expect(
      deriveCartData({ ...CART, currency: undefined })!.currencyCode
    ).toBe("USD"); // DEFAULT_CURRENCY_CODE
  });

  it("formats subtotal/total with the symbol display by default", () => {
    const data = deriveCartData(CART)!;
    expect(data.currencyDisplay).toBe("symbol");
    expect(data.formattedSubtotal).toContain("179");
    expect(data.formattedSubtotal).toContain("$");
  });

  it("honours currencyDisplay 'code' on subtotal and total", () => {
    const data = deriveCartData(CART, { currencyDisplay: "code" })!;
    expect(data.currencyDisplay).toBe("code");
    expect(data.formattedSubtotal).toContain("USD");
    expect(data.formattedSubtotal).not.toContain("$");
    expect(data.formattedTotal).toContain("USD");
  });
});
