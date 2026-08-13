/**
 * Elastic Path Commerce Extensions queries for Plasmic Studio.
 *
 * Registers read-only Studio server queries over a store's Custom APIs. The
 * transport is injected so the request contract can be asserted without a
 * network, and so a caller that already holds a configured client can supply
 * it rather than having a second one built.
 */
import { mapEntriesError } from "./errors";
import { buildEntriesRequest, EntriesRequestOpts, EpRequest } from "./request";

export type EpRequestPort = (
  req: EpRequest
) => Promise<{ status: number; body: unknown }>;

export interface QueryEntriesDeps {
  request: EpRequestPort;
}

/**
 * Fetches the entries of one Custom API. Returns the entries themselves —
 * Elastic Path's envelope is unwrapped, so the result binds straight to a
 * repeater. Custom fields arrive flat on each entry; `created_at` and
 * `updated_at` live under `meta.timestamps`.
 */
export async function queryEntries(
  opts: EntriesRequestOpts,
  deps: QueryEntriesDeps
): Promise<unknown[]> {
  const request = buildEntriesRequest(opts);
  const res = await deps.request(request);

  if (res.status < 200 || res.status >= 300) {
    throw mapEntriesError(res, { customApi: opts.customApi });
  }

  const data = (res.body as { data?: unknown } | undefined)?.data;
  return Array.isArray(data) ? data : [];
}

export function registerAll(loader: {
  registerFunction: (fn: any, meta: any) => void;
}) {
  loader.registerFunction(queryEntries, {
    name: "queryEntries",
    namespace: "epCms",
    displayName: "Query Custom API Entries",
    importPath: "@elasticpath/plasmic-ep-custom-api-cms",
    isQuery: true,
  });
}
