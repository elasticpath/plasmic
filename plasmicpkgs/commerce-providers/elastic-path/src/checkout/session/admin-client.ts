/**
 * Build the credentialed (`client_credentials`) EP admin client for a request.
 *
 * The admin token is the gate for every privileged, server-only EP operation
 * (createCartPaymentIntent, checkoutApi, confirmOrder, cart cleanup, and the
 * authoritative shipping write — see ADR-0013). It is resolved per-request from
 * `ctx.getClientCredentialsToken` (which holds the server-only `client_secret`)
 * and never reaches the browser. Shared so the pay handler and the
 * checkout-session shipping step build it the same way rather than each
 * re-deriving it.
 */
import type { Client } from "@epcc-sdk/sdks-shopper";
import { buildFixedTokenEpClient } from "../../ep-server-functions/fixed-token-ep-client";
import type { SessionHandlerContext } from "./types";

export async function buildAdminEpClient(
  ctx: SessionHandlerContext
): Promise<Client> {
  const token = ctx.getClientCredentialsToken
    ? await ctx.getClientCredentialsToken()
    : "";
  return buildAdminEpClientFromToken(ctx, token);
}

/** For a caller that already minted the `client_credentials` token. */
export function buildAdminEpClientFromToken(
  ctx: Pick<SessionHandlerContext, "epCredentials">,
  token: string
): Client {
  return buildFixedTokenEpClient({
    host: ctx.epCredentials.apiBaseUrl,
    clientId: ctx.epCredentials.clientId,
    token,
  });
}
