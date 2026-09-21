import { createShopperClient } from "@epcc-sdk/sdks-shopper";
import type { EpServerAuth } from "./types";
import { accountTokenHeaders } from "../auth/ep-plugin/envelope";

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

  // Elastic Path applies the account-management token across Commerce
  // with nothing wired per endpoint, so attaching it once here gives
  // every `ep.*` function the organisation's scope. `auth.accountToken`
  // is populated only from the envelope's selected-account slot, so a
  // session with no account selected sends no account header.
  const accountHeaders = accountTokenHeaders(auth);
  if (Object.keys(accountHeaders).length > 0) {
    client.interceptors.request.use(async (request: Request) => {
      for (const [name, value] of Object.entries(accountHeaders)) {
        request.headers.set(name, value);
      }
      return request;
    });
  }

  return client;
}
