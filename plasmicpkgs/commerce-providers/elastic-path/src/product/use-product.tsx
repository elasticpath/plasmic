import { getByContextProduct } from "@epcc-sdk/sdks-shopper";
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
      const response = await getByContextProduct({
        client: (provider as any)!.client!,
        path: {
          product_id: id,
        },
        query: {
          include: ["main_image", "files", "component_products"],
        },
      });

      return response.data
        ? normalizeProduct(response.data, provider!.locale)
        : null;
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
