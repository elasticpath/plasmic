/**
 * The shopper's locale and currency, as Elastic Path receives them. A field
 * that is absent sends no header.
 */
export interface EpLocaleAndCurrency {
  /** BCP 47 language tag, e.g. "en-US". Sent as `Accept-Language`. */
  locale?: string;
  /** ISO 4217 currency code, e.g. "USD". Sent as `X-Moltin-Currency`. */
  currency?: string;
}

/**
 * Chooses the shopper's locale and currency for a request. `createEpAuth`
 * calls it on every `getSession` with the request's cookies and headers.
 * `locale` may be an `Accept-Language` value as the browser sent it; the
 * session carries the first valid tag.
 */
export type EpLocaleAndCurrencyResolver = (request: {
  cookies: Record<string, string>;
  headers: Record<string, string>;
}) =>
  | EpLocaleAndCurrency
  | null
  | undefined
  | Promise<EpLocaleAndCurrency | null | undefined>;
