/**
 * Composes the EP session payload that drives every `ep.*` server function
 * (per PRD #262 / #272). Takes the Plasmic loader's prefetchedData (source
 * of connection/config — clientId, host) and the resolved EP session
 * (source of per-shopper auth — accessToken, cartId, selected account).
 *
 * Consumers call this in their RSC catchall page, then run Server Queries
 * inside a `withEpSession` scope so each function reads the session via
 * AsyncLocalStorage instead of a per-call `auth` argument:
 *     const epCtx = buildEpCtx(prefetchedData, { session });
 *     const prefetchedQueryData = await withEpSession(epCtx, () =>
 *       PLASMIC.unstable__getServerQueriesData(prefetchedData, queryCtx)
 *     );
 */

import { extractEpProviderConfig } from "../auth/extract-ep-provider-config";

/**
 * The organisation an account member is acting for, as `getSession()`
 * returns it on `session.account`. Null when none is selected.
 */
export interface BuildEpCtxAccountInput {
  id: string;
  name?: string;
  token: string;
  expires?: number;
}

export interface BuildEpCtxSessionInput {
  accessToken?: string;
  cartId?: string;
  account?: BuildEpCtxAccountInput | null;
  locale?: string;
  currency?: string;
}

export interface EpCtx {
  accessToken: string;
  host: string;
  clientId: string;
  cartId?: string;
  accountId?: string;
  accountToken?: string;
  locale?: string;
  currency?: string;
}

export function buildEpCtx(
  prefetchedData: unknown,
  opts: {
    session: BuildEpCtxSessionInput;
    hostAllowlist?: readonly string[];
  }
): EpCtx {
  const config = extractEpProviderConfig(prefetchedData as any, {
    hostAllowlist: opts.hostAllowlist,
  });
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
    cartId: opts.session.cartId,
    accountId: opts.session.account?.id,
    accountToken: opts.session.account?.token,
    locale: opts.session.locale,
    currency: opts.session.currency,
  };
}
