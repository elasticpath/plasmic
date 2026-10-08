import { mutate } from "swr";
import { cartMutationErrorCopy } from "../ep-server-functions/cart-mutation-error-copy";
import * as writes from "../ep-server-functions/cart-mutations";
import type {
  EpAddCartItemInput,
  EpRemoveCartItemInput,
  EpUpdateCartItemInput,
} from "../ep-server-functions/cart-mutations";
import { epProxyErrorCode } from "../ep-server-functions/proxy-fetch";
import type { Cart } from "../types/cart";
import { epCartCacheKey } from "./cache-keys";

const BARE_CODE = /^[a-z]+(?:_[a-z]+)*$/;

async function write<I>(
  fn: (input: I) => Promise<Cart>,
  input: I,
  fallback: string
): Promise<Cart> {
  let cart: Cart;
  try {
    cart = await fn(input);
  } catch (err) {
    if (err instanceof Error && epProxyErrorCode(err) && BARE_CODE.test(err.message)) {
      err.message = cartMutationErrorCopy(err, fallback);
    }
    throw err;
  }
  if (typeof window !== "undefined") {
    await mutate(epCartCacheKey(), cart, false);
  }
  return cart;
}

/**
 * Adds an item to the shopper's cart and resolves with the updated cart. In
 * the browser it calls the storefront's proxy route, then every `useEpCart()`
 * consumer shows the new cart.
 *
 * Rejects with an `Error` whose `message` is readable and whose `code`, when
 * the proxy route sent one, is stable to branch on (`insufficient_stock`,
 * `no_session`, `dispatch_failed`).
 */
export function epAddCartItem(input: EpAddCartItemInput): Promise<Cart> {
  return write(
    writes.epAddCartItem,
    input,
    "We couldn't add this item to your cart. Please try again."
  );
}

/** Sets a cart line's quantity. Resolves, refreshes and rejects like {@link epAddCartItem}. */
export function epUpdateCartItem(input: EpUpdateCartItemInput): Promise<Cart> {
  return write(
    writes.epUpdateCartItem,
    input,
    "We couldn't update the quantity. Please try again."
  );
}

/** Removes a cart line. Resolves, refreshes and rejects like {@link epAddCartItem}. */
export function epRemoveCartItem(input: EpRemoveCartItemInput): Promise<Cart> {
  return write(
    writes.epRemoveCartItem,
    input,
    "We couldn't remove this item. Please try again."
  );
}
