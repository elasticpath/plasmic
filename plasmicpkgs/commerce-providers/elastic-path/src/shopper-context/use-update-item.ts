import { useCallback, useRef } from "react";
import { useShopperFetch } from "./useShopperFetch";
import { useShopperContext } from "./useShopperContext";
import { useCart } from "./use-cart";
import { DEFAULT_DEBOUNCE_MS } from "../const";

/**
 * Returns a function to update item quantity via PUT /api/cart/items/{id}.
 * Debounced at DEFAULT_DEBOUNCE_MS (500ms) to handle rapid +/- clicks.
 *
 * Quantity 0 = remove (server handles this).
 */
export function useUpdateItem() {
  const shopperFetch = useShopperFetch();
  const { basePath = "/api/ep" } = useShopperContext();
  const { mutate } = useCart();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  return useCallback(
    (itemId: string, quantity: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(async () => {
        await shopperFetch(
          `${basePath}/cart/items/${encodeURIComponent(itemId)}`,
          {
            method: "PUT",
            body: JSON.stringify({ quantity }),
          }
        );
        await mutate();
      }, DEFAULT_DEBOUNCE_MS);
    },
    [shopperFetch, mutate]
  );
}
