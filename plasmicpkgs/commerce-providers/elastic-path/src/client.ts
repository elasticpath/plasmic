import { createShopperClient, configureClient } from "@epcc-sdk/sdks-shopper";
import { ElasticPathCredentials } from './provider';

/**
 * In-memory StorageAdapter for the EP shopper SDK.
 *
 * The SDK's default storage adapters write to either localStorage or a
 * regular cookie — both of which leak credentials into JS-readable storage
 * (the localStorage adapter writes `_store_ep_credentials`; the cookie
 * adapter writes a non-HttpOnly cookie). Neither matches our auth model:
 * EP credentials live in better-auth's HttpOnly JWE `session_data` cookie
 * and reach the SDK via the `serverToken` prop on EPCommerceProvider.
 *
 * Using a memory adapter for ALL paths (preloaded when `serverToken` is
 * known, empty otherwise) keeps the storage tier inside the JS heap. When
 * empty, the SDK auto-mints an anonymous token and caches it in memory
 * for the lifetime of the page — never written to localStorage.
 *
 * The trade-off: a CLIENT-side mint may still happen when serverToken
 * isn't set yet (e.g., a brief gap during hydration). That mint is a
 * network round-trip but leaves no persistent client-side trace. The
 * better-auth session cookie remains the authoritative shopper identity.
 */
function memoryStorageAdapter(initial?: string) {
  let current: string | undefined = initial && initial.length > 0 ? initial : undefined;
  return {
    get: () => current,
    set: (t?: string) => { current = t; },
  };
}

const initElasticPathClient = (creds: ElasticPathCredentials, serverToken?: string) => {
  const config = {
    baseUrl: creds.host || "https://euwest.api.elasticpath.com",
  };
  const authOpts = {
    clientId: creds.clientId,
    // Always in-memory. NEVER localStorage. The serverToken (when
    // present) is the better-auth session's anonymous EP access token,
    // sourced from the `serverToken` prop on the global-context
    // CommerceProvider component (set via globalContextsProps in the
    // RSC catchall page).
    storage: memoryStorageAdapter(serverToken),
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
