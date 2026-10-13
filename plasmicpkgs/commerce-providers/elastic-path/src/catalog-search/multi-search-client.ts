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
import { isUsableAuth } from "../ep-server-functions/ep-client";
import {
  EpMultiSearchQuery,
  EpMultiSearchResponse,
  epMultiSearch,
  epMultiSearchWithAuth,
} from "../ep-server-functions/multiSearch";
import { readEpRequestBridge } from "../ep-server-functions/request-bridge";

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

/**
 * How catalog search's server render went, shared between the search client
 * and the provider that renders its results.
 */
export interface CatalogSearchServerPass {
  outcome: "pending" | "success" | "skipped";
  /** The page request's CSP nonce, for the inserted results script. */
  nonce?: string;
  /** Lets the server render finish with no results. Set by the provider. */
  release?: () => void;
}

export const SERVER_SEARCH_TIMEOUT_MS = 3000;

const NEVER = new Promise<never>(() => {});

/**
 * Searches during the server render with the page request's session.
 *
 * Any failure skips rather than rejects: a rejection renders the error slot
 * into the HTML, where a crawler would index it. After a skip the HTML carries
 * the widgets before any search, and the browser searches through the proxy.
 */
async function serverPassSearch(
  pass: CatalogSearchServerPass,
  searches: EpMultiSearchQuery[],
  include: string[] | undefined
): Promise<{ data: EpMultiSearchResponse }> {
  const skip = () => {
    pass.outcome = "skipped";
    pass.release?.();
    return NEVER;
  };
  const bridge = readEpRequestBridge();
  if (!bridge) return skip();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SERVER_SEARCH_TIMEOUT_MS);
  });
  const search = (async () => {
    const [auth, nonce] = await Promise.all([
      bridge.requestSession(),
      bridge.requestNonce(),
    ]);
    pass.nonce = nonce;
    if (!isUsableAuth(auth)) return null;
    const data = await epMultiSearchWithAuth(auth, { searches, include });
    return Array.isArray(data?.results) ? data : null;
  })();

  let data: EpMultiSearchResponse | null;
  try {
    data = await Promise.race([search, timeout]);
  } catch {
    data = null;
  } finally {
    clearTimeout(timer);
  }
  if (!data) return skip();
  pass.outcome = "success";
  return { data };
}

/**
 * With `serverPass`, a search during the server render runs in-process with
 * the page request's session. Every other search goes through `epMultiSearch`.
 */
export function createMultiSearchClient(
  serverPass?: CatalogSearchServerPass
): MultiSearchClient {
  return {
    async post(options) {
      const searches = (options?.body?.searches ?? []).map(groupFilterBy);
      const include = options?.query?.include;
      if (serverPass && typeof window === "undefined") {
        return serverPassSearch(serverPass, searches, include);
      }
      return { data: await epMultiSearch({ searches, include }) };
    },
  };
}
