import { getByContextProduct, getByContextChildProducts } from "@epcc-sdk/sdks-shopper";
import type { GetProductHook } from "@plasmicpkgs/commerce";
import { SWRHook, useProduct, UseProduct } from "@plasmicpkgs/commerce";
import { normalizeProduct } from "../utils";
import { handleAPIError } from "../utils/errorHandling";
import { getEPClient } from "../utils/getEPClient";
import { createLogger } from "../utils/logger";

const log = createLogger("useProduct");

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
      const response = await getByContextProduct({
        client: getEPClient(provider),
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

      let productData = response.data;
      let childProducts = null;
      let initialVariantId: string | undefined;

      // If this is a child product (variant), fetch the parent to get variation metadata
      const isChildProduct =
        productData.data?.meta?.product_types?.includes("child");
      const parentId = isChildProduct
        ? (productData.data?.attributes as any)?.base_product_id ||
          (productData.data?.relationships as any)?.parent?.data?.id
        : null;

      if (isChildProduct && parentId) {
        log.debug("Child product detected, fetching parent", { childId: id, parentId } as Record<string, unknown>);
        initialVariantId = id;

        const parentResponse = await getByContextProduct({
          client: getEPClient(provider),
          path: {
            product_id: parentId,
          },
          query: {
            include: ["main_image", "files", "component_products"],
          },
        });

        if (parentResponse.data?.data) {
          productData = parentResponse.data;
        }
      }

      // Check if this is a parent product with variations
      const hasVariations =
        productData.data?.meta?.variations &&
        productData.data.meta.variations.length > 0;
      const baseProductId = isChildProduct && parentId ? parentId : id;

      if (hasVariations) {
        try {
          const childProductsResponse = await getByContextChildProducts({
            client: getEPClient(provider),
            path: {
              product_id: baseProductId,
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

      const product = normalizeProduct(
        productData,
        provider!.locale,
        childProducts || undefined
      );

      // Attach the originally-requested child ID so the variation picker
      // can pre-select the correct variant
      if (initialVariantId) {
        (product as any).__initialVariantId = initialVariantId;
      }

      return product;
    } catch (error) {
      const standardError = handleAPIError(error, "fetching product");
      log.error("Error fetching product", { error: standardError.message } as Record<string, unknown>);
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
