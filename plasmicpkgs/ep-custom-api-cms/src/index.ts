/**
 * Elastic Path Commerce Extensions queries for Plasmic Studio.
 *
 * Registers read-only Studio server queries over a store's Custom APIs. The
 * transport is injected so the request contract can be asserted without a
 * network, and so a caller that already holds a configured client can supply
 * it rather than having a second one built.
 */
import registerFunction from "@plasmicapp/host/registerFunction";
import { EpClientCredentials, epRequestPort } from "./client";
import { mapEntriesError } from "./errors";
import { fieldsFromSample, filterHint, SampledField } from "./fields";
import {
  buildEntriesRequest,
  buildEntryRequest,
  EntriesRequestOpts,
  EntryRequestOpts,
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
 * The transport a query uses when none is injected. Studio supplies only the
 * query's own arguments, so the store connection is derived from those.
 */
export function defaultDeps(opts: EpClientCredentials): QueryEntriesDeps {
  return { request: epRequestPort({ host: opts.host, clientId: opts.clientId }) };
}

/**
 * Every read goes through here, so both failure modes are handled in one place:
 * a transport that never reached Elastic Path throws rather than returning a
 * status, and would otherwise surface as a bare "fetch failed" with nothing to
 * act on, while an HTTP failure carries a status the mapper turns into something
 * a designer can fix. Returns Elastic Path's `data` payload, unwrapped.
 */
async function read(
  request: EpRequest,
  deps: QueryEntriesDeps,
  ctx: { host: string; customApi: string; entry?: string }
): Promise<unknown> {
  let res: Awaited<ReturnType<EpRequestPort>>;
  try {
    res = await deps.request(request);
  } catch (err) {
    throw new Error(
      `Could not reach ${ctx.host} to read Custom API "${ctx.customApi}": ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (res.status < 200 || res.status >= 300) {
    throw mapEntriesError(res, { customApi: ctx.customApi, entry: ctx.entry });
  }

  return (res.body as { data?: unknown } | undefined)?.data;
}

/**
 * Fetches the entries of one Custom API. Returns the entries themselves —
 * Elastic Path's envelope is unwrapped, so the result binds straight to a
 * repeater. Custom fields arrive flat on each entry; `created_at` and
 * `updated_at` live under `meta.timestamps`.
 */
export async function queryEntries(
  opts: EntriesRequestOpts & EpClientCredentials,
  deps: QueryEntriesDeps = defaultDeps(opts)
): Promise<unknown[]> {
  const data = await read(buildEntriesRequest(opts), deps, opts);
  return Array.isArray(data) ? data : [];
}

/**
 * Fetches one entry, addressed by its id or by the value of the Custom API's
 * url-slug field. Returns the entry itself so a detail page binds directly to
 * its fields; a missing entry is an error rather than an empty render.
 */
export async function getEntry(
  opts: EntryRequestOpts & EpClientCredentials,
  deps: QueryEntriesDeps = defaultDeps(opts)
): Promise<unknown> {
  return (await read(buildEntryRequest(opts), deps, opts)) ?? null;
}

/**
 * Design-time only: samples one entry so the filter's hint can name the fields
 * a designer can filter on. Keyed by the store and Custom API alone, so typing
 * a filter or changing a limit does not re-sample.
 *
 * Studio calls the registered function with the query's arguments only, so this
 * receives the same shape and takes its deps the same way the queries do.
 */
export function sampleFieldsContext(
  opts?: Partial<EntriesRequestOpts & EpClientCredentials>,
  deps?: QueryEntriesDeps
): { dataKey: string; fetcher: () => Promise<{ fields: SampledField[] }> } {
  const { host, clientId, customApi } = opts ?? {};
  if (!host || !clientId || !customApi) {
    return { dataKey: "", fetcher: async () => ({ fields: [] }) };
  }

  return {
    dataKey: `epCms/sample/${host}/${clientId}/${customApi}`,
    fetcher: async () => {
      try {
        const entries = await queryEntries(
          { host, clientId, customApi, limit: 1 },
          deps ?? defaultDeps({ host, clientId })
        );
        return { fields: fieldsFromSample(entries) };
      } catch {
        // Best-effort: a Custom API the store has not exposed, or a store that
        // is unreachable, must leave the query editable rather than erroring.
        return { fields: [] };
      }
    },
  };
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
    // The hint is the only channel that can carry sampled data — helpText and
    // description are static strings in the registration contract — so the
    // field names land where the designer is typing the filter.
    defaultValueHint: (_args: unknown, ctx?: { fields?: SampledField[] }) =>
      filterHint(ctx?.fields ?? []),
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

/** Same store connection, then the one entry to read. */
const ENTRY_FIELDS = {
  host: ENTRY_QUERY_FIELDS.host,
  clientId: ENTRY_QUERY_FIELDS.clientId,
  customApi: ENTRY_QUERY_FIELDS.customApi,
  entry: {
    type: "string",
    displayName: "Entry",
    description:
      "The entry's id, or the value of the Custom API's url-slug field where it defines one.",
    helpText:
      "On a dynamic page, bind this to the route parameter — for example the page's slug.",
    required: true,
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
    fnContext: sampleFieldsContext,
  });

  register(getEntry, {
    name: "getEntry",
    namespace: "epCms",
    displayName: "Get Custom API Entry",
    description:
      "Fetch a single entry from an Elastic Path Commerce Extensions Custom API.",
    importPath: MODULE_PATH,
    isQuery: true,
    params: [
      {
        name: "opts",
        type: "object",
        display: "flatten",
        fields: ENTRY_FIELDS,
      },
    ],
  });
}
