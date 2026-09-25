import { postMultiSearch } from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";

/**
 * One search in a multi-search body, passed through as written.
 *
 * Open on purpose: the catalog-search adapter and the autocomplete source
 * send different key sets (`type`/`q`/`include_fields` vs the Typesense
 * query parameters), and Elastic Path keeps adding more.
 */
export type EpMultiSearchQuery = Record<string, unknown>;

export interface EpMultiSearchInput {
  searches: EpMultiSearchQuery[];
  /**
   * Related resources to side-load, e.g. `["main_image"]`.
   *
   * Elastic Path returns the `included` block only when this is asked for.
   * Without it a hit carries `relationships.main_image` pointing at nothing
   * the response contains, and every search result renders imageless with no
   * error anywhere.
   */
  include?: string[];
}

/**
 * The multi-search payload, returned verbatim.
 *
 * Package-owned rather than the SDK's `MultiSearchResponse`, which declares
 * no `included`. The search adapter resolves each hit's `main_image` against
 * that top-level block, so an SDK-typed result drops every product image
 * with nothing failing.
 */
export interface EpMultiSearchResponse extends Record<string, unknown> {
  results?: Array<Record<string, unknown>>;
  included?: Record<string, unknown>;
}

/**
 * Runs a catalog multi-search and returns Elastic Path's response as-is.
 *
 * Throws when the search fails. An empty result is a plausible correct answer
 * here — "nothing matched" — so failing soft to one would render a search
 * outage as a no-results page. The autocomplete source already turns a
 * rejection into an empty suggestion list, so no UI crashes on this.
 */
export async function epMultiSearch({
  searches,
  include,
}: EpMultiSearchInput): Promise<EpMultiSearchResponse> {
  const body = { searches: searches ?? [] };
  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return (
      (await callEpProxy<EpMultiSearchResponse | null>("multiSearch", {
        searches: body.searches,
        ...(include && include.length > 0 ? { include } : {}),
      })) ?? {}
    );
  }

  if (!isUsableAuth(auth)) return {};
  const client = buildEpClient(auth);

  const response = await postMultiSearch({
    client,
    body: body as any,
    ...(include && include.length > 0 ? { query: { include } } : {}),
  } as any);
  if (response.error) {
    throw new Error(
      `epMultiSearch: ${
        response.error instanceof Error
          ? response.error.message
          : JSON.stringify(response.error)
      }`
    );
  }
  return (response.data as EpMultiSearchResponse) ?? {};
}
