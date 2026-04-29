/**
 * Single shared cache key for the EP cart. SSR seed (`seedCartFallback`),
 * the SWR hook (`useEpCart`), and post-mutation revalidation in
 * `EPAddToCartButton` all key against this so they share one cache entry.
 *
 * The key is browser-session-scoped, not cartId-scoped — a Next request
 * has at most one active EP cart (resolved server-side from the
 * better-auth session cookie), so encoding the cartId would only fragment
 * the cache when a fresh cart replaces a previous one.
 */
export const EP_CART_CACHE_KEY = "ep-cart" as const;

export type EpCartCacheKey = typeof EP_CART_CACHE_KEY;

export function epCartCacheKey(): EpCartCacheKey {
  return EP_CART_CACHE_KEY;
}
