import { getStock } from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import type { EpServerAuth } from "./types";

/**
 * One inventory location's counts for one product.
 *
 * The counts are `number`, not the SDK's `BigInt`: this value crosses
 * `JSON.stringify` on the way through `/api/ep/proxy` and into the loader's
 * prefetched query data, and a BigInt cannot cross it.
 */
export interface EpLocationStock {
  location: {
    id: string;
    type: string;
    attributes: { name: string; slug: string };
  };
  available: number;
  allocated: number;
  total: number;
}

export interface EpProductStock {
  productId: string;
  locations: EpLocationStock[];
  totalAvailable: number;
  totalAllocated: number;
  totalStock: number;
}

export interface EpGetStockInput {
  productIds: string[];
  /** Location ids or slugs to narrow to. Omitted means every location. */
  locationIds?: string[];
  /** SSR-only explicit auth. Never advertised; never bind in Studio. */
  auth?: EpServerAuth;
}

function emptyStock(productId: string): EpProductStock {
  return {
    productId,
    locations: [],
    totalAvailable: 0,
    totalAllocated: 0,
    totalStock: 0,
  };
}

function toCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function readLocations(stockData: unknown): EpLocationStock[] {
  const locations = (stockData as { attributes?: { locations?: unknown } })
    ?.attributes?.locations;
  if (!locations || typeof locations !== "object") return [];
  return Object.entries(locations as Record<string, unknown>).map(
    ([slug, counts]) => {
      const c = (counts ?? {}) as Record<string, unknown>;
      return {
        location: {
          id: slug,
          type: "inventory_location",
          attributes: { name: slug, slug },
        },
        available: toCount(c.available),
        allocated: toCount(c.allocated),
        total: toCount(c.total),
      };
    }
  );
}

function narrow(
  locations: EpLocationStock[],
  locationIds?: string[]
): EpLocationStock[] {
  if (!locationIds || locationIds.length === 0) return locations;
  return locations.filter(
    (ls) =>
      locationIds.includes(ls.location.id) ||
      locationIds.includes(ls.location.attributes.slug)
  );
}

function aggregate(
  productId: string,
  locations: EpLocationStock[]
): EpProductStock {
  const totals = locations.reduce(
    (acc, ls) => ({
      totalAvailable: acc.totalAvailable + ls.available,
      totalAllocated: acc.totalAllocated + ls.allocated,
      totalStock: acc.totalStock + ls.total,
    }),
    { totalAvailable: 0, totalAllocated: 0, totalStock: 0 }
  );
  return { productId, locations, ...totals };
}

/**
 * Multi-location stock for a set of products, keyed by product id.
 *
 * A product whose stock read fails gets an all-zero entry rather than
 * failing the batch — one unstocked product must not blank a whole listing.
 */
export async function epGetStock({
  productIds,
  locationIds,
  auth: inputAuth,
}: EpGetStockInput): Promise<Record<string, EpProductStock>> {
  const ids = (productIds ?? []).filter(Boolean);
  if (ids.length === 0) return {};
  const auth = getCurrentEpSession() ?? inputAuth;

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return (
      (await callEpProxy<Record<string, EpProductStock> | null>(
        "getStock",
        { productIds: ids, locationIds },
        null
      )) ?? {}
    );
  }

  if (!isUsableAuth(auth)) return {};
  const client = buildEpClient(auth);
  // Without this header Elastic Path answers with single-location stock,
  // which carries no `attributes.locations` map at all.
  client.interceptors.request.use(async (request: Request) => {
    request.headers.set("EP-Inventories-Multi-Location", "true");
    return request;
  });

  const entries = await Promise.all(
    ids.map(async (productId) => {
      try {
        const response = await getStock({
          client,
          path: { product_uuid: productId },
        });
        return aggregate(
          productId,
          narrow(readLocations(response.data?.data), locationIds)
        );
      } catch {
        return emptyStock(productId);
      }
    })
  );

  const stockMap: Record<string, EpProductStock> = {};
  for (const entry of entries) stockMap[entry.productId] = entry;
  return stockMap;
}
