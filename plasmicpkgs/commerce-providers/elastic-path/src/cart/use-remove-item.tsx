import { getACart, deleteACartItem } from "@epcc-sdk/sdks-shopper";
import type {
  HookFetcherContext,
  MutationHook,
  MutationHookContext,
} from "@plasmicpkgs/commerce";
import {
  UseRemoveItem,
  ValidationError,
  useRemoveItem,
} from "@plasmicpkgs/commerce";
import { useCallback } from "react";
import type { Cart, LineItem, RemoveItemHook } from "../types/cart";
import { getCartId, normalizeCart, removeCartCookie } from "../utils";
import useCart from "./use-cart";
import { handleAPIError } from "../utils/errorHandling";
import { getEPClient } from "../utils/getEPClient";
import { createLogger } from "../utils/logger";

const log = createLogger("useRemoveItem");

export type RemoveItemFn<T = any> = T extends LineItem
  ? (input?: RemoveItemActionInput<T>) => Promise<Cart | null | undefined>
  : (input: RemoveItemActionInput<T>) => Promise<Cart | null>;

export type RemoveItemActionInput<T = any> = T extends LineItem
  ? Partial<RemoveItemHook["actionInput"]>
  : RemoveItemHook["actionInput"];

/**
 * @deprecated Use `useRemoveItem` from `shopper-context/use-remove-item.ts` instead.
 * The new hook sends DELETE to `/api/cart/items/:id` via server routes with
 * httpOnly cookies, removing the need for client-side EP credentials.
 */
export default useRemoveItem as UseRemoveItem<typeof handler>;

export const handler: MutationHook<RemoveItemHook> = {
  fetchOptions: {
    url: "",
  },
  async fetcher({
    input: { itemId },
    options,
    fetch,
    provider,
  }: HookFetcherContext<RemoveItemHook>) {
    const cartId = getCartId();
    if (!itemId || !cartId) {
      return undefined;
    }

    try {
      await deleteACartItem({
        client: getEPClient(provider),
        path: {
          cartID: cartId,
          cartitemID: itemId,
        },
      });

      // Get updated cart with items
      const response = await getACart({
        client: getEPClient(provider),
        path: { cartID: cartId },
        query: {
          include: ["items"],
        },
      });

      if (response.data) {
        return normalizeCart(response.data, provider!.locale);
      } else {
        removeCartCookie();
        return undefined;
      }
    } catch (error) {
      const standardError = handleAPIError(error, "removing item from cart");
      log.error("Error removing item from cart", { error: standardError.message } as Record<string, unknown>);
      // If cart not found (404), clear cookie so next operation creates a fresh cart
      if ((error as Record<string, unknown>)?.status === 404) {
        removeCartCookie();
      }
      return undefined;
    }
  },
  useHook:
    ({ fetch }: MutationHookContext<RemoveItemHook>) =>
    <T extends LineItem | undefined = undefined>(ctx: { item?: T } = {}) => {
      const { item } = ctx;
      const { mutate } = useCart();
      const removeItem: RemoveItemFn<LineItem> = async (input) => {
        const itemId = input?.id ?? item?.id;

        if (!itemId) {
          throw new ValidationError({
            message: "Invalid input used for this operation",
          });
        }

        const data = await fetch({ input: { itemId } });
        await mutate(data, false);
        return data;
      };

      return useCallback(removeItem as RemoveItemFn<T>, [fetch, mutate]);
    },
};
