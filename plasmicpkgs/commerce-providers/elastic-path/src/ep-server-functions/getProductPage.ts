import {
  getByContextAllProducts,
  getByContextProductsForNode,
} from "@epcc-sdk/sdks-shopper";
import { normalizeProductFromList } from "../utils/normalize";
import { getSortVariables } from "../utils";
import type { Product } from "../types/product";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import type { EpServerAuth } from "./types";

const DEFAULT_LIMIT = 25;

/**
 * One page of products, in Elastic Path's own envelope (ADR-0002).
 *
 * `meta` mirrors the shape Elastic Path's docs describe, with one deliberate
 * departure: the counts are `number`, not the SDK's `BigInt`. A BigInt cannot
 * cross `JSON.stringify`, and this value crosses it twice — once into the
 * loader's prefetched query data, once through the `/api/ep/proxy` route.
 */
export interface EpProductPage {
  data: Product[];
  meta: {
    results: { total: number };
    page: { limit: number; offset: number };
  };
}

export interface EpGetProductPageInput {
  /** Page size. Defaults to 25 (EP default). */
  limit?: number;
  /** Zero-based record offset. Defaults to 0. */
  offset?: number;
  /** Search query applied against product name. */
  search?: string;
  /** Products of one hierarchy node (a category), by node ID. */
  categoryId?: string | number;
  /** Sort key understood by the shared `getSortVariables` helper. */
  sort?: string;
  /** SSR-only explicit auth. Never advertised; never bind in Studio. */
  auth?: EpServerAuth;
}

function emptyPage(limit: number, offset: number): EpProductPage {
  return { data: [], meta: { results: { total: 0 }, page: { limit, offset } } };
}

/** BigInt | number | undefined -> number, since EP types these as BigInt. */
function toCount(value: unknown, fallback: number): number {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function epGetProductPage({
  limit,
  offset,
  search,
  categoryId,
  sort,
  auth: inputAuth,
}: EpGetProductPageInput = {}): Promise<EpProductPage> {
  const pageLimit = limit && limit > 0 ? limit : DEFAULT_LIMIT;
  const pageOffset = offset && offset > 0 ? offset : 0;
  const auth = getCurrentEpSession() ?? inputAuth;

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return callEpProxy<EpProductPage>(
      "getProductPage",
      { limit: pageLimit, offset: pageOffset, search, categoryId, sort },
      emptyPage(pageLimit, pageOffset)
    );
  }

  if (!isUsableAuth(auth)) return emptyPage(pageLimit, pageOffset);
  const client = buildEpClient(auth);

  const query: Record<string, unknown> = {
    include: ["main_image", "files", "component_products"],
    "page[limit]": pageLimit,
    "page[offset]": pageOffset,
  };

  // Elastic Path's catalog filter grammar composes terms with a comma, not
  // `and(...)` — the catalog endpoints reject `and(...)` outright. There is no
  // filterable category key either, so `categoryId` selects the endpoint below
  // rather than adding a term here.
  const filters: string[] = [];
  if (search) filters.push(`eq(name,${search})`);
  if (filters.length > 0) query["filter"] = filters.join(",");

  if (sort) {
    const sortVariable = getSortVariables(sort);
    if (sortVariable) query["sort"] = sortVariable;
  }

  try {
    const response = categoryId
      ? await getByContextProductsForNode({
          client,
          path: { node_id: String(categoryId) },
          query: query as any,
        })
      : await getByContextAllProducts({
          client,
          query: query as any,
        });
    const rows = response.data?.data;
    if (!Array.isArray(rows)) return emptyPage(pageLimit, pageOffset);

    const data = rows.map((p: any) =>
      normalizeProductFromList(
        p,
        auth.locale ?? "en-US",
        response.data?.included
      )
    );

    return {
      data,
      meta: {
        results: {
          total: toCount(response.data?.meta?.results?.total, data.length),
        },
        page: {
          limit: toCount(response.data?.meta?.page?.limit, pageLimit),
          offset: toCount(response.data?.meta?.page?.offset, pageOffset),
        },
      },
    };
  } catch {
    return emptyPage(pageLimit, pageOffset);
  }
}
