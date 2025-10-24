import { getACart, updateACartItem } from "@epcc-sdk/sdks-shopper";
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

export type RemoveItemFn<T = any> = T extends LineItem
  ? (input?: RemoveItemActionInput<T>) => Promise<Cart | null | undefined>
  : (input: RemoveItemActionInput<T>) => Promise<Cart | null>;

export type RemoveItemActionInput<T = any> = T extends LineItem
  ? Partial<RemoveItemHook["actionInput"]>
  : RemoveItemHook["actionInput"];

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
      // Remove item by setting quantity to 0 (as per Elastic Path docs)
      // This approach is more reliable than deleteACartItem
      await updateACartItem({
        path: {
          cartID: cartId,
          cartitemID: itemId,
        },
        body: {
          data: {
            type: "cart_item",
            id: itemId,
            quantity: 0,
          },
        },
      });

      // Get updated cart with items
      const response = await getACart({
        client: (provider as any)!.client!,
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
      console.error("Error removing item from cart:", error);
      // If cart not found, clear cookie
      if ((error as any)?.status === 404) {
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
