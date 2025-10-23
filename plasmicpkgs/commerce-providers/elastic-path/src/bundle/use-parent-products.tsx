import { useEffect, useState } from "react";
import { getByContextProduct, getByContextChildProducts } from "@epcc-sdk/sdks-shopper";
import { useCommerce } from "../elastic-path";
import { ComponentProduct } from "./types";

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
  variationMatrix?: any;
  loading: boolean;
  error?: Error;
}

interface ChildProduct {
  id: string;
  name?: string;
  sku?: string;
  price?: string;
  attributes?: Record<string, any>;
  excluded?: boolean; // Whether this variation is excluded from bundle
}

interface UseParentProductsOptions {
  components: Record<string, ComponentProduct>;
  enabled?: boolean;
}

export function useParentProducts({
  components,
  enabled = true,
}: UseParentProductsOptions) {
  const [parentProducts, setParentProducts] = useState<Record<string, ParentProductInfo>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const commerce = useCommerce();

  useEffect(() => {
    if (!enabled || !components || Object.keys(components).length === 0) {
      return;
    }

    const fetchParentProducts = async () => {
      setLoading(true);
      setError(null);

      try {
        // Extract all unique product IDs from component options
        const productIds = new Set<string>();
        Object.values(components).forEach((component) => {
          component.options?.forEach((option) => {
            if (option.id && option.type === "product") {
              productIds.add(option.id);
            }
          });
        });

        if (productIds.size === 0) {
          setParentProducts({});
          return;
        }

        const initialParentInfo: Record<string, ParentProductInfo> = {};
        
        // First, fetch all products to determine which are parents
        const productPromises = Array.from(productIds).map(async (productId) => {
          try {
            const response = await getByContextProduct({
              client: commerce.providerRef.current.client,
              path: { product_id: productId },
            });

            const product = response.data?.data;
            if (product) {
              // Check if product is a parent by looking for child relationships
              const hasChildren = product.relationships?.children?.data && 
                                 product.relationships.children.data.length > 0;
              
              const isParent = hasChildren || product.attributes?.base_product === true;

              // Uncomment for debugging parent product detection
              // console.log(`Product ${productId}:`, {
              //   hasChildren,
              //   childrenCount: product.relationships?.children?.data?.length || 0,
              //   baseProduct: product.attributes?.base_product,
              //   isParent: Boolean(isParent),
              //   relationships: product.relationships
              // });

              initialParentInfo[productId] = {
                id: productId,
                isParent: Boolean(isParent),
                loading: Boolean(isParent), // Will fetch children if parent
                children: [],
                variations: (product.meta?.variations || [])
                  .filter(v => v.id && v.name)
                  .map(v => ({
                    id: v.id!,
                    name: v.name!,
                    options: v.options?.filter(o => o.id && o.name).map(o => ({
                      id: o.id!,
                      name: o.name!
                    }))
                  })),
                variationMatrix: product.meta?.variation_matrix,
              };

              return { productId, product, isParent: Boolean(isParent) };
            }
            return null;
          } catch (err) {
            console.warn(`Failed to fetch product ${productId}:`, err);
            initialParentInfo[productId] = {
              id: productId,
              isParent: false,
              loading: false,
              error: err instanceof Error ? err : new Error(`Failed to fetch ${productId}`),
            };
            return null;
          }
        });

        const productResults = await Promise.all(productPromises);
        setParentProducts(initialParentInfo);

        // Now fetch children for parent products
        const childPromises = productResults
          .filter((result) => result && result.isParent)
          .map(async (result) => {
            if (!result) return null;

            try {
              // For parent products, fetch child products using the dedicated API
              const childrenResponse = await getByContextChildProducts({
                client: commerce.providerRef.current.client,
                path: {
                  product_id: result.productId,
                },
                query: {
                  include: ["main_image"],
                },
              });

              const children: ChildProduct[] = childrenResponse.data?.data?.map((child) => ({
                id: child.id || "",
                name: child.attributes?.name,
                sku: child.attributes?.sku,
                price: child.meta?.display_price?.without_tax?.formatted,
                attributes: child.attributes,
                // Check if this variation is excluded from the bundle
                excluded: (child.meta as any)?.bundle_excluded === true || 
                          (child.attributes as any)?.bundle_excluded === true,
              })) || [];

              console.log(`Found ${children.length} children for parent ${result.productId}`);

              return { productId: result.productId, children };
            } catch (err) {
              console.warn(`Failed to fetch children for ${result.productId}:`, err);
              return { 
                productId: result.productId, 
                children: [], 
                error: err instanceof Error ? err : new Error(`Failed to fetch children`) 
              };
            }
          });

        const childResults = await Promise.all(childPromises);

        // Update parent products with children
        setParentProducts((prev) => {
          const updated = { ...prev };
          childResults.forEach((result) => {
            if (result) {
              updated[result.productId] = {
                ...updated[result.productId],
                children: result.children,
                loading: false,
                error: result.error,
              };
            }
          });
          return updated;
        });

      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to fetch parent products");
        setError(error);
        console.error("Error fetching parent products:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchParentProducts();
  }, [components, enabled, commerce]);

  return {
    parentProducts,
    loading,
    error,
  };
}

export type { ParentProductInfo, ChildProduct };