import { mutate as swrMutate } from "swr";
import { makeEpCallError } from "../ep-server-functions/call-error";
import { cartMutationErrorCopy } from "../ep-server-functions/cart-mutation-error-copy";
import * as serverCartWrites from "../ep-server-functions/cart-mutations";
import type {
  EpAddCartItemInput,
  EpRemoveCartItemInput,
  EpUpdateCartItemInput,
} from "../ep-server-functions/cart-mutations";
import { currentEpDesignRealm } from "../ep-server-functions/design-realm";
import { epProxyErrorCode } from "../ep-server-functions/proxy-fetch";
import type { Cart } from "../types/cart";
import { epCartCacheKey } from "./cache-keys";

const BARE_ERROR_CODE = /^[a-z]+(?:_[a-z]+)*$/;

const NOT_ON_STUDIO_CANVAS =
  "Cart changes don't run on the Studio canvas. Preview the page to try them.";

async function writeCartAndSeedCache<I>(
  serverCartWrite: (input: I) => Promise<Cart>,
  input: I,
  failureCopy: string
): Promise<Cart> {
  let cart: Cart | undefined;
  try {
    cart = await serverCartWrite(input);
  } catch (err) {
    if (err instanceof Error && epProxyErrorCode(err) && BARE_ERROR_CODE.test(err.message)) {
      err.message = cartMutationErrorCopy(err, failureCopy);
    }
    throw err;
  }
  if (!cart) {
    throw currentEpDesignRealm() === "artboard"
      ? makeEpCallError({ code: "design_fn_not_served", message: NOT_ON_STUDIO_CANVAS })
      : makeEpCallError({ message: failureCopy });
  }
  if (typeof window !== "undefined") {
    await swrMutate(epCartCacheKey(), cart, { revalidate: false });
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
  return writeCartAndSeedCache(
    serverCartWrites.epAddCartItem,
    input,
    "We couldn't add this item to your cart. Please try again."
  );
}

/** Sets a cart line's quantity. Resolves, refreshes and rejects like {@link epAddCartItem}. */
export function epUpdateCartItem(input: EpUpdateCartItemInput): Promise<Cart> {
  return writeCartAndSeedCache(
    serverCartWrites.epUpdateCartItem,
    input,
    "We couldn't update the quantity. Please try again."
  );
}

/** Removes a cart line. Resolves, refreshes and rejects like {@link epAddCartItem}. */
export function epRemoveCartItem(input: EpRemoveCartItemInput): Promise<Cart> {
  return writeCartAndSeedCache(
    serverCartWrites.epRemoveCartItem,
    input,
    "We couldn't remove this item. Please try again."
  );
}
