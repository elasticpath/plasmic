import { getStock, listLocations } from "@epcc-sdk/sdks-shopper";
import {
  calculateTotalStock,
  filterStockByLocation,
} from "../inventory/utils/stockCalculations";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { batchIds } from "./product-batches";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import { getCurrentEpSession } from "./session-context";

/**
 * This holds the counts of one product at one inventory location.
 *
 * It has the same shape as the package's `LocationStock`, but the counts are
 * `number`, not the SDK's `BigInt`. `JSON.stringify` converts this value when
 * it goes through `/api/ep/proxy` and when the loader puts it into prefetched
 * query data. `JSON.stringify` throws an error on a `BigInt`.
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

// The locations list returns at most 100 locations in a page, so one request
// asks for at most 100 slugs.
const SLUGS_PER_REQUEST = 100;

/**
 * If a request fails, its locations are not in the map, so that the stock
 * read does not fail too.
 */
async function readLocationNames(
  client: ReturnType<typeof buildEpClient>,
  slugs: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all(
    batchIds(slugs, SLUGS_PER_REQUEST).map(async (batch) => {
      const response = await listLocations({
        client,
        query: {
          // Each slug goes in quotes, because a slug can contain brackets
          // that break the filter.
          filter: `in(slug,${batch.map((slug) => `"${slug}"`).join(",")})`,
          "page[limit]": batch.length,
        },
      }).catch(() => null);
      for (const location of response?.data?.data ?? []) {
        const slug = location?.attributes?.slug;
        const name = location?.attributes?.name;
        if (slug && name) {
          names.set(slug, name);
        }
      }
    })
  );
  return names;
}

/**
 * Elastic Path returns stock as a map from location slug to counts. It gives
 * no other data about the location.
 */
function readCounts(stockData: unknown): Record<string, unknown> {
  const locations = (stockData as { attributes?: { locations?: unknown } })
    ?.attributes?.locations;
  if (!locations || typeof locations !== "object") {
    return {};
  }
  return locations as Record<string, unknown>;
}

function readLocations(
  productId: string,
  countsBySlug: Record<string, unknown>,
  names: Map<string, string>
): EpLocationStock[] {
  return Object.entries(countsBySlug).map(([slug, counts]) => {
    const c = (counts ?? {}) as Record<string, unknown>;
    return {
      location: {
        id: slug,
        type: "inventory_location",
        attributes: { name: names.get(slug) ?? slug, slug },
      },
      stock: {
        productId,
        available: toCount(c.available),
        allocated: toCount(c.allocated),
        total: toCount(c.total),
      },
    };
  });
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
}: EpGetStockInput): Promise<Record<string, EpProductStock>> {
  const ids = (productIds ?? []).filter(Boolean);
  if (ids.length === 0) return {};
  const auth = getCurrentEpSession();

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

  const reads = await Promise.all(
    ids.map(async (productId) => {
      try {
        const response = await getStock({
          client,
          path: { product_uuid: productId },
        });
        return { productId, countsBySlug: readCounts(response.data?.data) };
      } catch {
        return { productId, countsBySlug: null };
      }
    })
  );

  const slugs = new Set(
    reads.flatMap(({ countsBySlug }) => Object.keys(countsBySlug ?? {}))
  );
  const names = await readLocationNames(client, Array.from(slugs));

  const stockMap: Record<string, EpProductStock> = {};
  for (const { productId, countsBySlug } of reads) {
    stockMap[productId] = countsBySlug
      ? aggregate(
          productId,
          readLocations(productId, countsBySlug, names),
          locationIds
        )
      : emptyStock(productId);
  }
  return stockMap;
}
