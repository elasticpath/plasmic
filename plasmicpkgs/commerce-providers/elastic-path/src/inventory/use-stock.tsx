import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { getStock } from "@epcc-sdk/sdks-shopper";
import { useCommerce } from "../elastic-path";
import type { ProductStock, UseStockOptions } from "./types";
import { createProductStock } from "./utils/stockCalculations";
import { handleAPIError } from "../utils/errorHandling";
import { createLogger } from "../utils/logger";

const log = createLogger("useStock");

export function useStock({
  productIds,
  locationIds,
  enabled = true,
}: UseStockOptions) {
  const commerce = useCommerce();
  const client = commerce.providerRef.current?.client;

  // Stable keys for SWR deduplication
  const productKey = productIds.slice().sort().join(",");
  const locationKey = locationIds?.slice().sort().join(",") ?? "";

  const queryKey =
    enabled && client && productIds.length > 0
      ? ["ep-stock", productKey, locationKey]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    Record<string, ProductStock>,
    Error
  >(
    queryKey,
    async () => {
      const stockMap: Record<string, ProductStock> = {};

      const stockResults = await Promise.all(
        productIds.map(async (productId) => {
          try {
            const response = await getStock({
              client: client!,
              path: { product_uuid: productId },
            });

            const stockData = response.data?.data;
            return {
              productId,
              productStock: createProductStock(
                productId,
                stockData,
                locationIds
              ),
            };
          } catch (err) {
            const error = handleAPIError(
              err,
              `fetching stock for product ${productId}`
            );
            log.warn(`Failed to fetch stock for product ${productId}`, {
              error: error.message,
            } as Record<string, unknown>);
            return {
              productId,
              productStock: {
                productId,
                locations: [],
                totalStock: 0,
                totalAllocated: 0,
                totalAvailable: 0,
              },
            };
          }
        })
      );

      for (const { productId, productStock } of stockResults) {
        stockMap[productId] = productStock;
      }

      return stockMap;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60 * 1000, // 1 minute
      onError: (err: Error) => {
        log.error("Error fetching stock", {
          error: err.message,
        } as Record<string, unknown>);
      },
    }
  );

  const productStock = useMemo(() => data ?? {}, [data]);

  return {
    productStock,
    loading: isLoading ?? false,
    error: error ?? null,
    refetch: () => mutate(),
  };
}

// Hook for getting stock for a single product
export function useProductStock(
  productId: string,
  locationIds?: string[],
  enabled = true
) {
  const { productStock, loading, error, refetch } = useStock({
    productIds: productId ? [productId] : [],
    locationIds,
    enabled: enabled && !!productId,
  });

  return {
    stock: productStock[productId] || null,
    loading,
    error,
    refetch,
  };
}
