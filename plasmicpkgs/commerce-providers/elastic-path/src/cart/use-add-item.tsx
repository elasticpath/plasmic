import { createACart, getACart, manageCarts, BundleConfiguration } from "@epcc-sdk/sdks-shopper";
import type { MutationHook } from "@plasmicpkgs/commerce";
import { useAddItem, UseAddItem } from "@plasmicpkgs/commerce";
import { useCallback } from "react";
import type { AddItemHook } from "../types/cart";
import { getCartId, normalizeCart, setCartId } from "../utils";
import useCart from "./use-cart";

// Extend the item type to include bundle configuration
interface ExtendedCartItem {
  productId: string;
  variantId?: string;
  quantity?: number;
  bundleConfiguration?: BundleConfiguration;
}

export default useAddItem as UseAddItem<typeof handler>;

export const handler: MutationHook<AddItemHook> = {
  fetchOptions: {
    url: "",
  },
  async fetcher({ input: item, options, fetch, provider }) {
    // Cast item to our extended type
    const extendedItem = item as ExtendedCartItem;
    if (
      item.quantity &&
      (!Number.isInteger(item.quantity) || item.quantity! < 1)
    ) {
      return undefined;
    }

    // For products with variants, we need a variantId
    // For simple products without variants, we use the productId
    const cartItemId = item.variantId || item.productId;

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

      // Add item to cart using manageCarts
      // Use variantId if provided (for products with variants), otherwise use productId (for simple products)
      
      // The manageCarts SDK accepts bundle_configuration directly
      const cartData = {
        type: "cart_item" as const,
        id: cartItemId,
        quantity: item.quantity ?? 1,
        // Add bundle_configuration if provided in the item
        ...(extendedItem.bundleConfiguration && { bundle_configuration: extendedItem.bundleConfiguration }),
      };

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
      console.error("Error adding item to cart:", error);
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
