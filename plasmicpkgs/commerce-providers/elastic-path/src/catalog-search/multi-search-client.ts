/**
 * The object the catalog-search adapter accepts in place of an Elastic Path
 * shopper client.
 *
 * The adapter stores whatever it is given and hands it to the shopper SDK's
 * `postMultiSearch`, which calls `.post()` on it and nothing else. One method
 * is therefore the whole contract, and satisfying it with `epMultiSearch`
 * makes search isomorphic: on the server the function resolves the session the
 * server already holds, in the browser it goes through the storefront's own
 * proxy route. Either way the browser holds no Elastic Path credential and
 * sends no request to Elastic Path.
 */
import {
  epMultiSearch,
  EpMultiSearchQuery,
  EpMultiSearchResponse,
} from "../ep-server-functions/multiSearch";

interface MultiSearchPostOptions {
  body?: { searches?: EpMultiSearchQuery[] };
  query?: { include?: string[] };
}

export interface MultiSearchClient {
  post(
    options: MultiSearchPostOptions
  ): Promise<{ data: EpMultiSearchResponse }>;
}

/**
 * Returns `search` with its `filter_by` expression wrapped in its own group.
 *
 * Defence in depth, not a fix. Elastic Path composes the store's search-profile
 * filter as `(profile) && (request)` — the request side is already wrapped, so
 * a filter a designer supplies cannot change what the profile means. Wrapping
 * again here keeps that true if the platform's composition ever changes, and
 * costs one pair of parentheses.
 *
 * Deliberately not a balance checker: an unbalanced expression is rejected by
 * the search engine either way, and a checker here would be a second, weaker
 * copy of a rule the platform already enforces.
 */
export function groupFilterBy(search: EpMultiSearchQuery): EpMultiSearchQuery {
  const filterBy = search.filter_by;
  if (typeof filterBy !== "string" || filterBy.trim() === "") {
    return search;
  }
  return { ...search, filter_by: `(${filterBy})` };
}

export function createMultiSearchClient(): MultiSearchClient {
  return {
    async post(options) {
      const searches = options?.body?.searches ?? [];
      const include = options?.query?.include;
      const data = await epMultiSearch({
        searches: searches.map(groupFilterBy),
        ...(include && include.length > 0 ? { include } : {}),
      });
      return { data };
    },
  };
}
