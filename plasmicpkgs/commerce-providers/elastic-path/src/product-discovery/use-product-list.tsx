import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { epGetProductPage } from "../ep-server-functions/getProductPage";
import type { Product } from "../types/product";

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

  // Stable query key — null skips the fetch
  const queryKey =
    commerce && !skip
      ? ["ep-product-list", categoryId ?? "", search ?? "", page, pageSize, locale ?? ""]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    { products: Product[]; totalCount: number },
    Error
  >(
    queryKey,
    async () => {
      const result = await epGetProductPage({
        limit: pageSize,
        offset: page * pageSize,
        search,
        categoryId,
      });
      return {
        products: result.data,
        totalCount: result.meta.results.total,
      };
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
