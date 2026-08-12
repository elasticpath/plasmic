import { epProxyErrorCode } from "./proxy-fetch";

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
};

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
  const code = epProxyErrorCode(err);
  if (code) {
    return CART_MUTATION_ERROR_COPY[code] ?? genericFallback;
  }
  const raw = err instanceof Error ? err.message.trim() : "";
  return raw || genericFallback;
}
