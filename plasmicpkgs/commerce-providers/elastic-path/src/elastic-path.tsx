import {
  getCommerceProvider as getCoreCommerceProvider,
  useCommerce as useCoreCommerce,
} from "@plasmicpkgs/commerce";
import {
  ElasticPathCredentials,
  ElasticPathProvider,
  getElasticPathProvider,
} from "./provider";

export type { ElasticPathProvider };

export const useCommerce = () => useCoreCommerce<ElasticPathProvider>();

export const getCommerceProvider = (
  creds: ElasticPathCredentials,
  locale: string,
  serverToken?: string,
  currency?: string,
  currencyDisplay: "symbol" | "code" = "symbol"
) =>
  getCoreCommerceProvider(
    getElasticPathProvider(creds, locale, serverToken, currency, currencyDisplay)
  );
