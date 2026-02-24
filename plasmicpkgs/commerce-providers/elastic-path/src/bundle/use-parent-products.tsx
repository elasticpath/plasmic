import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { getByContextAllProducts, getByContextChildProducts } from "@epcc-sdk/sdks-shopper";
import type { ProductAttributes, Variation, VariationOption } from "@epcc-sdk/sdks-shopper";
import { useCommerce } from "../elastic-path";
import { ComponentProduct } from "./types";
import { handleAPIError } from "../utils/errorHandling";
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

/**
 * Fetches parent product information and child variations using SWR caching.
 *
 * Two-phase fetch: first determines which products are parents (have children/variations),
 * then fetches child products for each parent. Both phases run within a single SWR fetch
 * so the consumer sees one loading→loaded transition instead of intermediate states.
 */
export function useParentProducts({
  components,
  enabled = true,
}: UseParentProductsOptions) {
  const commerce = useCommerce();
  const client = commerce.providerRef.current?.client;

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
    enabled && client && sortedProductIds.length > 0
      ? ["ep-parent-products", sortedProductIds]
      : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    Record<string, ParentProductInfo>,
    Error
  >(
    queryKey,
    async () => {
      const productIdsArray = sortedProductIds.split(",");
      const parentProductMap: Record<string, ParentProductInfo> = {};

      // Phase 1: Bulk fetch all products to determine which are parents
      const batchSize = 100;
      const batches: string[][] = [];
      for (let i = 0; i < productIdsArray.length; i += batchSize) {
        batches.push(productIdsArray.slice(i, i + batchSize));
      }

      const batchResults = await Promise.all(
        batches.map(async (batchIds) => {
          const response = await getByContextAllProducts({
            client: client!,
            query: {
              filter: `in(id,${batchIds.join(",")})`,
              include: ["main_image"],
              "page[limit]": BigInt(batchIds.length),
            },
          });
          return response.data?.data || [];
        })
      );

      const allProducts = batchResults.flat();
      const parentIds: string[] = [];

      allProducts.forEach((product) => {
        if (product && product.id) {
          const hasChildren =
            product.relationships?.children?.data &&
            product.relationships.children.data.length > 0;
          const isParent =
            hasChildren || product.attributes?.base_product === true;

          parentProductMap[product.id] = {
            id: product.id,
            isParent: Boolean(isParent),
            loading: false,
            children: [],
            variations: (product.meta?.variations || [])
              .filter((v: Variation) => v.id && v.name)
              .map((v: Variation) => ({
                id: v.id!,
                name: v.name!,
                options: v.options
                  ?.filter((o: VariationOption) => o.id && o.name)
                  .map((o: VariationOption) => ({ id: o.id!, name: o.name! })),
              })),
            variationMatrix: product.meta?.variation_matrix,
          };

          if (isParent) {
            parentIds.push(product.id);
          }
        }
      });

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

      // Phase 2: Fetch children for parent products
      const childResults = await Promise.all(
        parentIds.map(async (productId) => {
          try {
            const childrenResponse = await getByContextChildProducts({
              client: client!,
              path: { product_id: productId },
              query: { include: ["main_image"] },
            });

            const children: ChildProduct[] =
              childrenResponse.data?.data?.map((child) => ({
                id: child.id || "",
                name: child.attributes?.name,
                sku: child.attributes?.sku,
                price: child.meta?.display_price?.without_tax?.formatted,
                attributes: child.attributes,
                // bundle_excluded is an EP custom field not in the SDK types
                excluded:
                  (child.meta as Record<string, unknown> | undefined)?.bundle_excluded === true ||
                  (child.attributes as Record<string, unknown> | undefined)?.bundle_excluded === true,
              })) || [];

            log.debug(`Found ${children.length} children for parent ${productId}`);
            return { productId, children, error: undefined as Error | undefined };
          } catch (err) {
            const apiError = handleAPIError(err, `fetching children for ${productId}`);
            log.warn(`Failed to fetch children for ${productId}`, {
              error: apiError.message,
            } as Record<string, unknown>);
            return {
              productId,
              children: [] as ChildProduct[],
              error: new Error(apiError.message),
            };
          }
        })
      );

      // Merge children into parent product map
      childResults.forEach(({ productId, children, error: childError }) => {
        if (parentProductMap[productId]) {
          parentProductMap[productId] = {
            ...parentProductMap[productId],
            children,
            error: childError,
          };
        }
      });

      return parentProductMap;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60 * 1000, // 1 minute
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
