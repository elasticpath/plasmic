/**
 * Composes the `$ctx.ep` payload that flows into Plasmic Studio Server
 * Queries (per PRD #262). Takes the Plasmic loader's prefetchedData (source
 * of connection/config — clientId, host) and the resolved EP session
 * (source of per-shopper auth — accessToken, cartId, accountId), and
 * returns the shape that every `ep.*` server function accepts as its
 * `auth` parameter.
 *
 * Consumers call this in their RSC catchall page:
 *     const $ctx = {
 *       pageRoute, pagePath, params, query,
 *       ep: buildEpCtx(prefetchedData, { session }),
 *     };
 *     await PLASMIC.unstable__getServerQueriesData(prefetchedData, $ctx);
 */

import { extractEpProviderConfig } from "../auth/extract-ep-provider-config";

export interface BuildEpCtxSessionInput {
  accessToken?: string;
  cartId?: string;
  accountId?: string;
  locale?: string;
}

export interface EpCtx {
  accessToken: string;
  host: string;
  clientId: string;
  serverCartMode: boolean;
  cartId?: string;
  accountId?: string;
  locale?: string;
}

export function buildEpCtx(
  prefetchedData: unknown,
  opts: { session: BuildEpCtxSessionInput }
): EpCtx {
  const config = extractEpProviderConfig(prefetchedData as any);
  if (!config) {
    throw new Error(
      "buildEpCtx: EP Provider config not found in prefetchedData. " +
        "Ensure the project has an EP Commerce Provider global context configured in Studio."
    );
  }
  return {
    accessToken: opts.session.accessToken ?? "",
    host: config.host,
    clientId: config.clientId,
    serverCartMode: config.serverCartMode,
    cartId: opts.session.cartId,
    accountId: opts.session.accountId,
    locale: opts.session.locale,
  };
}
