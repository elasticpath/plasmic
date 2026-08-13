/**
 * Transport for the Commerce Extensions queries.
 *
 * The store connection is expressed as configuration rather than built inline,
 * so what is handed to the Elastic Path shopper SDK can be asserted directly.
 *
 * The SDK has no generated operations for `/v2/extensions`, so its client is
 * used for what it does provide — base URL, implicit-token lifecycle, bearer
 * attachment and retry-once-on-401 — while the paths are written here.
 */
import { createShopperClient } from "@epcc-sdk/sdks-shopper";

export interface EpClientCredentials {
  host: string;
  clientId: string;
}

/** The slice of the SDK client this package uses. */
export interface EpHttpClient {
  get: (opts: {
    url: string;
    query?: Record<string, string | number>;
    throwOnError?: boolean;
  }) => Promise<{
    data?: unknown;
    error?: unknown;
    response?: { status?: number };
  }>;
}

/**
 * Adapts the SDK client to the narrow port the queries consume. Errors are
 * returned rather than thrown so the status and Elastic Path's own error
 * envelope both reach the error mapper, which is where they become a message.
 */
export function makeRequestPort(client: EpHttpClient) {
  return async (req: { url: string; query?: Record<string, string | number> }) => {
    const res = await client.get({ ...req, throwOnError: false });
    return {
      status: res.response?.status ?? 0,
      body: res.error ?? res.data,
    };
  };
}

/**
 * Keeps the access token in the JS heap for the lifetime of the page. The SDK
 * would otherwise default to localStorage, which would leave store tokens
 * sitting in designers' browsers between sessions.
 */
export function memoryTokenStore(initial?: string) {
  let token: string | undefined = initial || undefined;
  return {
    get: () => token,
    set: (next?: string) => {
      token = next;
    },
  };
}

export function epClientConfig(creds: EpClientCredentials) {
  return {
    config: { baseUrl: creds.host },
    authOpts: { clientId: creds.clientId, storage: memoryTokenStore() },
  };
}

/** The transport the queries use in production. */
export function epRequestPort(creds: EpClientCredentials) {
  const { config, authOpts } = epClientConfig(creds);
  const { client } = createShopperClient(config, authOpts);
  return makeRequestPort(client);
}
