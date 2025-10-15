import { getACart, updateACartItem } from "@epcc-sdk/sdks-shopper";
import type { MutationHook, MutationHookContext } from "@plasmicpkgs/commerce";
import {
  UseUpdateItem,
  ValidationError,
  useUpdateItem,
} from "@plasmicpkgs/commerce";
import debounce from "debounce";
import { useCallback } from "react";
import type { LineItem, UpdateItemHook } from "../types/cart";
import { getCartId, normalizeCart, removeCartCookie } from "../utils";
import useCart from "./use-cart";
import { handler as removeItemHandler } from "./use-remove-item";

export type UpdateItemActionInput<T = any> = T extends LineItem
  ? Partial<UpdateItemHook["actionInput"]>
  : UpdateItemHook["actionInput"];

export default useUpdateItem as UseUpdateItem<typeof handler>;

export const handler: MutationHook<UpdateItemHook> = {
  fetchOptions: {
    url: "",
  },
  async fetcher({ input: { item, itemId }, options, fetch, provider }) {
    if (Number.isInteger(item.quantity)) {
      // Also allow the update hook to remove an item if the quantity is lower than 1
      if (item.quantity! < 1) {
        return removeItemHandler.fetcher?.({
          options: removeItemHandler.fetchOptions,
          input: { itemId },
          fetch,
          provider,
        });
      }
    } else if (item.quantity) {
      throw new ValidationError({
        message: "The item quantity has to be a valid integer",
      });
    }

    const cartId = getCartId();
    if (!cartId || !itemId || !item.quantity) {
      return undefined;
    }

    try {
      // Update cart item quantity
      // Update the item
      await updateACartItem({
        path: {
          cartID: cartId,
          cartitemID: itemId,
        },
        body: {
          data: {
            type: "cart_item",
            id: itemId,
            quantity: item.quantity,
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
        const items = response.data.included?.items || [];
        return normalizeCart(response.data, provider!.locale);
      } else {
        return undefined;
      }
    } catch (error) {
      console.error("Error updating cart item:", error);
      // If cart not found, clear cookie
      if ((error as any)?.status === 404) {
        removeCartCookie();
      }
      return undefined;
    }
  },
  useHook:
    ({ fetch }: MutationHookContext<UpdateItemHook>) =>
    <T extends LineItem | undefined = undefined>(
      ctx: {
        item?: T;
        wait?: number;
      } = {}
    ) => {
      const { item } = ctx;
      const { mutate } = useCart() as any;

      return useCallback(
        debounce(async (input: UpdateItemActionInput<T>) => {
          const itemId = input.id ?? item?.id;
          if (!itemId || input.quantity == null) {
            throw new ValidationError({
              message: "Invalid input used for this operation",
            });
          }

          const data = await fetch({
            input: {
              item: {
                quantity: input.quantity,
              },
              itemId,
            },
          });
          await mutate(data, false);
          return data;
        }, ctx.wait ?? 500),
        [fetch, mutate]
      );
    },
};
