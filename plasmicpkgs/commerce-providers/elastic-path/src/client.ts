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

  return client;
};

export default initElasticPathClient;