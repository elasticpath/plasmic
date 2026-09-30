import { listLocations } from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";

/** An Elastic Path inventory location, as the locations list returns it. */
export interface EpLocation {
  id?: string;
  type?: string;
  attributes?: {
    name?: string;
    slug?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface EpGetLocationsInput {
  /** Location type to filter on, e.g. "warehouse" or "store". */
  type?: string;
}

// Elastic Path does not accept a larger page size or a larger offset.
const PAGE_LIMIT = 100;
const MAX_OFFSET = 10_000;

/**
 * Returns every inventory location that the shopper's catalog context can see.
 *
 * Elastic Path splits this list into pages. If a request gives no page size,
 * Elastic Path uses the page length in the store configuration. The response
 * has no total count, so a page with fewer rows than the page size is the last
 * page. If a later page fails, this returns the pages that it already read.
 */
export async function epGetLocations({
  type,
}: EpGetLocationsInput = {}): Promise<EpLocation[]> {
  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return (
      (await callEpProxy<EpLocation[] | null>("getLocations", { type }, null)) ??
      []
    );
  }

  if (!isUsableAuth(auth)) return [];
  const client = buildEpClient(auth);
  const typeFilter = type ? { filter: `eq(type,${type})` } : {};

  const locations: EpLocation[] = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_LIMIT) {
    const response = await listLocations({
      client,
      query: {
        ...typeFilter,
        "page[limit]": PAGE_LIMIT,
        "page[offset]": offset,
      },
    }).catch(() => null);
    const rows = response?.data?.data;
    if (!Array.isArray(rows)) {
      break;
    }
    locations.push(...(rows as EpLocation[]));
    if (rows.length < PAGE_LIMIT) {
      break;
    }
  }
  return locations;
}
