import { createShopperClient } from "@epcc-sdk/sdks-shopper";
import { ElasticPathCredentials } from './provider';

const initElasticPathClient = (creds: ElasticPathCredentials) => {
  const { client } = createShopperClient(
    {
      baseUrl: creds.host || "https://euwest.api.elasticpath.com",
    },
    {
      clientId: creds.clientId,
      storage: "localStorage",
    }
  );

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