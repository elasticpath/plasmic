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
import { handleAPIError } from "../utils/errorHandling";
import { getEPClient } from "../utils/getEPClient";
import { createLogger } from "../utils/logger";

const log = createLogger("useUpdateItem");

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
      // Build update data — include location if present so EP validates
      // stock against the correct inventory pool
      const updateData: Record<string, any> = {
        id: itemId,
        quantity: item.quantity,
      };
      if ((item as any).location) {
        updateData.location = (item as any).location;
      }

      await updateACartItem({
        client: getEPClient(provider),
        path: {
          cartID: cartId,
          cartitemID: itemId,
        },
        body: {
          data: updateData,
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
        const items = response.data.included?.items || [];
        return normalizeCart(response.data, provider!.locale);
      } else {
        return undefined;
      }
    } catch (error) {
      const standardError = handleAPIError(error, "updating cart item");
      log.error("Error updating cart item", { error: standardError.message } as Record<string, unknown>);
      // If cart not found (404), clear cookie so next operation creates a fresh cart
      if ((error as Record<string, unknown>)?.status === 404) {
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
                ...((input as any).location && {
                  location: (input as any).location,
                }),
              } as any,
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
