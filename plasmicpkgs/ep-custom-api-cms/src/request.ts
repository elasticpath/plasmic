/**
 * Builds the request for a Commerce Extensions entry query.
 *
 * Kept free of transport concerns so the request contract can be asserted
 * directly: the extension endpoint is addressed by Custom API slug, and the
 * parameters it honours were confirmed against a live store (see the run's
 * epic note).
 */

/** The Studio-facing value for "do not order the results". */
export const UNSORTED = "unsorted";

export interface EntriesRequestOpts {
  host: string;
  customApi: string;
  /**
   * Elastic Path filter expression, passed through verbatim. The grammar is
   * the store's, not ours — encoding belongs to the transport, so a filter is
   * never rewritten here.
   */
  filter?: string;
  /**
   * One of the three attributes Elastic Path can sort entries by, optionally
   * prefixed with `-` for descending. Custom fields are not sortable, which is
   * a store-side limitation rather than a gap here.
   */
  sort?: string;
  /** Entries per request. Elastic Path caps this at 100. */
  limit?: number;
  /** Zero-based record offset. Elastic Path caps this at 10,000. */
  offset?: number;
}

export interface EpRequest {
  url: string;
  query: Record<string, string | number>;
}

export function buildEntriesRequest(opts: EntriesRequestOpts): EpRequest {
  const customApi = opts.customApi.trim();
  if (!customApi) {
    throw new Error("No Custom API named — set the Custom API slug on this query.");
  }

  const query: Record<string, string | number> = {
    // Always the cheap count: the query returns a plain array, so paying for
    // an exact total buys the designer nothing.
    "page[total_method]": "observed",
  };

  const filter = opts.filter?.trim();
  if (filter) {
    query.filter = filter;
  }

  const sort = opts.sort?.trim();
  if (sort) {
    // The designer picks the self-describing "unsorted"; Elastic Path spells
    // the same thing `sort=null`. Translating here keeps the store's sentinel
    // out of the Studio-facing choice.
    query.sort = sort === UNSORTED ? "null" : sort;
  }

  if (typeof opts.limit === "number") {
    query["page[limit]"] = opts.limit;
  }
  if (typeof opts.offset === "number") {
    query["page[offset]"] = opts.offset;
  }

  // Designers paste the host from a browser bar, trailing slash included.
  const host = opts.host.replace(/\/+$/, "");

  return {
    url: `${host}/v2/extensions/${customApi}`,
    query,
  };
}
