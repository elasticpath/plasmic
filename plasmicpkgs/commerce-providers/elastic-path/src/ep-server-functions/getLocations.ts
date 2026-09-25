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

/** Every inventory location the shopper's catalog context can see. */
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

  try {
    const response = await listLocations({
      client,
      query: type ? { filter: `eq(type,${type})` } : {},
    });
    const rows = response.data?.data;
    return Array.isArray(rows) ? (rows as EpLocation[]) : [];
  } catch {
    return [];
  }
}
