import { createShopperClient } from "@epcc-sdk/sdks-shopper";
import type { Client } from "@epcc-sdk/sdks-shopper";

/**
 * An Elastic Path client that sends `token` and sets `headers` on every
 * request. The headers go on by request interceptor, not client config, so
 * they stay off the SDK's own token mint.
 */
export function buildFixedTokenEpClient(opts: {
  host: string;
  clientId: string;
  token: string;
  headers?: Record<string, string>;
}): Client {
  const { token, headers } = opts;
  const { client } = createShopperClient(
    { baseUrl: opts.host },
    {
      clientId: opts.clientId,
      storage: { get: () => token, set: () => {} },
    }
  );

  if (headers && Object.keys(headers).length > 0) {
    client.interceptors.request.use(async (request: Request) => {
      for (const [name, value] of Object.entries(headers)) {
        request.headers.set(name, value);
      }
      return request;
    });
  }

  return client;
}
