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

/** Elastic Path's largest page, and the furthest it lets a read offset. */
const PAGE_LIMIT = 100;
const MAX_OFFSET = 10_000;

/**
 * Every inventory location the shopper's catalog context can see.
 *
 * The list is paged. Without a limit, Elastic Path returns one page of the
 * store's page length, so this reads pages until one comes back short. If a
 * later page fails, the pages already read are returned.
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
  const filter = type ? { filter: `eq(type,${type})` } : {};

  const locations: EpLocation[] = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_LIMIT) {
    const response = await listLocations({
      client,
      query: { ...filter, "page[limit]": PAGE_LIMIT, "page[offset]": offset },
    }).catch(() => null);
    const rows = response?.data?.data;
    if (!Array.isArray(rows)) break;
    locations.push(...(rows as EpLocation[]));
    if (rows.length < PAGE_LIMIT) break;
  }
  return locations;
}
