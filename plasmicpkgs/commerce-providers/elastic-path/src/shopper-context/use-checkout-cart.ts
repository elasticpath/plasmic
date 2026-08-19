import { useMemo } from "react";
import { useCart } from "./use-cart";
import type { CartData } from "./use-cart";

import { normalizeCart } from "../utils/normalize";
import type { Cart } from "../types/cart";

export interface UseCheckoutCartReturn {
  data: Cart | null;
  error: Error | null;
  isLoading: boolean;
  isEmpty: boolean;
  mutate: () => Promise<CartData | undefined>;
}

/**
 * The cart as the checkout components see it.
 *
 * This reads the cart-routes path (`GET /api/ep/cart`) rather than the proxy,
 * but produces the same Elastic Path cart the rest of the package publishes, so
 * a checkout summary and a cart drawer bind identically. The wire shape is a
 * projection — `{ items, meta }` — so it is rewrapped before normalizing.
 */
export function useCheckoutCart(): UseCheckoutCartReturn {
  const { data, error, isLoading, isEmpty, mutate } = useCart();

  const cart = useMemo<Cart | null>(() => {
    if (!data) return null;
    return normalizeCart({
      data: { id: "", type: "cart", meta: data.meta ?? undefined } as any,
      included: { items: (data.items ?? []) as any },
    });
  }, [data]);

  return { data: cart, error, isLoading, isEmpty, mutate };
}
