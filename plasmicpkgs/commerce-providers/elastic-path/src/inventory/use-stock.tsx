import { useEffect, useState, useMemo } from "react";
import { getStock } from "@epcc-sdk/sdks-shopper";
import { useCommerce } from "../elastic-path";
import type { ProductStock, LocationStock, UseStockOptions } from "./types";
import { createProductStock } from "./utils/stockCalculations";
import { handleAPIError } from "../utils/errorHandling";

export function useStock({
  productIds,
  locationIds,
  enabled = true,
}: UseStockOptions) {
  const [productStock, setProductStock] = useState<Record<string, ProductStock>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const commerce = useCommerce();

  // Memoize the arrays to prevent infinite re-renders
  const memoizedProductIds = useMemo(() => productIds, [productIds.join(',')]);
  const memoizedLocationIds = useMemo(() => locationIds, [locationIds?.join(',')]);

  useEffect(() => {
    if (!enabled || !commerce.providerRef.current?.client || memoizedProductIds.length === 0) {
      return;
    }

    const fetchStock = async () => {
      setLoading(true);
      setError(null);

      try {
        const stockMap: Record<string, ProductStock> = {};

        // Fetch stock for each product (one API call per product)
        const stockPromises = memoizedProductIds.map(async (productId) => {
          try {
            const response = await getStock({
              client: commerce.providerRef.current.client,
              path: {
                product_uuid: productId,
              },
            });

            const stockData = response.data?.data;
            const productStock = createProductStock(productId, stockData, memoizedLocationIds);

            return {
              productId,
              productStock,
            };
          } catch (err) {
            const error = handleAPIError(err, `fetching stock for product ${productId}`);
            console.warn(`Failed to fetch stock for product ${productId}:`, error);
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
        });

        const stockResults = await Promise.all(stockPromises);
        
        stockResults.forEach(({ productId, productStock }) => {
          stockMap[productId] = productStock;
        });

        setProductStock(stockMap);
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to fetch stock data");
        setError(error);
        console.error("Error fetching stock:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStock();
  }, [memoizedProductIds, memoizedLocationIds, enabled, commerce]);

  return {
    productStock,
    loading,
    error,
    refetch: () => {
      if (enabled && commerce.providerRef.current?.client && memoizedProductIds.length > 0) {
        setLoading(true);
        setError(null);
      }
    },
  };
}

// Hook for getting stock for a single product
export function useProductStock(productId: string, locationIds?: string[], enabled = true) {
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