/** Sentinel SKU that marks a storefront-managed shipping line. */
export const EP_SHIPPING_LINE_SKU = "__ep_shipping";

/** True for the storefront-managed shipping line, which is not something the shopper bought. */
export function isShippingLine(item: unknown): boolean {
  return (item as { sku?: unknown } | null)?.sku === EP_SHIPPING_LINE_SKU;
}
