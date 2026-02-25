import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { getByContextAllProducts } from "@epcc-sdk/sdks-shopper";
import { SWR_DEDUPING_INTERVAL_SHORT } from "../const";
import { useCommerce } from "../elastic-path";
import { ComponentProduct } from "./types";
import { handleAPIError } from "../utils/errorHandling";
import { createLogger } from "../utils/logger";

const log = createLogger("useBundleOptionProducts");

interface UseBundleOptionProductsOptions {
  components: Record<string, ComponentProduct>;
  parentProducts?: Record<string, { children?: { id: string }[] }>;
  enabled?: boolean;
}

export interface OptionProduct {
  id: string;
  name?: string;
  description?: string;
  image?: string;
  price?: string;
  sku?: string;
}

/**
 * Fetches product metadata (name, image, price, SKU) for all bundle option products
 * using SWR caching. Includes child product IDs when parent product data is available.
 *
 * The query key incorporates both direct option IDs and child IDs from parent products,
 * so the cache automatically refreshes when parent product children become available.
 */
export function useBundleOptionProducts({
  components,
  parentProducts = {},
  enabled = true,
}: UseBundleOptionProductsOptions) {
  const commerce = useCommerce();
  const client = commerce.providerRef.current?.client;

  // Compute all product IDs to fetch (direct options + parent product children)
  // Sorted for stable SWR deduplication key
  const sortedProductIds = useMemo(() => {
    const productIds = new Set<string>();
    Object.values(components).forEach((component) => {
      component.options?.forEach((option) => {
        if (option.id && option.type === "product") {
          productIds.add(option.id);

          // Include child product IDs if this option is a parent product
          const parentInfo = parentProducts[option.id];
          if (parentInfo?.children) {
            parentInfo.children.forEach((child) => {
              if (child.id) {
                productIds.add(child.id);
              }
            });
          }
        }
      });
    });
    return Array.from(productIds).sort().join(",");
  }, [components, parentProducts]);

  const queryKey =
    enabled && client && sortedProductIds.length > 0
      ? ["ep-bundle-option-products", sortedProductIds]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    Record<string, OptionProduct>,
    Error
  >(
    queryKey,
    async () => {
      const productIdsArray = sortedProductIds.split(",");
      const productMap: Record<string, OptionProduct> = {};

      // Batch fetch products (EP supports ~200 IDs per filter)
      const batchSize = 100;
      const batches: string[][] = [];
      for (let i = 0; i < productIdsArray.length; i += batchSize) {
        batches.push(productIdsArray.slice(i, i + batchSize));
      }

      const batchResults = await Promise.all(
        batches.map(async (batchIds) => {
          try {
            const response = await getByContextAllProducts({
              client: client!,
              query: {
                filter: `in(id,${batchIds.join(",")})`,
                include: ["main_image"],
                "page[limit]": BigInt(batchIds.length),
              },
            });
            return response.data?.data || [];
          } catch (err) {
            const apiError = handleAPIError(err, "fetching bundle option products batch");
            log.error("Failed to fetch products in bulk", {
              error: apiError.message,
            } as Record<string, unknown>);
            return [];
          }
        })
      );

      batchResults.flat().forEach((product) => {
        if (product && product.id) {
          productMap[product.id] = {
            id: product.id,
            name: product.attributes?.name,
            description: product.attributes?.description,
            image: product.relationships?.main_image?.data?.id,
            price: product.meta?.display_price?.without_tax?.formatted,
            sku: product.attributes?.sku,
          };
        }
      });

      return productMap;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: SWR_DEDUPING_INTERVAL_SHORT,
      onError: (err: Error) => {
        log.error("Error fetching bundle option products", {
          error: err.message,
        } as Record<string, unknown>);
      },
    }
  );

  const products = useMemo(() => data ?? {}, [data]);

  return {
    products,
    loading: isLoading ?? false,
    error: error ?? null,
    refetch: () => mutate(),
  };
}
