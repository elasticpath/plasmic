/**
 * Resolved EP connection + auth context. Built by the consumer's RSC
 * catchall page from `extractEpProviderConfig(prefetchedData)` (connection)
 * and `epAuth.api.getSession()` (per-shopper auth), then handed to
 * `withEpSession()` so every `ep.*` server function can read it via
 * AsyncLocalStorage (per PRD #272).
 *
 * Token is input-only to server functions — never returned, never
 * serialised into the prefetched query cache (per PRD #262).
 */
export interface EpServerAuth {
  /** OAuth access token (implicit grant). */
  accessToken: string;
  /** EP API host, e.g. "https://epcc-integration.global.ssl.fastly.net". */
  host: string;
  /** Store client ID — required by the EP SDK even when a token is supplied. */
  clientId: string;
  /** Current shopper cart ID, when present. */
  cartId?: string;
  /** Current shopper account ID, when logged in. */
  accountId?: string;
  /** Locale for price formatting / content negotiation. Defaults to "en-US". */
  locale?: string;
}
