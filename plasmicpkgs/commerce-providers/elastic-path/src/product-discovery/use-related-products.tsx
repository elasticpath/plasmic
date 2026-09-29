import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { epGetRelatedProducts } from "../ep-server-functions/getRelatedProducts";
import { SWR_DEDUPING_INTERVAL_LONG } from "../const";
import type { Product } from "../types/product";

export interface UseRelatedProductsOptions {
  productId?: string;
  relationshipSlug?: string;
  limit?: number;
  /** Only part of the cache key. The server uses the session locale. */
  locale?: string;
}

export interface UseRelatedProductsResult {
  products: Product[];
  /** The number of products returned, not the Elastic Path total. */
  totalCount: number;
  isLoading: boolean;
  /** A failed read returns an empty list, not an error. */
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

  const commerce = useEpCommerce();

  // Stable query key — null skips the fetch when missing required params
  const queryKey =
    commerce && productId && relationshipSlug
      ? ["ep-related-products", productId, relationshipSlug, limit, locale ?? ""]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    { products: Product[]; totalCount: number },
    Error
  >(
    queryKey,
    async () => {
      const products = await epGetRelatedProducts({
        productId: productId!,
        relationshipSlug: relationshipSlug!,
        limit,
      });
      // One page, and nothing paginates it, so what came back is all there is.
      return { products, totalCount: products.length };
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
