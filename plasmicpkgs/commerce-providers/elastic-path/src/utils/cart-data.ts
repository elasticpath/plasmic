import { DEFAULT_CURRENCY_CODE } from "../const";
import { CurrencyDisplay, formatCurrency } from "./formatCurrency";

/** The minimal cart shape the derivation reads (a normalized cart). */
export interface DerivableCart {
  id: string;
  lineItems: Array<{ quantity?: number; [k: string]: any }>;
  subtotalPrice: number;
  totalPrice: number;
  currency?: { code?: string };
}

/** Enriched cart data published as `$ctx.cartData` to the cart components. */
export interface CartData {
  id: string;
  lineItems: DerivableCart["lineItems"];
  itemCount: number;
  isEmpty: boolean;
  subtotalPrice: number;
  totalPrice: number;
  formattedSubtotal: string;
  formattedTotal: string;
  currencyCode: string;
  currencyDisplay: CurrencyDisplay;
}

export interface DeriveCartDataOptions {
  /** "symbol" (default) → `$179.00`; "code" → `USD 179.00`. */
  currencyDisplay?: CurrencyDisplay;
}

/**
 * Derives the enriched, formatted cart data the cart components bind to.
 *
 * Pure: takes a normalized cart and a `currencyDisplay` preference and returns
 * the formatted subtotal/total (honouring the preference) plus the item count
 * and currency metadata. `currencyDisplay` is carried on the result so per-line
 * formatting (in the item list) stays consistent with the totals.
 */
export function deriveCartData(
  cart: DerivableCart | null | undefined,
  options: DeriveCartDataOptions = {}
): CartData | null {
  if (!cart) return null;
  const currencyCode = cart.currency?.code ?? DEFAULT_CURRENCY_CODE;
  const currencyDisplay = options.currencyDisplay ?? "symbol";
  return {
    id: cart.id,
    lineItems: cart.lineItems,
    itemCount: cart.lineItems.reduce(
      (sum, item) => sum + (item.quantity ?? 1),
      0
    ),
    isEmpty: cart.lineItems.length === 0,
    subtotalPrice: cart.subtotalPrice,
    totalPrice: cart.totalPrice,
    formattedSubtotal: formatCurrency(
      cart.subtotalPrice,
      currencyCode,
      currencyDisplay
    ),
    formattedTotal: formatCurrency(cart.totalPrice, currencyCode, currencyDisplay),
    currencyCode,
    currencyDisplay,
  };
}
