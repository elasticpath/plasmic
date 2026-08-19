import { formatPrice } from "../price";

const price = {
  amount: 17900,
  currency: "USD",
  float_price: 179,
  formatted: "US$179.00",
};

describe("formatPrice", () => {
  it("renders what Commerce Manager configured by default", () => {
    expect(formatPrice(price)).toBe("US$179.00");
  });

  it("falls back to Intl when Elastic Path sent no formatted string", () => {
    expect(formatPrice({ ...price, formatted: undefined as any })).toBe(
      "$179.00"
    );
  });

  it("re-formats through Intl when the designer asked for a symbol or code", () => {
    expect(formatPrice(price, "symbol")).toBe("$179.00");
    // Intl separates the code with a non-breaking space.
    expect(formatPrice(price, "code").replace(/\u00a0/g, " ")).toBe(
      "USD 179.00"
    );
  });

  it("formats with the given locale rather than the host's default", () => {
    expect(formatPrice(price, "symbol", "de-DE")).toContain("179,00");
  });

  it("renders a zero-decimal currency without inventing decimals", () => {
    expect(
      formatPrice(
        { amount: 5000, currency: "JPY", float_price: 5000, formatted: "" },
        "symbol"
      )
    ).toBe("¥5,000");
  });
});
