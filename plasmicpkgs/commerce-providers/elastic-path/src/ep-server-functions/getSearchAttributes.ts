import { callEpDesign } from "./design-fetch";
import { currentEpDesignRealm } from "./design-realm";
import { isUsableAuth } from "./ep-client";
import { epMultiSearchWithAuth } from "./multiSearch";
import { getCurrentEpSession } from "./session-context";
import type { EpServerAuth } from "./types";

/** A field the store's catalog search can facet on, as a filter attribute. */
export interface SearchAttribute {
  path: string;
  numeric: boolean;
}

interface FacetCount {
  field_name?: unknown;
  stats?: { min?: unknown };
}

type SearchResult = { facet_counts?: FacetCount[]; hits?: unknown[] };
type PlainObject = Record<string, unknown>;

const SAMPLE_PRODUCTS = 10;
const MAX_KEY_PROBES = 20;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFacets(result: SearchResult | undefined): Map<string, boolean> {
  const fields = new Map<string, boolean>();
  for (const f of result?.facet_counts ?? []) {
    if (typeof f.field_name !== "string") continue;
    const numeric = typeof f.stats?.min === "number";
    fields.set(f.field_name, (fields.get(f.field_name) ?? false) || numeric);
  }
  return fields;
}

function splitHead(path: string): [string, string] | null {
  const dot = path.indexOf(".");
  return dot > 0 ? [path.slice(0, dot), path.slice(dot + 1)] : null;
}

/**
 * The keys of a keyed field (e.g. `price` keyed by currency) when `path` names
 * it with the key dropped, as a wildcard facet request reports it.
 */
function droppedKeys(documents: PlainObject[], path: string): string[] {
  const parts = splitHead(path);
  if (!parts) return [];
  const [head, rest] = parts;
  const next = rest.split(".")[0];
  const keys = new Set<string>();
  for (const doc of documents) {
    const attributes = isPlainObject(doc.attributes) ? doc.attributes : {};
    const field = doc[head] ?? attributes[head];
    if (!isPlainObject(field) || next in field) continue;
    const entries = Object.entries(field);
    if (entries.length === 0 || !entries.every(([, v]) => isPlainObject(v))) {
      continue;
    }
    entries.forEach(([key]) => keys.add(key));
  }
  return [...keys];
}

async function resolveDroppedKeys(
  auth: EpServerAuth,
  collapsed: Map<string, string[]>
): Promise<Map<string, string[]>> {
  const probes = new Map<string, { head: string; key: string }>();
  for (const [path, keys] of collapsed) {
    const [head] = splitHead(path)!;
    keys.forEach((key) => probes.set(`${head}.${key}`, { head, key }));
  }
  const prefixes = [...probes.keys()].slice(0, MAX_KEY_PROBES);
  const resolved = new Map<string, string[]>();
  if (prefixes.length === 0) return resolved;

  let results: SearchResult[];
  try {
    const data = await epMultiSearchWithAuth(auth, {
      searches: prefixes.map((prefix) => ({
        type: "search",
        q: "*",
        per_page: 0,
        facet_by: `${prefix}.*`,
        max_facet_values: 1,
      })),
    });
    results = (data.results ?? []) as SearchResult[];
  } catch {
    return resolved;
  }

  prefixes.forEach((prefix, i) => {
    const { head, key } = probes.get(prefix)!;
    const reported = readFacets(results[i]);
    for (const [path] of collapsed) {
      const [pathHead, rest] = splitHead(path)!;
      if (pathHead !== head || !reported.has(path)) continue;
      resolved.set(path, [...(resolved.get(path) ?? []), `${head}.${key}.${rest}`]);
    }
  });
  return resolved;
}

/**
 * Lists the fields the store's catalog search can filter on. Design time only:
 * it feeds the filter components' attribute dropdowns in Studio.
 */
export async function epGetSearchAttributes(): Promise<SearchAttribute[]> {
  const auth = getCurrentEpSession();
  if (!isUsableAuth(auth)) return [];

  const data = await epMultiSearchWithAuth(auth, {
    searches: [
      {
        type: "search",
        q: "*",
        per_page: SAMPLE_PRODUCTS,
        facet_by: "*",
        max_facet_values: 1,
      },
    ],
  });
  const result = data.results?.[0] as SearchResult | undefined;
  const fields = readFacets(result);
  const documents = (result?.hits ?? [])
    .map((hit) => (isPlainObject(hit) ? hit.document : undefined))
    .filter(isPlainObject);

  const collapsed = new Map<string, string[]>();
  for (const [path] of fields) {
    const keys = droppedKeys(documents, path);
    if (keys.length > 0) collapsed.set(path, keys);
  }
  const resolved = await resolveDroppedKeys(auth, collapsed);

  const attributes: SearchAttribute[] = [];
  for (const [path, numeric] of fields) {
    for (const named of resolved.get(path) ?? [path]) {
      attributes.push({ path: named, numeric });
    }
  }
  return attributes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The browser side: asks the design-time route, and only from Studio. A live
 * page has no design realm and asks nothing.
 */
export async function requestDesignSearchAttributes(): Promise<
  SearchAttribute[] | null
> {
  const realm = currentEpDesignRealm();
  if (!realm) return null;
  const attributes = await callEpDesign<SearchAttribute[] | null>(
    "getSearchAttributes",
    {},
    null,
    realm
  );
  return Array.isArray(attributes) ? attributes : null;
}
