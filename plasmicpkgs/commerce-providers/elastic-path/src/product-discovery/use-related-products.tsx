/**
 * Data-fetching hook for related products via EP Custom Relationships API.
 *
 * Calls `getByContextAllRelatedProducts` from the EP SDK to fetch products
 * related to a given product by custom relationship slug (e.g., "CRP_related_products",
 * "CRP_upsell", "CRP_accessories").
 *
 * Uses `useMutablePlasmicQueryData` from @plasmicapp/query — the established
 * caching pattern in this codebase (D6). Uses long deduping interval since
 * relationships change infrequently.
 */

import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { getByContextAllRelatedProducts } from "@epcc-sdk/sdks-shopper";
import { useCommerce } from "../elastic-path";
import { normalizeProductFromList } from "../utils";
import { handleAPIError } from "../utils/errorHandling";
import { createLogger } from "../utils/logger";
import { SWR_DEDUPING_INTERVAL_LONG } from "../const";
import type { Product } from "../types/product";

const log = createLogger("useRelatedProducts");

export interface UseRelatedProductsOptions {
  productId?: string;
  relationshipSlug?: string;
  limit?: number;
  locale?: string;
}

export interface UseRelatedProductsResult {
  products: Product[];
  totalCount: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useRelatedProducts(
  options: UseRelatedProductsOptions
): UseRelatedProductsResult {
  const {
    productId,
    relationshipSlug,
    limit = 4,
    locale,
  } = options;

  const commerce = useCommerce();
  const client = commerce.providerRef.current?.client;
  const provider = commerce.providerRef.current;

  // Stable query key — null skips the fetch when missing required params
  const queryKey =
    client && productId && relationshipSlug
      ? ["ep-related-products", productId, relationshipSlug, limit, locale ?? ""]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    { products: Product[]; totalCount: number },
    Error
  >(
    queryKey,
    async () => {
      try {
        const response = await getByContextAllRelatedProducts({
          client: client!,
          path: {
            product_id: productId!,
            custom_relationship_slug: relationshipSlug!,
          },
          query: {
            "page[limit]": BigInt(limit),
          },
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
        const standardError = handleAPIError(err, "fetching related products");
        log.error("Error fetching related products", {
          error: standardError.message,
        } as Record<string, unknown>);
        throw standardError;
      }
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: SWR_DEDUPING_INTERVAL_LONG,
    }
  );

  const result = useMemo(
    () => data ?? { products: [], totalCount: 0 },
    [data]
  );

  return {
    products: result.products,
    totalCount: result.totalCount,
    isLoading: isLoading ?? false,
    error: error ?? null,
    refetch: () => mutate(),
  };
}
