import { useCallback } from "react";
import { useShopperFetch } from "./useShopperFetch";
import { useCart } from "./use-cart";

/**
 * Returns a function to remove an item from the cart via DELETE /api/cart/items/{id}.
 * Auto-refetches cart data after successful removal.
 *
 * URL-encodes itemId to prevent path injection.
 */
export function useRemoveItem() {
  const shopperFetch = useShopperFetch();
  const { mutate } = useCart();

  return useCallback(
    async (itemId: string) => {
      await shopperFetch(
        `/api/cart/items/${encodeURIComponent(itemId)}`,
        { method: "DELETE" }
      );
      await mutate();
    },
    [shopperFetch, mutate]
  );
}
