import type { Cart } from "../types/cart";

type CartCacheSeed = (cart: Cart) => unknown;

// On globalThis, not in module scope: a page can hold two copies of this
// package (the app's `/server` and a loader bundle's root), and a write from
// either must reach the cache the rendered `useEpCart()` reads.
const SEEDS_KEY = Symbol.for(
  "@elasticpath/plasmic-ep-commerce-elastic-path/cart-cache-seeds"
);

function cartCacheSeeds(): Set<CartCacheSeed> {
  const scope = globalThis as { [SEEDS_KEY]?: Set<CartCacheSeed> };
  let seeds = scope[SEEDS_KEY];
  if (!seeds) {
    seeds = new Set();
    scope[SEEDS_KEY] = seeds;
  }
  return seeds;
}

export function registerEpCartCacheSeed(seed: CartCacheSeed): void {
  cartCacheSeeds().add(seed);
}

export async function seedEpCartCaches(cart: Cart): Promise<void> {
  if (typeof window === "undefined") return;
  await Promise.all([...cartCacheSeeds()].map((seed) => seed(cart)));
}
