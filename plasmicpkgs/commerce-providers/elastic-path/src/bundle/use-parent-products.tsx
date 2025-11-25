import { useEffect, useState } from "react";
import { getByContextAllProducts, getByContextChildProducts } from "@epcc-sdk/sdks-shopper";
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
        const parentProductResults: Array<{ productId: string; product: any; isParent: boolean } | null> = [];
        
        // Fetch all products in bulk to determine which are parents
        try {
          const productIdsArray = Array.from(productIds);
          
          // Batch products if needed (Elastic Path supports ~200 IDs per request)
          const batchSize = 100;
          const batches = [];
          
          for (let i = 0; i < productIdsArray.length; i += batchSize) {
            batches.push(productIdsArray.slice(i, i + batchSize));
          }
          
          const batchPromises = batches.map(async (batchIds) => {
            const response = await getByContextAllProducts({
              client: commerce.providerRef.current.client,
              query: {
                filter: `in(id,${batchIds.join(',')})`,
                include: ["main_image"],
                "page[limit]": BigInt(batchIds.length),
              },
            });
            
            return response.data?.data || [];
          });
          
          const batchResults = await Promise.all(batchPromises);
          const allProducts = batchResults.flat();
          
          // Process each product to determine if it's a parent
          allProducts.forEach((product) => {
            if (product && product.id) {
              // Check if product is a parent by looking for child relationships
              const hasChildren = product.relationships?.children?.data && 
                                 product.relationships.children.data.length > 0;
              
              const isParent = hasChildren || product.attributes?.base_product === true;

              initialParentInfo[product.id] = {
                id: product.id,
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

              parentProductResults.push({ 
                productId: product.id, 
                product, 
                isParent: Boolean(isParent) 
              });
            }
          });
          
          // Handle any products that weren't returned (e.g., deleted products)
          productIds.forEach((productId) => {
            if (!initialParentInfo[productId]) {
              initialParentInfo[productId] = {
                id: productId,
                isParent: false,
                loading: false,
                error: new Error(`Product ${productId} not found`),
              };
            }
          });
          
        } catch (err) {
          console.error("Failed to fetch products in bulk:", err);
          // Fall back to marking all as non-parent on error
          productIds.forEach((productId) => {
            initialParentInfo[productId] = {
              id: productId,
              isParent: false,
              loading: false,
              error: err instanceof Error ? err : new Error("Failed to fetch products"),
            };
          });
        }
        
        setParentProducts(initialParentInfo);

        // Now fetch children for parent products
        const childPromises = parentProductResults
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