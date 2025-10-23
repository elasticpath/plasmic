import { useEffect, useState } from "react";
import { getByContextProduct } from "@epcc-sdk/sdks-shopper";
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

        // Fetch products individually (could be optimized with batch endpoint if available)
        const productPromises = Array.from(productIds).map(async (productId) => {
          try {
            const response = await getByContextProduct({
              client: commerce.providerRef.current.client,
              path: { product_id: productId },
            });

            const product = response.data?.data;
            if (product) {
              return {
                id: productId,
                product: {
                  id: productId,
                  name: product.attributes?.name,
                  description: product.attributes?.description,
                  image: product.relationships?.main_image?.data?.id,
                  price: product.meta?.display_price?.without_tax?.formatted,
                  sku: product.attributes?.sku,
                } as OptionProduct,
              };
            }
            return null;
          } catch (err) {
            console.warn(`Failed to fetch product ${productId}:`, err);
            return null;
          }
        });

        const results = await Promise.all(productPromises);
        const productMap: Record<string, OptionProduct> = {};

        results.forEach((result) => {
          if (result) {
            productMap[result.id] = result.product;
          }
        });

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