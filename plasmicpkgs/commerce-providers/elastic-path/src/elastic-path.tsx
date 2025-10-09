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
  locale: string
) => getCoreCommerceProvider(getElasticPathProvider(creds, locale) as any);
