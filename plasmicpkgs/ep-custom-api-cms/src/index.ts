/**
 * Elastic Path Commerce Extensions queries for Plasmic Studio.
 *
 * Registers read-only Studio server queries over a store's Custom APIs. The
 * transport is injected so the request contract can be asserted without a
 * network, and so a caller that already holds a configured client can supply
 * it rather than having a second one built.
 */
import registerFunction from "@plasmicapp/host/registerFunction";
import { epRequestPort } from "./client";
import { mapEntriesError } from "./errors";
import {
  buildEntriesRequest,
  EntriesRequestOpts,
  EpRequest,
  UNSORTED,
} from "./request";

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
/**
 * The transport a query uses when none is injected. Studio supplies only the
 * query's own arguments, so the store connection is derived from those.
 */
export function defaultDeps(
  opts: EntriesRequestOpts & { clientId: string }
): QueryEntriesDeps {
  return { request: epRequestPort({ host: opts.host, clientId: opts.clientId }) };
}

export async function queryEntries(
  opts: EntriesRequestOpts & { clientId: string },
  deps: QueryEntriesDeps = defaultDeps(opts)
): Promise<unknown[]> {
  const request = buildEntriesRequest(opts);
  const res = await deps.request(request);

  if (res.status < 200 || res.status >= 300) {
    throw mapEntriesError(res, { customApi: opts.customApi });
  }

  const data = (res.body as { data?: unknown } | undefined)?.data;
  return Array.isArray(data) ? data : [];
}

export const MODULE_PATH = "@elasticpath/plasmic-ep-custom-api-cms";

/**
 * Studio renders these as the query's editor. Two are worth explaining: the
 * Custom API is a slug rather than a display name, because there is no
 * dropdown to pick from (ADR-0001), and sorting is limited to the three
 * attributes Elastic Path can order entries by — custom fields are not
 * sortable, so an alphabetical list has to be ordered in the page.
 */
const ENTRY_QUERY_FIELDS = {
  host: {
    type: "choice",
    displayName: "Region host",
    description: "The Elastic Path API host for the store's region.",
    options: [
      { label: "EU West", value: "https://euwest.api.elasticpath.com" },
      { label: "US East", value: "https://useast.api.elasticpath.com" },
    ],
    defaultValue: "https://euwest.api.elasticpath.com",
    required: true,
  },
  clientId: {
    type: "string",
    displayName: "Client ID",
    description: "The store's client id. Not a secret — no client secret is needed.",
    helpText:
      "Find it in Commerce Manager under System > Application Keys. Only the client id is used; this query never takes a client secret.",
    required: true,
  },
  customApi: {
    type: "string",
    displayName: "Custom API",
    description: "The slug of the Custom API to read entries from.",
    helpText:
      "Find it in Commerce Manager under Commerce Extensions — it is the slug, not the display name.",
    required: true,
  },
  filter: {
    type: "string",
    displayName: "Filter",
    description:
      "An Elastic Path filter expression, for example eq(status,published) or like(title,*sale*). Combine conditions with a colon.",
  },
  sort: {
    type: "choice",
    displayName: "Sort by",
    description:
      "Elastic Path can only sort entries by these attributes; custom fields are not sortable.",
    options: [
      { label: "Newest created first", value: "-created_at" },
      { label: "Oldest created first", value: "created_at" },
      { label: "Recently updated first", value: "-updated_at" },
      { label: "Least recently updated first", value: "updated_at" },
      { label: "Entry ID, ascending", value: "id" },
      { label: "Entry ID, descending", value: "-id" },
      { label: "Unsorted (fastest)", value: UNSORTED },
    ],
    defaultValueHint: "Newest created first",
  },
  limit: {
    type: "number",
    displayName: "Limit",
    description: "Entries to fetch, up to 100.",
    defaultValueHint: "The store's page-length setting, commonly 25",
  },
  offset: {
    type: "number",
    displayName: "Offset",
    description: "Entries to skip, for a load-more or next-page control.",
    defaultValueHint: 0,
  },
} as const;

export function registerAll(loader?: {
  registerFunction: (fn: any, meta: any) => void;
}) {
  // A loader is passed when a host app registers explicitly; the canvas package
  // entry passes nothing and relies on the host's global registry.
  const register = (fn: any, meta: any) =>
    loader ? loader.registerFunction(fn, meta) : registerFunction(fn, meta);

  register(queryEntries, {
    name: "queryEntries",
    namespace: "epCms",
    displayName: "Query Custom API Entries",
    description:
      "Fetch entries from an Elastic Path Commerce Extensions Custom API.",
    importPath: MODULE_PATH,
    isQuery: true,
    params: [
      {
        name: "opts",
        type: "object",
        display: "flatten",
        fields: ENTRY_QUERY_FIELDS,
      },
    ],
  });
}
