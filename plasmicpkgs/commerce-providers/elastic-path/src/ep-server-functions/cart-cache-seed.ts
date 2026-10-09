import type { Cart } from "../types/cart";
import { createLogger } from "../utils/logger";

const log = createLogger("EPCartCacheSeed");

type CartCacheSeed = (cart: Cart) => unknown;

// On globalThis, not in module scope: a page can hold two copies of this
// package (the app's `/server` and a loader bundle's root), and a write from
// either must reach the cache the rendered `useEpCart()` reads. Keyed by the
// cache, so a re-evaluated module replaces its seed instead of adding one.
const SEEDS_KEY = Symbol.for(
  "@elasticpath/plasmic-ep-commerce-elastic-path/cart-cache-seeds"
);

function cartCacheSeeds(): Map<object, CartCacheSeed> {
  const scope = globalThis as { [SEEDS_KEY]?: Map<object, CartCacheSeed> };
  let seeds = scope[SEEDS_KEY];
  if (!seeds) {
    seeds = new Map();
    scope[SEEDS_KEY] = seeds;
  }
  return seeds;
}

export function registerEpCartCacheSeed(
  cache: object,
  seed: CartCacheSeed
): void {
  cartCacheSeeds().set(cache, seed);
}

export async function seedEpCartCaches(cart: Cart): Promise<void> {
  if (typeof window === "undefined") return;
  const results = await Promise.allSettled(
    [...cartCacheSeeds().values()].map(async (seed) => seed(cart))
  );
  for (const result of results) {
    if (result.status === "rejected") {
      log.warn("A cart cache did not take the written cart", {
        error: result.reason,
      } as Record<string, unknown>);
    }
  }
}
