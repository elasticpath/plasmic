/**
 * Builds the request headers for a locale- and currency-aware cart read.
 *
 * The cart read re-prices at read time when `X-Moltin-Currency` is sent, and
 * negotiates localized content via `Accept-Language`. A header is omitted
 * entirely when its value is absent, so the package stays policy-free — the
 * storefront resolves the locale→currency mapping and supplies the values.
 */
export interface CartReadHeaderInput {
  /** BCP-47 locale, e.g. "en-US". Sets `Accept-Language` when present. */
  locale?: string;
  /** ISO 4217 currency code, e.g. "USD". Sets `X-Moltin-Currency` when present. */
  currency?: string;
}

export function buildCartReadHeaders(
  input: CartReadHeaderInput = {}
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
