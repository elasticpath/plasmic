import { createShopperClient, configureClient } from "@epcc-sdk/sdks-shopper";
import { ElasticPathCredentials } from './provider';

/**
 * In-memory StorageAdapter for the EP shopper SDK.
 *
 * The SDK's default storage adapters write to either localStorage or a
 * regular cookie — both of which leak credentials into JS-readable storage
 * (the localStorage adapter writes `_store_ep_credentials`; the cookie
 * adapter writes a non-HttpOnly cookie). A memory adapter keeps the
 * storage tier inside the JS heap instead.
 *
 * Starting empty, the SDK auto-mints its own anonymous token from the
 * public clientId and caches it in memory for the lifetime of the page.
 * This client serves catalog reads only; cart and checkout run through
 * the server routes, where the better-auth session cookie is the
 * authoritative shopper identity.
 */
function memoryStorageAdapter() {
  let current: string | undefined;
  return {
    get: () => current,
    set: (t?: string) => { current = t; },
  };
}

const initElasticPathClient = (creds: ElasticPathCredentials) => {
  const config = {
    baseUrl: creds.host || "https://euwest.api.elasticpath.com",
  };
  const authOpts = {
    clientId: creds.clientId,
    storage: memoryStorageAdapter(),
  };

  // Configure the SDK's GLOBAL singleton too. Some package-internal
  // code paths (e.g., the bundle hooks `use-parent-products`,
  // `use-bundle-option-products`) call SDK functions without passing a
  // client — those resolve to the singleton. Without this call, the
  // singleton defaults to `localStorageAdapter()` and writes
  // `_store_ep_credentials` on first auth-interceptor fire.
  if (typeof window !== "undefined") {
    try {
      configureClient(config, authOpts);
    } catch {
      // configureClient is fine to call multiple times across renders
      // — but if it throws for any reason (e.g., concurrent reconfig
      // races), our fresh instance below still works.
    }
  }

  const { client } = createShopperClient(config, authOpts);

  /**
   * Multi-Location Inventory Interceptor
   *
   * Enables Elastic Path's Multi-Location Inventory (MLI) feature by adding
   * the required header to all requests. This allows tracking inventory
   * across multiple warehouses, stores, or distribution centers.
   *
   * Educational note: MLI provides more granular inventory control compared
   * to basic inventory, essential for B2B scenarios with multiple locations.
   */
  client.interceptors.request.use(async (request, options) => {
    request.headers.set("EP-Inventories-Multi-Location", "true");
    return request;
  });

  return client;
};

export default initElasticPathClient;
