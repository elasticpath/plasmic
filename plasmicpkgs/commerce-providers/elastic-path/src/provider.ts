import type { Client } from "@epcc-sdk/sdks-shopper";
import { Fetcher } from "@plasmicpkgs/commerce";
import { ELASTICPATH_CART_COOKIE } from "./const";
import { handler as useProduct } from "./product/use-product";
import { handler as useSearch } from "./product/use-search";
import { handler as useBrands } from "./site/use-brands";
import { handler as useCategories } from "./site/use-categories";
import initElasticPathClient from "./client";
import { createLogger } from "./utils/logger";

export interface ElasticPathCredentials {
  clientId: string;
  host?: string;
}

const log = createLogger("Provider");

// Stub fetcher to satisfy the commerce package's Provider interface. Our
// reads go through the SDK client directly (catalog) or through the proxy
// route + SWR (cart), so this is never invoked.
const createFetcher = (_creds: ElasticPathCredentials): Fetcher => {
  return async () => {
    log.warn(
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
    fetcher: createFetcher(creds),
    client,
    products: { useProduct, useSearch },
    site: { useCategories, useBrands },
  };
};

export type ElasticPathProvider = {
  locale: string;
  cartCookie: string;
  fetcher: Fetcher;
  client: Client;
  products: {
    useSearch: typeof useSearch;
    useProduct: typeof useProduct;
  };
  site: {
    useCategories: typeof useCategories;
    useBrands: typeof useBrands;
  };
};
