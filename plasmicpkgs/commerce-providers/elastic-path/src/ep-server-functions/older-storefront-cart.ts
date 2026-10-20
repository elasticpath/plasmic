import { isShippingLine } from "../checkout/session/shipping-line-sku";
import type { Cart } from "../types/cart";
import { normalizeCart } from "../utils/normalize";

/**
 * A cart from a storefront older than these components (0.8.0) lists the
 * checkout's shipping line as an item and counts it. Such a cart gets this
 * release's shape, so every component shows the same lines and totals on
 * either storefront. Any other cart is returned as it is.
 */
export function asCurrentCart<T extends Cart | null | undefined>(cart: T): T {
  if (!cart || typeof cart !== "object" || !Array.isArray(cart.items)) {
    return cart;
  }
  if (!cart.items.some(isShippingLine)) return cart;
  const {
    items,
    promotions,
    itemCount: _itemCount,
    withoutShipping: _withoutShipping,
    ...data
  } = cart as Cart & Record<string, unknown>;
  return normalizeCart({
    data: data as never,
    included: {
      items: [...items, ...(Array.isArray(promotions) ? promotions : [])] as never,
    },
  }) as T;
}
