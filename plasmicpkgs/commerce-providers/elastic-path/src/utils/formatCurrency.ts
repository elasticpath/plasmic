import { DEFAULT_CURRENCY_CODE } from "../const";

export type { CurrencyDisplay } from "./price";
import type { CurrencyDisplay } from "./price";
import { DEFAULT_LOCALE } from "./field-format";

/**
 * Formats a scalar amount already in display units.
 *
 * Prefer `formatPrice` where an Elastic Path price object is in hand — it
 * honours the store's own formatting. This is for the paths that only ever
 * had a number.
 *
 * The locale is explicit rather than the host's default, because
 * `Intl.NumberFormat(undefined, …)` resolves to Node's locale on the server and
 * the browser's on the client, so the same amount rendered differently either
 * side of hydration.
 */
export function formatCurrency(
  amount: number,
  currencyCode: string = DEFAULT_CURRENCY_CODE,
  display: CurrencyDisplay = "symbol",
  locale: string = DEFAULT_LOCALE
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: display === "code" ? "code" : "symbol",
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
