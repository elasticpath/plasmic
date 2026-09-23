import { postMultiSearch } from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import type { EpServerAuth } from "./types";

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
  /** SSR-only explicit auth. Never advertised; never bind in Studio. */
  auth?: EpServerAuth;
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

/** Runs a catalog multi-search and returns Elastic Path's response as-is. */
export async function epMultiSearch({
  searches,
  auth: inputAuth,
}: EpMultiSearchInput): Promise<EpMultiSearchResponse> {
  const body = { searches: searches ?? [] };
  const auth = getCurrentEpSession() ?? inputAuth;

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return (
      (await callEpProxy<EpMultiSearchResponse | null>(
        "multiSearch",
        { searches: body.searches },
        null
      )) ?? {}
    );
  }

  if (!isUsableAuth(auth)) return {};
  const client = buildEpClient(auth);

  try {
    const response = await postMultiSearch({ client, body: body as any });
    return (response.data as EpMultiSearchResponse) ?? {};
  } catch {
    return {};
  }
}
