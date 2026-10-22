import type { CheckoutSession, ClientCheckoutSession } from "./types";

/** The session as the browser sees it: no cart hash, no cart id, no account. */
export function toClientSession(session: CheckoutSession): ClientCheckoutSession {
  const { cartHash: _cartHash, cartId: _cartId, account: _account, ...client } = session;
  return client;
}
