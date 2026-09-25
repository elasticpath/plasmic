import { createShopperClient, configureClient } from "@epcc-sdk/sdks-shopper";
import { epShopperHeaders } from "./utils/ep-shopper-headers";

export interface ElasticPathCredentials {
  clientId: string;
  host?: string;
}

/**
 * The SDK's default storage adapters write credentials to localStorage or
 * a non-HttpOnly cookie. Keeping them in the JS heap instead means the
 * anonymous token the SDK mints for catalog reads leaves no persistent
 * client-side trace.
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

  // The browser mints its own anonymous token and never holds an account
  // credential, so this contributes multi-location inventory only.
  client.interceptors.request.use(async (request, options) => {
    for (const [name, value] of Object.entries(epShopperHeaders({}))) {
      request.headers.set(name, value);
    }
    return request;
  });

  return client;
};

export default initElasticPathClient;
