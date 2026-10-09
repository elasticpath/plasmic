import { readEpErrorCode } from "../browser-call";
import { currentEpDesignRealm } from "./design-realm";

/**
 * Stable proxy `code` → shopper-facing copy for cart mutation DataProviders
 * (`addToCartState`, `quantityControl`, `removeItemState`).
 *
 * Production proxy responses sanitize `message` to `dispatch_failed` and keep
 * the machine-readable `code`. Callers must map via this helper (or equivalent)
 * rather than rendering `error.message` directly.
 */
const CART_MUTATION_ERROR_COPY: Record<string, string> = {
  insufficient_stock:
    "There isn't enough stock to add that quantity. Try a smaller amount.",
  no_session: "Your session expired. Refresh the page and try again.",
  invalid_promo_code:
    "That code isn't valid for this basket. Check it and try again.",
  design_fn_not_served:
    "Cart changes don't run on the Studio canvas. Preview the page to try them.",
};

const CONFIGURE_PANEL_COPY =
  "Cart changes don't run in the configure panel. Preview the page to try them.";

/** Fixed shopper copy for a cart write that failed with no more specific copy. */
export const CART_WRITE_FAILURE_COPY = {
  add: "We couldn't add this item to your cart. Please try again.",
  update: "We couldn't update the quantity. Please try again.",
  remove: "We couldn't remove this item. Please try again.",
} as const;

/**
 * The text a cart component shows for a rejected cart write. The write
 * already rejects with shopper copy, so its message is shown as it is.
 */
export function cartWriteErrorText(
  err: unknown,
  write: keyof typeof CART_WRITE_FAILURE_COPY
): string {
  const message = err instanceof Error ? err.message.trim() : "";
  return message || CART_WRITE_FAILURE_COPY[write];
}

/**
 * Resolves designer-facing error text for a cart mutation failure.
 *
 * Coded proxy failures never reach the shopper verbatim — unknown codes
 * (including `dispatch_failed`) use `genericFallback`. Locally raised errors
 * without a `code` keep their authored message when present.
 */
export function cartMutationErrorCopy(
  err: unknown,
  genericFallback: string
): string {
  const code = readEpErrorCode(err);
  if (code === "design_fn_not_served" && currentEpDesignRealm() === "app-host") {
    return CONFIGURE_PANEL_COPY;
  }
  if (code) {
    return CART_MUTATION_ERROR_COPY[code] ?? genericFallback;
  }
  const raw = err instanceof Error ? err.message.trim() : "";
  return raw || genericFallback;
}
