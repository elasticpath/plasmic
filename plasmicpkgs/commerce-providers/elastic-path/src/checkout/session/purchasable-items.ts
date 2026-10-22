import { isShippingLine } from "./shipping-line-sku";

/** True when the cart holds a line the shopper buys: not the managed shipping line, not a promotion. */
export function hasPurchasableItem(items: unknown): boolean {
  if (!Array.isArray(items)) {
    return false;
  }
  return items.some(
    (it: { type?: unknown } | null) =>
      !!it && !isShippingLine(it) && it.type !== "promotion_item"
  );
}
