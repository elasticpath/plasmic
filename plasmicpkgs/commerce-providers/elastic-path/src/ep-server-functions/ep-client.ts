import type { Client } from "@epcc-sdk/sdks-shopper";
import type { EpServerAuth } from "./types";
import { epShopperHeaders } from "../utils/ep-shopper-headers";
import { buildFixedTokenEpClient } from "./fixed-token-ep-client";

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

export function buildEpClient(auth: EpServerAuth): Client {
  return buildFixedTokenEpClient({
    host: auth.host,
    clientId: auth.clientId,
    token: auth.accessToken,
    headers: epShopperHeaders(auth),
  });
}
