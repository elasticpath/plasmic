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
import { getEPClient } from "../utils/getEPClient";
import { createLogger } from "../utils/logger";

const log = createLogger("useAddItem");

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
      log.error("Cart item validation failed", { errorMessage: validation.errorMessage } as Record<string, unknown>);
      return undefined;
    }

    let cartId = getCartId();

    try {
      // Create cart if doesn't exist
      if (!cartId) {
        const response = await createACart({
          client: getEPClient(provider),
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
        client: getEPClient(provider),
        path: { cartID: cartId },
        body: {
          data: cartData,
        },
      });

      // Get the updated cart
      const cartResponse = await getACart({
        client: getEPClient(provider),
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
      log.error("Error adding item to cart", { error: standardError.message } as Record<string, unknown>);
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
