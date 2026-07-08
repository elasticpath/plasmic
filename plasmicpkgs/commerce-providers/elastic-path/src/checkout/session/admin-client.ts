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
import { createShopperClient } from "@epcc-sdk/sdks-shopper";
import type { SessionHandlerContext } from "./types";

export async function buildAdminEpClient(ctx: SessionHandlerContext) {
  const token = ctx.getClientCredentialsToken
    ? await ctx.getClientCredentialsToken()
    : "";
  const { client } = createShopperClient(
    { baseUrl: ctx.epCredentials.apiBaseUrl },
    {
      clientId: ctx.epCredentials.clientId,
      storage: {
        get: () => token,
        set: () => {},
      },
    }
  );
  return client;
}
