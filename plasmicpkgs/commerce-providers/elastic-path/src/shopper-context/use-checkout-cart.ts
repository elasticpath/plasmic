import { useEpCart } from "../cart-provider/use-ep-cart";
import type { Cart } from "../types/cart";

export interface UseCheckoutCartReturn {
  data: Cart | null;
  error: Error | null;
  isLoading: boolean;
  isEmpty: boolean;
  mutate: () => Promise<Cart | null | undefined>;
}

/**
 * The cart as the checkout components see it. One read with `useEpCart`, so a
 * checkout summary and a cart drawer share a cache entry and cannot disagree.
 */
export function useCheckoutCart(): UseCheckoutCartReturn {
  const { cart, isLoading, error, refresh } = useEpCart();
  return {
    data: cart,
    error,
    isLoading,
    isEmpty: !cart || !cart.items || cart.items.length === 0,
    mutate: refresh,
  };
}
