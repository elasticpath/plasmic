import {
  Fetcher,
  MutationHook,
  SearchProductsHook,
  SWRHook,
} from "@plasmicpkgs/commerce";
import { handler as useAddItem } from "./cart/use-add-item";
import { handler as useCart } from "./cart/use-cart";
import { handler as useRemoveItem } from "./cart/use-remove-item";
import { handler as useUpdateItem } from "./cart/use-update-item";
import { ELASTICPATH_CART_COOKIE } from "./const";
import { handler as useProduct } from "./product/use-product";
import { handler as useSearch } from "./product/use-search";
import { handler as useBrands } from "./site/use-brands";
import { handler as useCategories } from "./site/use-categories";
// import { handler as useBrands } from "./site/use-brands";
// import { handler as useCategories } from "./site/use-categories";
import { useMemo } from "react";
import initElasticPathClient from "./client";
import {
  AddItemHook,
  GetCartHook,
  RemoveItemHook,
  UpdateItemHook,
} from "./types/cart";

export interface ElasticPathCredentials {
  clientId: string;
  host?: string;
}

const mockUseCart: SWRHook<GetCartHook> = {
  fetchOptions: {
    url: "",
  },
  async fetcher(_options) {
    console.log("mockUseCart fetcher");
    return null;
  },
  useHook:
    ({ useData }) =>
    (input) => {
      const response = useData({
        swrOptions: { revalidateOnFocus: false, ...input?.swrOptions },
      });
      return useMemo(
        () =>
          Object.create(response, {
            isEmpty: {
              get() {
                return false;
              },
              enumerable: true,
            },
          }),
        [response]
      );
    },
};

const mockUseAddItem: MutationHook<AddItemHook> = {
  useHook: () => () => (input) => {
    console.log("mockUseAddItem", input);
    return undefined;
  },
  fetchOptions: {
    url: "",
  },
  fetcher: (input) => {
    console.log("mockUseAddItem fetcher", input);
    return undefined;
  },
};

const mockUseRemoveItem: MutationHook<RemoveItemHook> = {
  fetchOptions: {
    url: "",
  },
  fetcher: (input) => {
    console.log("mockUseRemoveItem fetcher", input);
    return undefined;
  },
  useHook: () => () => (input) => {
    console.log("mockUseRemoveItem", input);
    return undefined;
  },
};

const mockUseUpdateItem: MutationHook<UpdateItemHook> = {
  fetchOptions: {
    url: "",
  },
  fetcher: (input) => {
    console.log("mockUseUpdateItem fetcher", input);
    return undefined;
  },
  useHook: () => () => (input) => {
    console.log("mockUseUpdateItem", input);
    return undefined;
  },
};

const mockUseSearch: SWRHook<SearchProductsHook> = {
  fetchOptions: {
    url: "",
  },
  fetcher: (input) => {
    console.log("mockUseSearch fetcher", input);
    return {
      products: [],
      found: false,
    };
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

// Create a minimal fetcher to satisfy the commerce package interface
// Note: This is not used by the hooks as they call the SDK directly
const createFetcher = (creds: ElasticPathCredentials): Fetcher => {
  return async (options) => {
    // This fetcher is not actually used since our hooks call the SDK directly
    // But we need to provide it to satisfy the commerce package interface
    console.warn(
      "ElasticPath fetcher called but should not be used - hooks should call SDK directly"
    );
    return null;
  };
};

export const getElasticPathProvider = (
  creds: ElasticPathCredentials,
  locale: string
) => {
  const client = initElasticPathClient(creds);

  return {
    locale,
    cartCookie: ELASTICPATH_CART_COOKIE,
    cart: {
      useCart: mockUseCart,
      useAddItem: mockUseAddItem,
      useRemoveItem: mockUseRemoveItem,
      useUpdateItem: mockUseUpdateItem,
    },
    fetcher: createFetcher(creds), // Required by commerce package interface
    client, // Pass the Elastic Path client for direct SDK usage
    products: { useProduct, useSearch },
    site: { useCategories, useBrands },
  };
};

export type ElasticPathProvider = {
  locale: string;
  cartCookie: string;
  fetcher: Fetcher; // Required by commerce package interface
  client: any; // The Elastic Path SDK client instance
  auth: any; // The Elastic Path auth instance
  cart: {
    useCart: typeof useCart;
    useAddItem: typeof useAddItem;
    useRemoveItem: typeof useRemoveItem;
    useUpdateItem: typeof useUpdateItem;
  };
  products: {
    useSearch: typeof useSearch;
    useProduct: typeof useProduct;
  };
  site: {
    useCategories: typeof useCategories;
    useBrands: typeof useBrands;
  };
};
