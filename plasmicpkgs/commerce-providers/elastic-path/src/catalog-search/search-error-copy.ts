import { epProxyErrorCode } from "../ep-server-functions/proxy-fetch";

/**
 * Stable proxy `code` → shopper-facing copy for a failed catalog search.
 *
 * A search that returns nothing is not in here: no hits is a correct answer
 * and renders the empty state, never this. Everything here is the search
 * failing to run at all.
 */
const CATALOG_SEARCH_ERROR_COPY: Record<string, string> = {
  route_not_found:
    "Search is unavailable: this storefront does not serve the Elastic Path route that search runs through.",
  unknown_fn:
    "Search is unavailable: this storefront's Elastic Path route is older than its components and does not serve catalog search.",
  no_session: "Your session expired. Refresh the page and search again.",
};

const GENERIC_CATALOG_SEARCH_ERROR =
  "Search is unavailable right now. Try again in a moment.";

/**
 * Resolves the message the error slot shows for a search failure.
 *
 * Branches on the machine-readable `code` rather than message text, which the
 * proxy route withholds in production. An unknown code — including
 * `dispatch_failed`, which is what a production route reports for anything it
 * cannot name — falls back to the generic line rather than repeating a message
 * the shopper cannot act on.
 */
export function catalogSearchErrorCopy(err: unknown): string {
  const code = epProxyErrorCode(err);
  if (code) {
    return CATALOG_SEARCH_ERROR_COPY[code] ?? GENERIC_CATALOG_SEARCH_ERROR;
  }
  return GENERIC_CATALOG_SEARCH_ERROR;
}
