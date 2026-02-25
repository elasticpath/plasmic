import type { Client } from "@epcc-sdk/sdks-shopper";

/**
 * Extract the typed Elastic Path SDK client from the commerce provider.
 *
 * SWR hooks receive `provider` typed as the generic `Provider` which lacks
 * `client`. At runtime the provider is always an ElasticPathProvider with
 * the EP SDK client attached. This centralizes the single type assertion
 * so individual hooks avoid scattered `(provider as any).client` casts.
 */
export function getEPClient(provider: unknown): Client {
  return (provider as { client: Client }).client;
}
