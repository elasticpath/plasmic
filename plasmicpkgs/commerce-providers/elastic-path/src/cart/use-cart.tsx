import { createACart, getACart } from "@epcc-sdk/sdks-shopper";
import {
  SWRHook,
  UseCart,
  useCart as useCommerceCart,
} from "@plasmicpkgs/commerce";
import { useMemo } from "react";
import { GetCartHook } from "../types/cart";
import { normalizeCart } from "../utils";
import { getCartId, setCartId } from "../utils/cart-cookie";

export default useCommerceCart as UseCart<typeof handler>;

export const handler: SWRHook<GetCartHook> = {
  fetchOptions: {
    url: "",
  },
  async fetcher({ input, options, fetch, provider }) {
    const cartId = getCartId();
    let activeCart;

    try {
      if (cartId) {
        // Get existing cart with items included
        const response = await getACart({
          client: (provider as any)!.client!,
          path: { cartID: cartId },
          query: {
            include: ["items"],
          },
        });
        activeCart = response.data;

        if (activeCart) {
          // Items are included in the response
          return normalizeCart(activeCart, provider!.locale);
        }
      } else {
        // Create new cart
        const response = await createACart({
          client: (provider as any).client!,
          body: {
            data: {
              name: "Cart",
              description: "Shopping cart",
            },
          },
        });
        activeCart = response.data;
        if (activeCart && activeCart.data.id) {
          setCartId(activeCart.data.id);
          // New cart has no items
          return normalizeCart(activeCart, provider!.locale);
        }
      }
    } catch (error) {
      // If cart not found or error, clear cookie and create new cart
      console.error("Error getting cart:", error);
      return undefined;
    }

    return null;
  },
  useHook:
    ({ useData }) =>
    (input) => {
      const response = useData({
        swrOptions: { revalidateOnFocus: false, ...input?.swrOptions },
      });
      return useMemo(
        () =>
          Object.create(response, {
            isEmpty: {
              get() {
                return (response.data?.lineItems.length ?? 0) <= 0;
              },
              enumerable: true,
            },
          }),
        [response]
      );
    },
};
