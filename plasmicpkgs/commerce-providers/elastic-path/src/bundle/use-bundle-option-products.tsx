import { useEffect, useState } from "react";
import { getByContextAllProducts } from "@epcc-sdk/sdks-shopper";
import { useCommerce } from "../elastic-path";
import { ComponentProduct } from "./types";
import { Product } from "../types/product";

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

export function useBundleOptionProducts({
  components,
  parentProducts = {},
  enabled = true,
}: UseBundleOptionProductsOptions) {
  const [products, setProducts] = useState<Record<string, OptionProduct>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const commerce = useCommerce();

  useEffect(() => {
    if (!enabled || !components || Object.keys(components).length === 0) {
      return;
    }

    const fetchProducts = async () => {
      setLoading(true);
      setError(null);

      try {
        // Extract all unique product IDs from component options
        const productIds = new Set<string>();
        Object.values(components).forEach((component) => {
          component.options?.forEach((option) => {
            if (option.id && option.type === "product") {
              productIds.add(option.id);
              
              // Also add child product IDs if this is a parent product
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

        if (productIds.size === 0) {
          setProducts({});
          return;
        }

        // Fetch all products in a single request using bulk fetching
        const productMap: Record<string, OptionProduct> = {};
        
        try {
          const productIdsArray = Array.from(productIds);
          
          // Elastic Path supports up to ~200 IDs in the in filter
          // If we have more, we'll need to batch them
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
          
          allProducts.forEach((product) => {
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
        } catch (err) {
          console.error("Failed to fetch products in bulk:", err);
        }

        setProducts(productMap);
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to fetch option products");
        setError(error);
        console.error("Error fetching bundle option products:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [components, parentProducts, enabled, commerce]);

  return {
    products,
    loading,
    error,
  };
}