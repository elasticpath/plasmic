import { listLocations } from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import type { EpServerAuth } from "./types";

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
  /** SSR-only explicit auth. Never advertised; never bind in Studio. */
  auth?: EpServerAuth;
}

/** Every inventory location the shopper's catalog context can see. */
export async function epGetLocations({
  type,
  auth: inputAuth,
}: EpGetLocationsInput = {}): Promise<EpLocation[]> {
  const auth = getCurrentEpSession() ?? inputAuth;

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
