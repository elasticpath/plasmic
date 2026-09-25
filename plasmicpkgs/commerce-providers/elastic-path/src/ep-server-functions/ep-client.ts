import { createShopperClient } from "@epcc-sdk/sdks-shopper";
import type { EpServerAuth } from "./types";
import { epShopperHeaders } from "../utils/ep-shopper-headers";

/**
 * Shared client-builder for the EP server functions.
 *
 * Returns a configured EPCC shopper client, or `null` when auth is
 * incomplete. Callers fail-soft (typically `return null`) so Studio
 * canvas — where no `withEpSession` scope is active — sees an empty
 * response instead of blowing up on `undefined.host`.
 */
export function isUsableAuth(auth: unknown): auth is EpServerAuth {
  if (!auth || typeof auth !== "object") return false;
  const a = auth as Partial<EpServerAuth>;
  return Boolean(a.host && a.clientId && a.accessToken);
}

export function buildEpClient(auth: EpServerAuth) {
  const { client } = createShopperClient(
    { baseUrl: auth.host },
    {
      clientId: auth.clientId,
      storage: {
        get: () => auth.accessToken,
        set: () => {},
      },
    }
  );

  client.interceptors.request.use(async (request: Request) => {
    for (const [name, value] of Object.entries(epShopperHeaders(auth))) {
      request.headers.set(name, value);
    }
    return request;
  });

  return client;
}
