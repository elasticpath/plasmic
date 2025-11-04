import { createACart, getACart, manageCarts, BundleConfiguration } from "@epcc-sdk/sdks-shopper";
import type { MutationHook } from "@plasmicpkgs/commerce";
import { useAddItem, UseAddItem } from "@plasmicpkgs/commerce";
import { useCallback } from "react";
import type { AddItemHook } from "../types/cart";
import { getCartId, normalizeCart, setCartId } from "../utils";
import useCart from "./use-cart";
import { buildCartItemData, validateCartItem } from "./utils/cartDataBuilder";
import type { ExtendedCartItem } from "./utils/cartDataBuilder";
import { handleAPIError } from "../utils/errorHandling";

// Note: ExtendedCartItem is now imported from cartDataBuilder utils

export default useAddItem as UseAddItem<typeof handler>;

export const handler: MutationHook<AddItemHook> = {
  fetchOptions: {
    url: "",
  },
  async fetcher({ input: item, options, fetch, provider }) {
    // Cast item to our extended type
    const extendedItem = item as ExtendedCartItem;
    
    // Validate cart item using pure function
    const validation = validateCartItem(extendedItem);
    if (!validation.isValid) {
      console.error("Cart item validation failed:", validation.errorMessage);
      return undefined;
    }

    let cartId = getCartId();

    try {
      // Create cart if doesn't exist
      if (!cartId) {
        const response = await createACart({
          client: (provider as any)!.client!,
          body: {
            data: {
              name: "Cart",
              description: "Shopping cart",
            },
          },
        });
        if (response.data && response.data.data.id) {
          cartId = response.data.data.id;
          setCartId(cartId);
        }
      }

      if (!cartId) {
        return undefined;
      }

      // Build cart item data using pure function
      const cartData = buildCartItemData(extendedItem);

      await manageCarts({
        client: (provider as any)!.client!,
        path: { cartID: cartId },
        body: {
          data: cartData,
        },
      });

      // Get the updated cart
      const cartResponse = await getACart({
        client: (provider as any)!.client!,
        path: { cartID: cartId },
        query: {
          include: ["items"],
        },
      });

      return cartResponse.data
        ? normalizeCart(cartResponse.data)
        : undefined;
    } catch (error) {
      const standardError = handleAPIError(error, "adding item to cart");
      console.error("Error adding item to cart:", standardError);
      return undefined;
    }
  },
  useHook:
    ({ fetch }) =>
    () => {
      const { mutate } = useCart();
      return useCallback(
        async function addItem(input) {
          const data = await fetch({ input });
          await mutate(data, false);
          return data;
        },
        [fetch, mutate]
      );
    },
};
