import { epCartCacheKey, EP_CART_CACHE_KEY } from "../cache-keys";

describe("epCartCacheKey", () => {
  it("returns the single shared cart cache key", () => {
    expect(epCartCacheKey()).toBe(EP_CART_CACHE_KEY);
  });

  it("is stable across calls (so SWR cache lookups deduplicate)", () => {
    expect(epCartCacheKey()).toBe(epCartCacheKey());
  });

  it("exports the literal value for direct comparison in fallback maps", () => {
    expect(EP_CART_CACHE_KEY).toBe("ep-cart");
  });
});
