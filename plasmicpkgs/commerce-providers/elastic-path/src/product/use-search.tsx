import { getByContextAllProducts } from "@epcc-sdk/sdks-shopper";
import { useSearch } from "@plasmicpkgs/commerce";
import { getSortVariables, normalizeProduct } from "../utils";

import type {
  SearchProductsHook,
  SWRHook,
  UseSearch,
} from "@plasmicpkgs/commerce";

export type SearchProductsInput = {
  search?: string;
  categoryId?: number;
  brandId?: number;
  sort?: string;
  locale?: string;
  count?: number;
};

const useSearchTyped: UseSearch<typeof handler> = useSearch;
export default useSearchTyped;

export const handler: SWRHook<SearchProductsHook> = {
  fetchOptions: {
    url: "",
  },
  async fetcher({ input, options, fetch, provider }) {
    const { search, categoryId, sort, count } = input;

    try {
      // Build query parameters
      const params: any = {
        query: {},
      };

      // Add pagination
      if (count) {
        params.query["page[limit]"] = count;
      }

      // Add search filter
      if (search) {
        params.query["filter"] = `name=like=*${search}*`;
      }

      // Add category filter
      if (categoryId) {
        // In Elastic Path, categories are hierarchies
        params.query["filter"] = params.query["filter"]
          ? `${params.query["filter"]},category.id=${categoryId}`
          : `category.id=${categoryId}`;
      }

      // Add sorting
      if (sort) {
        const sortVariable = getSortVariables(sort);
        if (sortVariable) {
          params.query["sort"] = sortVariable;
        }
      }

      const response = await getByContextAllProducts(params);

      return {
        products: response.data
          ? response.data?.data?.map((product: any) =>
              normalizeProduct(product, provider!.locale)
            )
          : [],
        found: response.data && (response.data.data?.length || 0) > 0,
      };
    } catch (error) {
      console.error("Error searching products:", error);
      return {
        products: [],
        found: false,
      };
    }
  },
  useHook:
    ({ useData }) =>
    (input = {}) => {
      return useData({
        input: [
          ["search", input.search],
          ["categoryId", input.categoryId],
          ["brandId", input.brandId],
          ["sort", input.sort],
          ["locale", input.locale],
          ["count", input.count],
        ],
        swrOptions: {
          revalidateOnFocus: false,
          ...input.swrOptions,
        },
      });
    },
};
