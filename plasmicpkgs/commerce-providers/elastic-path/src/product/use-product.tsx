import { getByContextProduct, getByContextChildProducts } from "@epcc-sdk/sdks-shopper";
import type { GetProductHook } from "@plasmicpkgs/commerce";
import { SWRHook, useProduct, UseProduct } from "@plasmicpkgs/commerce";
import { normalizeProduct } from "../utils";

export type GetProductInput = {
  id?: string;
};

export default useProduct as UseProduct<typeof handler>;

export const handler: SWRHook<GetProductHook> = {
  fetchOptions: {
    url: "",
  },
  async fetcher({ input, options, fetch, provider }) {
    const { id } = input;
    if (!id) {
      return null;
    }

    try {
      // First fetch the product
      const response = await getByContextProduct({
        client: (provider as any)!.client!,
        path: {
          product_id: id,
        },
        query: {
          include: ["main_image", "files", "component_products"],
        },
      });

      if (!response.data) {
        return null;
      }

      const productData = response.data;
      let childProducts = null;
      
      // Check if this is a parent product with variations
      const hasVariations = productData.data?.meta?.variations && productData.data.meta.variations.length > 0;
      
      if (hasVariations) {
        // Fetch child products
        try {
          const childProductsResponse = await getByContextChildProducts({
            client: (provider as any)!.client!,
            path: {
              product_id: id,
            },
            query: {
              include: ["main_image", "files"],
            },
          });

          childProducts = childProductsResponse.data;
        } catch (error) {
          // Continue without child products if fetch fails
        }
      }

      return normalizeProduct(response.data, provider!.locale, childProducts || undefined);
    } catch (error) {
      console.error("Error fetching product:", error);
      return null;
    }
  },
  useHook:
    ({ useData }) =>
    (input = {}) => {
      return useData({
        input: [["id", input.id]],
        swrOptions: {
          revalidateOnFocus: false,
          ...input.swrOptions,
        },
      });
    },
};
