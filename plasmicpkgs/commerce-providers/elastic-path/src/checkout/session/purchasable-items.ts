import { EP_SHIPPING_LINE_SKU } from "./set-shipping-line";

/** True when the cart holds a line the shopper buys: not the managed shipping line, not a promotion. */
export function hasPurchasableItem(items: unknown): boolean {
  if (!Array.isArray(items)) return false;
  return items.some(
    (it: { sku?: unknown; type?: unknown } | null) =>
      !!it && it.sku !== EP_SHIPPING_LINE_SKU && it.type !== "promotion_item"
  );
}
