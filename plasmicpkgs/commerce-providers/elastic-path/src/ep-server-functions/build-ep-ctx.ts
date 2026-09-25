/**
 * Composes the EP session payload that drives every `ep.*` server function
 * from the shopper session `epAuth.api.getSession()` returns. The envelope
 * already carries the host and client id admitted when it was minted.
 *
 * Consumers call this in their RSC catchall page, then run Server Queries
 * inside a `withEpSession` scope so each function reads the session via
 * AsyncLocalStorage instead of a per-call `auth` argument:
 *     const epCtx = buildEpCtx(session);
 *     const prefetchedQueryData = await withEpSession(epCtx, () =>
 *       PLASMIC.unstable__getServerQueriesData(prefetchedData, queryCtx)
 *     );
 *
 * An empty session, from a failed mint, yields an empty context, which the
 * server functions refuse to run with.
 */

import type { EpSession } from "../auth/ep-plugin/create-ep-auth-better";

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
  session: Pick<EpSession, "session" | "cart">,
  opts: { locale?: string; currency?: string } = {}
): EpCtx {
  const envelope = session.session;
  return {
    accessToken: envelope?.accessToken ?? "",
    host: envelope?.host ?? "",
    clientId: envelope?.clientId ?? "",
    cartId: session.cart?.id,
    accountId: envelope?.account?.id,
    accountToken: envelope?.account?.token,
    locale: opts.locale,
    currency: opts.currency,
  };
}
