import useSWR from "swr";
import type { Cart } from "../types/cart";
import { callEpProxy } from "../ep-server-functions/proxy-fetch";
import { epCartCacheKey } from "./cache-keys";

export interface UseEpCartReturn {
  cart: Cart | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<Cart | null | undefined>;
}

/**
 * Reads the current shopper's cart, hydrating from any SSR fallback
 * seeded by `seedCartFallback()` and revalidating via the EP proxy
 * route on the client. The single shared cache key (`epCartCacheKey()`)
 * lets `EPAddToCartButton` and any other surface invalidate the same
 * entry after a mutation.
 */
export function useEpCart(): UseEpCartReturn {
  const { data, error, mutate } = useSWR<Cart | null>(
    epCartCacheKey(),
    () => callEpProxy<Cart | null>("getCart", {}, null),
    { revalidateOnFocus: false }
  );
  return {
    cart: data ?? null,
    isLoading: !data && !error,
    error: error ?? null,
    refresh: mutate as () => Promise<Cart | null | undefined>,
  };
}
