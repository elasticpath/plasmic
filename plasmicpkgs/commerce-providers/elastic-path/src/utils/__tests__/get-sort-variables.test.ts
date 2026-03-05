/**
 * Tests for getSortVariables utility.
 *
 * Why: This function maps user-facing sort options (price-asc, price-desc,
 * latest-desc) to EP API sort parameters. An incorrect mapping silently
 * returns wrong product ordering. Covers all switch branches including the
 * trending-desc default and undefined fallthrough.
 */

import getSortVariables from "../get-sort-variables";

describe("getSortVariables", () => {
  it("returns 'price asc' for price-asc", () => {
    expect(getSortVariables("price-asc")).toBe("price asc");
  });

  it("returns 'price desc' for price-desc", () => {
    expect(getSortVariables("price-desc")).toBe("price desc");
  });

  it("returns 'createdAt desc' for latest-desc", () => {
    expect(getSortVariables("latest-desc")).toBe("createdAt desc");
  });

  it("returns undefined for trending-desc (default option)", () => {
    expect(getSortVariables("trending-desc")).toBeUndefined();
  });

  it("returns undefined when sort is undefined", () => {
    expect(getSortVariables()).toBeUndefined();
  });

  it("returns undefined for unknown sort values", () => {
    expect(getSortVariables("relevance")).toBeUndefined();
  });

  it("ignores isCategory parameter (reserved for future use)", () => {
    expect(getSortVariables("price-asc", true)).toBe("price asc");
    expect(getSortVariables("price-asc", false)).toBe("price asc");
  });
});
