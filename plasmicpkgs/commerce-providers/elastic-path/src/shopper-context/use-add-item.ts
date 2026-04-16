import { useCallback } from "react";
import { useShopperFetch } from "./useShopperFetch";
import { useShopperContext } from "./useShopperContext";
import { useCart } from "./use-cart";

export interface AddItemInput {
  productId: string;
  variantId?: string;
  quantity?: number;
  bundleConfiguration?: unknown;
  locationId?: string;
  selectedOptions?: {
    variationId: string;
    optionId: string;
    optionName: string;
    variationName: string;
  }[];
}

/**
 * Returns a function to add an item to the cart via POST /api/cart/items.
 * Auto-refetches cart data after successful add.
 *
 * Consumer app must implement POST /api/cart/items that:
 * - Resolves cartId from header/cookie via resolveCartId()
 * - Auto-creates cart if none exists
 * - Adds item to EP cart
 * - Sets httpOnly cookie via buildCartCookieHeader()
 */
export function useAddItem() {
  const shopperFetch = useShopperFetch();
  const { basePath = "/api/ep" } = useShopperContext();
  const { mutate } = useCart();

  return useCallback(
    async (item: AddItemInput) => {
      const result = await shopperFetch(`${basePath}/cart/items`, {
        method: "POST",
        body: JSON.stringify(item),
      });
      await mutate();
      return result;
    },
    [shopperFetch, mutate]
  );
}
