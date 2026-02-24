import { getByContextAllNodes, getByContextNode } from "@epcc-sdk/sdks-shopper";
import { SWRHook, UseCategories, useCategories } from "@plasmicpkgs/commerce";
import { useMemo } from "react";
import { GetCategoriesHook } from "../types/site";
import { normalizeCategory } from "../utils";
import { handleAPIError } from "../utils/errorHandling";
import { getEPClient } from "../utils/getEPClient";
import { createLogger } from "../utils/logger";

const log = createLogger("useCategories");

export default useCategories as UseCategories<typeof handler>;

export const handler: SWRHook<GetCategoriesHook> = {
  fetchOptions: {
    query: "categories",
    method: "get",
  },
  async fetcher({ input, options, fetch, provider }) {
    const { categoryId } = input;
    try {
      if (!categoryId) {
        const categoriesResponse = await getByContextAllNodes({
          client: getEPClient(provider),
        });
        return categoriesResponse.data?.data
          ? categoriesResponse.data.data.map((node) =>
              normalizeCategory(node, provider!.locale)
            )
          : [];
      } else {
        const nodeResponse = await getByContextNode({
          client: getEPClient(provider),
          path: {
            node_id: categoryId!,
          },
        });

        return nodeResponse.data?.data
          ? [normalizeCategory(nodeResponse.data.data, provider!.locale)]
          : [];
      }
    } catch (error) {
      const standardError = handleAPIError(error, "fetching categories");
      log.error("Error fetching categories", { error: standardError.message } as Record<string, unknown>);
      return [];
    }
  },
  useHook:
    ({ useData }) =>
    (input) => {
      const response = useData({
        input: [["categoryId", input?.categoryId]],
        swrOptions: { revalidateOnFocus: false, ...input?.swrOptions },
      });
      return useMemo(
        () =>
          Object.create(response, {
            isEmpty: {
              get() {
                return (response.data?.length ?? 0) <= 0;
              },
              enumerable: true,
            },
          }),
        [response]
      );
    },
};
