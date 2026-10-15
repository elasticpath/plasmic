import { EP_SHIPPING_LINE_SKU } from "./set-shipping-line";
import type { SessionTotals } from "./types";

type Amount = { amount?: unknown; currency?: unknown } | undefined;
type DisplayPrice = { with_tax?: Amount; tax?: Amount } | undefined;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Lines of a cart read in Elastic Path's own shape. */
export function cartLines(cartResponse: unknown): unknown[] {
  const r = cartResponse as {
    included?: { items?: unknown };
    data?: { items?: unknown };
  } | null;
  const items = r?.included?.items ?? r?.data?.items;
  return Array.isArray(items) ? items : [];
}

/** Session totals for a cart total that includes `shipping`; null without a total. */
export function totalsFromDisplayPrice(
  displayPrice: DisplayPrice,
  shipping: number
): SessionTotals | null {
  const total = num(displayPrice?.with_tax?.amount);
  if (total === null) return null;
  const tax = num(displayPrice?.tax?.amount) ?? 0;
  const currency = displayPrice?.with_tax?.currency;
  return {
    subtotal: total - tax - shipping,
    tax,
    shipping,
    total,
    currency: typeof currency === "string" ? currency : "",
  };
}

/** Session totals for a cart read in Elastic Path's own shape. */
export function totalsFromCart(cartResponse: unknown): SessionTotals | null {
  const shipping = cartLines(cartResponse)
    .filter((it) => (it as { sku?: unknown })?.sku === EP_SHIPPING_LINE_SKU)
    .reduce<number>((sum, it) => {
      const line = it as { quantity?: unknown; unit_price?: { amount?: unknown } };
      return sum + (num(line.unit_price?.amount) ?? 0) * (num(line.quantity) ?? 1);
    }, 0);
  const meta = (cartResponse as { data?: { meta?: { display_price?: DisplayPrice } } })
    ?.data?.meta;
  return totalsFromDisplayPrice(meta?.display_price, shipping);
}
