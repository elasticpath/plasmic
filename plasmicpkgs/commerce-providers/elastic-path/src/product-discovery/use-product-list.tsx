/**
 * Data-fetching hook for paginated product listing.
 *
 * Calls `getByContextAllProducts` from the EP SDK directly with pagination
 * support, rather than extending the upstream SearchProductsHook type (D1).
 * Uses `useMutablePlasmicQueryData` from @plasmicapp/query — the established
 * caching pattern in this codebase (D6).
 */

import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import {
  getByContextAllProducts,
  getByContextProductsForNode,
} from "@epcc-sdk/sdks-shopper";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { normalizeProductFromList } from "../utils";
import { handleAPIError } from "../utils/errorHandling";
import { createLogger } from "../utils/logger";
import type { Product } from "../types/product";

const log = createLogger("useProductList");

export interface UseProductListOptions {
  categoryId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  locale?: string;
  /**
   * Skips the fetch entirely, leaving the hook in a resolved-but-empty state.
   * `EPProductListProvider` sets this while a server-rendered seed is still
   * the displayed page, so the browser makes no duplicate request for data
   * the page already carries.
   */
  skip?: boolean;
}

export interface UseProductListResult {
  products: Product[];
  totalCount: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useProductList(options: UseProductListOptions): UseProductListResult {
  const {
    categoryId,
    search,
    page = 0,
    pageSize = 12,
    locale,
    skip = false,
  } = options;

  const commerce = useEpCommerce();
  const client = commerce?.client;
  const provider = commerce;

  // Stable query key — null skips the fetch
  const queryKey =
    client && !skip
      ? ["ep-product-list", categoryId ?? "", search ?? "", page, pageSize, locale ?? ""]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    { products: Product[]; totalCount: number },
    Error
  >(
    queryKey,
    async () => {
      const query: Record<string, unknown> = {
        include: ["main_image", "files", "component_products"],
        "page[limit]": BigInt(pageSize),
        "page[offset]": BigInt(page * pageSize),
      };

      // Elastic Path composes filter terms with a comma; `and(...)` is
      // rejected. There is no filterable category key, so a categoryId
      // selects the node endpoint below instead of adding a term here.
      if (search) {
        query["filter"] = `eq(name,${search})`;
      }

      try {
        const response = categoryId
          ? await getByContextProductsForNode({
              client: client!,
              path: { node_id: categoryId },
              query,
            })
          : await getByContextAllProducts({
              client: client!,
              query,
            });

        const products = response.data?.data
          ? response.data.data.map((product) =>
              normalizeProductFromList(
                product,
                provider?.locale ?? locale ?? "en",
                response.data?.included
              )
            )
          : [];

        // BigInt → Number conversion for total count
        const rawTotal = response.data?.meta?.results?.total;
        const totalCount = rawTotal != null ? Number(rawTotal) : products.length;

        return { products, totalCount };
      } catch (err) {
        const standardError = handleAPIError(err, "fetching product list");
        log.error("Error fetching product list", {
          error: standardError.message,
        } as Record<string, unknown>);
        throw standardError;
      }
    },
    {
      revalidateOnFocus: false,
    }
  );

  const result = useMemo(
    () => data ?? { products: [], totalCount: 0 },
    [data]
  );

  return {
    products: result.products,
    totalCount: result.totalCount,
    isLoading: skip ? false : isLoading ?? false,
    error: error ?? null,
    refetch: () => mutate(),
  };
}
