import { createACart, getACart } from "@epcc-sdk/sdks-shopper";
import {
  SWRHook,
  UseCart,
  useCart as useCommerceCart,
} from "@plasmicpkgs/commerce";
import { useMemo } from "react";
import { GetCartHook } from "../types/cart";
import { normalizeCart } from "../utils";
import {
  getCartIdFromSession,
  setCartIdInSession,
} from "./cart-session";
import { handleAPIError } from "../utils/errorHandling";
import { getEPClient } from "../utils/getEPClient";
import { createLogger } from "../utils/logger";

const log = createLogger("useCart");

/**
 * @deprecated Use `useCart` from `shopper-context/use-cart.ts` instead.
 * The new hook fetches cart data via server routes (`/api/cart`) with httpOnly
 * cookies, removing the need for client-side EP credentials.
 */
export default useCommerceCart as UseCart<typeof handler>;

export const handler: SWRHook<GetCartHook> = {
  fetchOptions: {
    url: "",
  },
  async fetcher({ input, options, fetch, provider }) {
    const cartId = await getCartIdFromSession();
    let activeCart;

    try {
      if (cartId) {
        // Get existing cart with items included
        const response = await getACart({
          client: getEPClient(provider),
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
          client: getEPClient(provider),
          body: {
            data: {
              name: "Cart",
              description: "Shopping cart",
            },
          },
        });
        activeCart = response.data;
        if (activeCart && activeCart.data.id) {
          await setCartIdInSession(activeCart.data.id);
          // New cart has no items
          return normalizeCart(activeCart, provider!.locale);
        }
      }
    } catch (error) {
      // If cart not found or error, clear cookie and create new cart
      const standardError = handleAPIError(error, "getting cart");
      log.error("Error getting cart", { error: standardError.message } as Record<string, unknown>);
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
