/**
 * Tests for the shared formatCurrency utility.
 *
 * Why: formatCurrency was duplicated in 5+ files with inconsistent fallbacks
 * (some used '$' prefix, others used currency code prefix; some divided by 100,
 * others didn't). Centralizing into a single utility with two entry points
 * (formatCurrency for display-unit amounts, formatCurrencyFromCents for
 * cent-based amounts) eliminates the divergence and makes the fallback behavior
 * explicit and testable.
 */

describe("formatCurrency", () => {
  let formatCurrency: typeof import("../formatCurrency").formatCurrency;

  beforeEach(() => {
    jest.resetModules();
    ({ formatCurrency } = require("../formatCurrency"));
  });

  it("formats a USD amount using Intl.NumberFormat", () => {
    const result = formatCurrency(29.99, "USD");
    // Intl.NumberFormat output varies by locale — just verify it contains the amount
    expect(result).toContain("29.99");
  });

  it("formats a GBP amount", () => {
    const result = formatCurrency(10.5, "GBP");
    expect(result).toContain("10.50");
  });

  it("formats zero", () => {
    const result = formatCurrency(0, "USD");
    expect(result).toContain("0.00");
  });

  it("defaults to USD when no currency code is provided", () => {
    const result = formatCurrency(5);
    expect(result).toContain("5.00");
  });

  it("falls back to $<amount> for invalid currency codes", () => {
    const result = formatCurrency(42.5, "INVALID");
    expect(result).toBe("$42.50");
  });

  it("formats negative amounts", () => {
    const result = formatCurrency(-15.99, "USD");
    expect(result).toContain("15.99");
  });

  it("renders the ISO code prefix with display 'code'", () => {
    const result = formatCurrency(179, "USD", "code");
    expect(result).toContain("USD");
    expect(result).toContain("179");
    expect(result).not.toContain("$");
  });

  it("keeps the symbol by default and for display 'symbol'", () => {
    expect(formatCurrency(179, "USD")).toContain("$");
    expect(formatCurrency(179, "USD", "symbol")).toContain("$");
  });

  it("falls back to a code prefix for an invalid currency with display 'code'", () => {
    expect(formatCurrency(42.5, "INVALID", "code")).toBe("INVALID 42.50");
  });
});

describe("formatCurrencyFromCents", () => {
  let formatCurrencyFromCents: typeof import("../formatCurrency").formatCurrencyFromCents;

  beforeEach(() => {
    jest.resetModules();
    ({ formatCurrencyFromCents } = require("../formatCurrency"));
  });

  it("divides by 100 and formats as currency", () => {
    const result = formatCurrencyFromCents(2999, "USD");
    expect(result).toContain("29.99");
  });

  it("formats zero cents", () => {
    const result = formatCurrencyFromCents(0, "USD");
    expect(result).toContain("0.00");
  });

  it("handles amounts not evenly divisible by 100", () => {
    const result = formatCurrencyFromCents(1, "USD");
    expect(result).toContain("0.01");
  });

  it("uppercases the currency code", () => {
    const result = formatCurrencyFromCents(500, "usd");
    expect(result).toContain("5.00");
  });

  it("defaults to USD when no currency code is provided", () => {
    const result = formatCurrencyFromCents(1000);
    expect(result).toContain("10.00");
  });

  it("falls back to CODE <amount> for invalid currency codes", () => {
    const result = formatCurrencyFromCents(4250, "INVALID");
    expect(result).toBe("INVALID 42.50");
  });

  it("uses en-US locale for consistent checkout display", () => {
    // en-US formats USD with a dollar sign and comma grouping
    const result = formatCurrencyFromCents(123456, "USD");
    // Should contain comma-separated thousands: 1,234.56
    expect(result).toContain("1,234.56");
  });
});
