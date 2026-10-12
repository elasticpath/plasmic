import type { Cart } from "../types/cart";
import { createLogger } from "../utils/logger";

const log = createLogger("EPCartCacheRegistry");

export interface EpCartCache {
  show(cart: Cart): unknown;
  refetch(): unknown;
}

interface CartCacheRegistry {
  caches: Map<object, EpCartCache>;
  lastTicket: number;
  newestApplied: number;
  inFlight: number;
  refetchDue: boolean;
}

// On globalThis, not in module scope: a page can hold two copies of this
// package (the app's `/server` and a loader bundle's root), and a write from
// either must reach, and be ordered against, the cache the rendered
// `useEpCart()` reads. Keyed by the cache, so a re-evaluated module replaces
// its entry instead of adding one.
const REGISTRY_KEY = Symbol.for(
  "@elasticpath/plasmic-ep-commerce-elastic-path/cart-cache-registry"
);

function cartCacheRegistry(): CartCacheRegistry {
  const scope = globalThis as { [REGISTRY_KEY]?: CartCacheRegistry };
  let registry = scope[REGISTRY_KEY];
  if (!registry) {
    registry = {
      caches: new Map(),
      lastTicket: 0,
      newestApplied: 0,
      inFlight: 0,
      refetchDue: false,
    };
    scope[REGISTRY_KEY] = registry;
  }
  return registry;
}

export function registerEpCartCache(cache: object, entry: EpCartCache): void {
  cartCacheRegistry().caches.set(cache, entry);
}

async function eachCache(
  registry: CartCacheRegistry,
  call: (cache: EpCartCache) => unknown,
  failure: string
): Promise<void> {
  const results = await Promise.allSettled(
    [...registry.caches.values()].map(async (cache) => call(cache))
  );
  for (const result of results) {
    if (result.status === "rejected") {
      log.warn(failure, { error: result.reason } as Record<string, unknown>);
    }
  }
}

/**
 * Runs a browser cart write and puts its cart in every registered cache, unless
 * a write sent after it has already done so. Elastic Path may apply
 * overlapping writes in a different order from the one they were sent in, so
 * once the last of them finishes, every cache reads the cart again. With
 * `refetchOnFailure`, a failed write also has the caches read the cart once the
 * last write finishes.
 */
export async function sequenceEpCartWrite(
  write: () => Promise<Cart>,
  { refetchOnFailure = false }: { refetchOnFailure?: boolean } = {}
): Promise<Cart> {
  if (typeof window === "undefined") return write();
  const registry = cartCacheRegistry();
  const ticket = ++registry.lastTicket;
  registry.inFlight += 1;
  if (registry.inFlight > 1) registry.refetchDue = true;
  let cart: Cart;
  try {
    cart = await write();
  } catch (err) {
    if (refetchOnFailure) registry.refetchDue = true;
    finishWrite(registry);
    throw err;
  }
  let shown: Promise<void> | undefined;
  if (ticket > registry.newestApplied) {
    registry.newestApplied = ticket;
    shown = eachCache(
      registry,
      (cache) => cache.show(cart),
      "A cart cache did not show the written cart"
    );
  }
  // The caches already hold this cart, so a refetch cannot be overtaken by it,
  // and a write sent while they settle does not overlap this one.
  finishWrite(registry);
  await shown;
  return cart;
}

function finishWrite(registry: CartCacheRegistry): void {
  registry.inFlight -= 1;
  if (registry.inFlight === 0 && registry.refetchDue) {
    registry.refetchDue = false;
    void eachCache(
      registry,
      (cache) => cache.refetch(),
      "A cart cache did not read the cart again"
    );
  }
}
