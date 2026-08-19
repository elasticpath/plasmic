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
/**
 * Whether the cart fetch has resolved, and how.
 *
 * A shopper with no cart resolves to `null`, which is a *loaded* state — only
 * `undefined` means SWR has not answered yet. Conflating the two is what left
 * an empty cart rendering "Loading cart…" indefinitely.
 */
export function cartLoadState(
  data: Cart | null | undefined,
  error: unknown
): "loading" | "error" | "ready" {
  if (error) return "error";
  return data === undefined ? "loading" : "ready";
}

export function useEpCart(): UseEpCartReturn {
  const { data, error, mutate } = useSWR<Cart | null>(
    epCartCacheKey(),
    () => callEpProxy<Cart | null>("getCart", {}, null),
    { revalidateOnFocus: false }
  );
  return {
    cart: data ?? null,
    isLoading: cartLoadState(data, error) === "loading",
    error: error ?? null,
    refresh: mutate as () => Promise<Cart | null | undefined>,
  };
}
