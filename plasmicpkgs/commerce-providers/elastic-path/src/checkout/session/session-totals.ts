import { isShippingLine } from "./shipping-line-sku";
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

/**
 * What a shipping line adds to the cart total: its priced value after any
 * cart discount, as Elastic Path reports it, else its unit price.
 */
function shippingLineAmount(line: unknown): number {
  const l = line as {
    quantity?: unknown;
    unit_price?: { amount?: unknown };
    meta?: { display_price?: { with_tax?: { value?: { amount?: unknown } } } };
  };
  return (
    num(l.meta?.display_price?.with_tax?.value?.amount) ??
    (num(l.unit_price?.amount) ?? 0) * (num(l.quantity) ?? 1)
  );
}

/** Session totals for a cart read in Elastic Path's own shape; null without a total. */
export function totalsFromCart(cartResponse: unknown): SessionTotals | null {
  const displayPrice = (
    cartResponse as { data?: { meta?: { display_price?: DisplayPrice } } }
  )?.data?.meta?.display_price;
  const total = num(displayPrice?.with_tax?.amount);
  if (total === null) {
    return null;
  }
  const shipping = cartLines(cartResponse)
    .filter(isShippingLine)
    .reduce<number>((sum, line) => sum + shippingLineAmount(line), 0);
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

/** The same totals with the shipping left out, for a session with no rate chosen. */
export function totalsWithoutShipping(
  totals: SessionTotals | null
): SessionTotals | null {
  if (!totals) return totals;
  return { ...totals, shipping: 0, total: totals.subtotal + totals.tax };
}
