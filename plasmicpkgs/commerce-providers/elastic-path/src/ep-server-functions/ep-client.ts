import { createShopperClient } from "@epcc-sdk/sdks-shopper";
import type { EpServerAuth } from "./types";

/**
 * Shared client-builder for the EP server functions.
 *
 * Returns a configured EPCC shopper client, or `null` when auth is
 * incomplete. Callers fail-soft (typically `return null`) so Studio
 * canvas — where `$ctx.ep` isn't populated by `buildEpCtx` — sees an
 * empty response instead of blowing up on `undefined.host`.
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
  return client;
}
