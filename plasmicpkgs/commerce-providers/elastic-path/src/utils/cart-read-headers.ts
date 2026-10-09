import type { EpLocaleAndCurrency } from "../types/locale-and-currency";

/**
 * Builds the request headers for a locale- and currency-aware cart read.
 *
 * The cart read re-prices at read time when `X-Moltin-Currency` is sent, and
 * negotiates localized content via `Accept-Language`. A header is omitted
 * entirely when its value is absent, so the package stays policy-free — the
 * storefront resolves the locale→currency mapping and supplies the values.
 */
export function buildCartReadHeaders(
  input: EpLocaleAndCurrency = {}
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (input.locale) {
    headers["Accept-Language"] = input.locale;
  }
  if (input.currency) {
    headers["X-Moltin-Currency"] = input.currency;
  }
  return headers;
}
