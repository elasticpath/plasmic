import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import type { ProductAttributes } from "@epcc-sdk/sdks-shopper";
import { SWR_DEDUPING_INTERVAL_SHORT } from "../const";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { epGetBaseProducts } from "../ep-server-functions/getBaseProducts";
import type { Product } from "../types/product";
import { ComponentProduct } from "./types";
import { createLogger } from "../utils/logger";

const log = createLogger("useParentProducts");

interface ParentProductInfo {
  id: string;
  isParent: boolean;
  children?: ChildProduct[];
  variations?: Array<{
    id: string;
    name: string;
    options?: Array<{
      id: string;
      name: string;
    }>;
  }>;
  variationMatrix?: Record<string, unknown>;
  loading: boolean;
  error?: Error;
}

interface ChildProduct {
  id: string;
  name?: string;
  sku?: string;
  price?: string;
  attributes?: ProductAttributes;
  excluded?: boolean; // Whether this variation is excluded from bundle
}

interface UseParentProductsOptions {
  components: Record<string, ComponentProduct>;
  enabled?: boolean;
}

function isParentProduct(product: Product): boolean {
  const children = (product.relationships as
    | { children?: { data?: unknown[] } }
    | undefined)?.children?.data;
  return (
    (Array.isArray(children) && children.length > 0) ||
    product.attributes?.base_product === true
  );
}

function toParentProductInfo(product: Product): ParentProductInfo {
  return {
    id: product.id!,
    isParent: isParentProduct(product),
    loading: false,
    children: product.childProducts.map((child) => ({
      id: child.id,
      name: child.name,
      sku: child.sku,
      price: child.price?.formatted,
      excluded: child.bundleExcluded,
    })),
    variations: product.variations.map((variation) => ({
      id: variation.id,
      name: variation.name,
      options: variation.options.map((option) => ({
        id: option.id,
        name: option.name,
      })),
    })),
    variationMatrix: product.meta?.variation_matrix as
      | Record<string, unknown>
      | undefined,
  };
}

export function useParentProducts({
  components,
  enabled = true,
}: UseParentProductsOptions) {
  const commerce = useEpCommerce();

  // Stable sorted key from component option IDs for SWR deduplication
  const sortedProductIds = useMemo(() => {
    const productIds = new Set<string>();
    Object.values(components).forEach((component) => {
      component.options?.forEach((option) => {
        if (option.id && option.type === "product") {
          productIds.add(option.id);
        }
      });
    });
    return Array.from(productIds).sort().join(",");
  }, [components]);

  const queryKey =
    enabled && commerce && sortedProductIds.length > 0
      ? ["ep-parent-products", sortedProductIds]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    Record<string, ParentProductInfo>,
    Error
  >(
    queryKey,
    async () => {
      const productIdsArray = sortedProductIds.split(",");
      const products = await epGetBaseProducts({
        productIds: productIdsArray,
      });

      const parentProductMap: Record<string, ParentProductInfo> = {};
      for (const product of Object.values(products)) {
        if (product?.id) {
          parentProductMap[product.id] = toParentProductInfo(product);
        }
      }

      // Handle missing products (e.g., deleted products)
      productIdsArray.forEach((productId) => {
        if (!parentProductMap[productId]) {
          parentProductMap[productId] = {
            id: productId,
            isParent: false,
            loading: false,
            error: new Error(`Product ${productId} not found`),
          };
        }
      });

      return parentProductMap;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: SWR_DEDUPING_INTERVAL_SHORT,
      onError: (err: Error) => {
        log.error("Error fetching parent products", {
          error: err.message,
        } as Record<string, unknown>);
      },
    }
  );

  const parentProducts = useMemo(() => data ?? {}, [data]);

  return {
    parentProducts,
    loading: isLoading ?? false,
    error: error ?? null,
    refetch: () => mutate(),
  };
}

export type { ParentProductInfo, ChildProduct };
