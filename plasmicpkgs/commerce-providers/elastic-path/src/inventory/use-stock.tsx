import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { SWR_DEDUPING_INTERVAL_SHORT } from "../const";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { epGetStock } from "../ep-server-functions/getStock";
import type { ProductStock, UseStockOptions } from "./types";
import { createLogger } from "../utils/logger";

const log = createLogger("useStock");

export function useStock({
  productIds,
  locationIds,
  enabled = true,
}: UseStockOptions) {
  const commerce = useEpCommerce();

  // Stable keys for SWR deduplication
  const productKey = productIds.slice().sort().join(",");
  const locationKey = locationIds?.slice().sort().join(",") ?? "";

  const queryKey =
    enabled && commerce && productIds.length > 0
      ? ["ep-stock", productKey, locationKey]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    Record<string, ProductStock>,
    Error
  >(
    queryKey,
    async () => {
      const stock = await epGetStock({ productIds, locationIds });
      // Counts come back as `number`, not the SDK's `BigInt`, so they survive
      // JSON. Every reader coerces with `Number()`.
      return stock as unknown as Record<string, ProductStock>;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: SWR_DEDUPING_INTERVAL_SHORT,
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
