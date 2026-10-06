import { createShopperClient } from "@epcc-sdk/sdks-shopper";
import type { Client } from "@epcc-sdk/sdks-shopper";
import { accountTokenHeaders } from "../../auth/ep-plugin/envelope";
import type { SessionHandlerContext } from "./types";

/**
 * The checkout handlers' client for calls made as the shopper: the shopper's
 * token plus the selected account's credential. Calls made with
 * `client_credentials` use `buildAdminEpClient` instead and carry no account.
 */
export function buildShopperEpClient(
  ctx: Pick<
    SessionHandlerContext,
    "epCredentials" | "shopperAccessToken" | "accountToken"
  >
): Client {
  const token = ctx.shopperAccessToken ?? "";
  const { client } = createShopperClient(
    { baseUrl: ctx.epCredentials.apiBaseUrl },
    {
      clientId: ctx.epCredentials.clientId,
      storage: { get: () => token, set: () => {} },
    }
  );

  const headers = accountTokenHeaders(ctx);
  client.interceptors.request.use(async (request: Request) => {
    for (const [name, value] of Object.entries(headers)) {
      request.headers.set(name, value);
    }
    return request;
  });

  return client;
}
