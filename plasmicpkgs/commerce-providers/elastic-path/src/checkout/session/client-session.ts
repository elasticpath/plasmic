import type { CheckoutSession, ClientCheckoutSession } from "./types";

/** The session as the browser sees it: no cart hash, no cart id. */
export function toClientSession(session: CheckoutSession): ClientCheckoutSession {
  const { cartHash: _cartHash, cartId: _cartId, ...client } = session;
  return client;
}
