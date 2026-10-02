import type { Cart } from "../types/cart";
import { epGetCart } from "../ep-server-functions";
import { epCartCacheKey } from "./cache-keys";

/**
 * Server-only helper that primes the SWR cache for `useEpCart()`. Mount
 * the result as `<SWRConfig fallback={...}>` in a Next.js root layout so
 * the first paint of any descendant `EPCartProvider` already has the
 * shopper's cart — no zero-flicker before client revalidation completes.
 *
 * Must be called inside a `withEpSession` scope (the session-aware
 * version of `epGetCart`). Never throws — a failure to reach EP returns
 * the anonymous-key empty fallback so SSR continues to render.
 */
export async function seedCartFallback(): Promise<Record<string, Cart | null>> {
  let cart: Cart | null = null;
  try {
    cart = (await epGetCart()) ?? null;
  } catch {
    cart = null;
  }
  // Node loads swr, not the bundler: swr 1.x calls createContext at load,
  // which React's react-server build lacks. Native ESM has no require().
  const { unstable_serialize } = await import(/* webpackIgnore: true */ "swr");
  const key = unstable_serialize(epCartCacheKey());
  return { [key]: cart };
}
