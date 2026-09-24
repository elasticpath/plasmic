import { getStock } from "@epcc-sdk/sdks-shopper";
import {
  calculateTotalStock,
  filterStockByLocation,
} from "../inventory/utils/stockCalculations";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import type { EpServerAuth } from "./types";

/**
 * One inventory location's counts for one product.
 *
 * Structurally the browser client's `LocationStock`, with one departure: the
 * counts are `number`, not the SDK's `BigInt`. This value crosses
 * `JSON.stringify` on the way through `/api/ep/proxy` and into the loader's
 * prefetched query data, and a BigInt cannot cross it.
 */
export interface EpLocationStock {
  location: {
    id: string;
    type: string;
    attributes: { name: string; slug: string };
  };
  stock: {
    productId: string;
    available: number;
    allocated: number;
    total: number;
  };
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

/**
 * Elastic Path reports multi-location stock as a slug-keyed map with no
 * location metadata on it, so the location is reconstructed from the slug —
 * same synthetic shape the browser client builds, names included later.
 */
function readLocations(
  productId: string,
  stockData: unknown
): EpLocationStock[] {
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
        stock: {
          productId,
          available: toCount(c.available),
          allocated: toCount(c.allocated),
          total: toCount(c.total),
        },
      };
    }
  );
}

function aggregate(
  productId: string,
  locations: EpLocationStock[],
  locationIds?: string[]
): EpProductStock {
  const all: EpProductStock = {
    productId,
    locations,
    ...calculateTotalStock(locations as never),
  };
  return filterStockByLocation(all as never, locationIds ?? []) as never;
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

  const entries = await Promise.all(
    ids.map(async (productId) => {
      try {
        const response = await getStock({
          client,
          path: { product_uuid: productId },
        });
        return aggregate(
          productId,
          readLocations(productId, response.data?.data),
          locationIds
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
