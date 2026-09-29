import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { SWR_DEDUPING_INTERVAL_SHORT } from "../const";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { epGetBundleOptionProducts } from "../ep-server-functions/getBundleOptionProducts";
import type { Product } from "../types/product";
import { ComponentProduct } from "./types";

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

function toOptionProduct(product: Product): OptionProduct {
  return {
    id: product.id!,
    name: product.attributes?.name,
    description: product.attributes?.description,
    // The main image, or the first file if there is no main image.
    image: product.images?.[0]?.url,
    price: product.meta?.display_price?.without_tax?.formatted,
    sku: product.attributes?.sku,
  };
}

/**
 * The query key carries both the direct option IDs and the child IDs of any
 * parent products, so the cache refreshes once those children arrive.
 */
export function useBundleOptionProducts({
  components,
  parentProducts = {},
  enabled = true,
}: UseBundleOptionProductsOptions) {
  const commerce = useEpCommerce();

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
    enabled && commerce && sortedProductIds.length > 0
      ? ["ep-bundle-option-products", sortedProductIds]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    Record<string, OptionProduct>,
    Error
  >(
    queryKey,
    async () => {
      const products = await epGetBundleOptionProducts({
        productIds: sortedProductIds.split(","),
      });

      const productMap: Record<string, OptionProduct> = {};
      for (const product of Object.values(products)) {
        if (product?.id) {
          productMap[product.id] = toOptionProduct(product);
        }
      }
      return productMap;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: SWR_DEDUPING_INTERVAL_SHORT,
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
