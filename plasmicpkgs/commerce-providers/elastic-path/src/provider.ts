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



// Create a minimal fetcher to satisfy the commerce package interface
// Note: This is not used by the hooks as they call the SDK directly
const log = createLogger("Provider");

const createFetcher = (creds: ElasticPathCredentials): Fetcher => {
  return async (options) => {
    // This fetcher is not actually used since our hooks call the SDK directly
    // But we need to provide it to satisfy the commerce package interface
    log.warn(
      "ElasticPath fetcher called but should not be used - hooks should call SDK directly"
    );
    return null;
  };
};

export const getElasticPathProvider = (
  creds: ElasticPathCredentials,
  locale: string,
  currency?: string,
  currencyDisplay: "symbol" | "code" = "symbol"
) => {
  const client = initElasticPathClient(creds);

  return {
    locale,
    currency,
    currencyDisplay,
    cartCookie: ELASTICPATH_CART_COOKIE,
    fetcher: createFetcher(creds), // Required by commerce package interface
    client, // Pass the Elastic Path client for direct SDK usage
    products: { useProduct, useSearch },
    site: { useCategories, useBrands },
  };
};

export type ElasticPathProvider = {
  locale: string;
  /** ISO 4217 currency for the cart read (X-Moltin-Currency). Storefront-resolved. */
  currency?: string;
  /** Money display preference threaded into cart-data formatting. */
  currencyDisplay: "symbol" | "code";
  cartCookie: string;
  fetcher: Fetcher; // Required by commerce package interface
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
