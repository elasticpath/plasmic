import type { Client } from "@epcc-sdk/sdks-shopper";
import { accountTokenHeaders } from "../../auth/ep-plugin/envelope";
import { buildFixedTokenEpClient } from "../../utils/fixed-token-ep-client";
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
  return buildFixedTokenEpClient({
    host: ctx.epCredentials.apiBaseUrl,
    clientId: ctx.epCredentials.clientId,
    token: ctx.shopperAccessToken ?? "",
    headers: accountTokenHeaders(ctx),
  });
}
