import { DEFAULT_CURRENCY_CODE } from "../const";

/** How a currency renders: a symbol (`$179.00`) or its ISO code (`USD 179.00`). */
export type CurrencyDisplay = "symbol" | "code";

/**
 * Formats a currency amount for display using Intl.NumberFormat.
 *
 * Uses the browser's locale (undefined → system default) so the same
 * currency code renders with the user's preferred number/grouping format.
 * `display` maps to Intl's `currencyDisplay` — `"symbol"` (default) renders
 * `$179.00`, `"code"` renders `USD 179.00`.
 * Falls back to a plain string only when Intl throws — which happens for
 * invalid currency codes, not for missing locale data. The fallback mirrors
 * the requested display: a `$` prefix for symbol, a code prefix for code.
 *
 * @param amount — Amount in display units (e.g. 29.99, not cents)
 * @param currencyCode — ISO 4217 code (e.g. "USD", "GBP")
 * @param display — "symbol" (default) or "code"
 */
export function formatCurrency(
  amount: number,
  currencyCode: string = DEFAULT_CURRENCY_CODE,
  display: CurrencyDisplay = "symbol"
): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: display,
    }).format(amount);
  } catch {
    return display === "code"
      ? `${currencyCode} ${amount.toFixed(2)}`
      : `$${amount.toFixed(2)}`;
  }
}

/**
 * Formats a currency amount stored in cents (minor units) for display.
 *
 * Elastic Path stores order/payment amounts in cents — this helper divides
 * by 100 before formatting.  Uses 'en-US' locale to match the existing
 * checkout/order display convention.
 *
 * @param amountInCents — Amount in minor currency units (e.g. 2999 = $29.99)
 * @param currencyCode — ISO 4217 code (e.g. "USD", "GBP")
 */
export function formatCurrencyFromCents(
  amountInCents: number,
  currencyCode: string = DEFAULT_CURRENCY_CODE
): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode.toUpperCase(),
    }).format(amountInCents / 100);
  } catch {
    return `${currencyCode.toUpperCase()} ${(amountInCents / 100).toFixed(2)}`;
  }
}
