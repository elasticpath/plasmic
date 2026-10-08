import type { Cart } from "../types/cart";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import { readCart } from "./read-cart";
import { getCurrentEpSession } from "./session-context";
type CartReadResult = Cart | null;

/**
 * Fetches the current shopper's cart, server-side or via the consumer
 * proxy. Returns null when:
 *  - SSR with no usable session (anonymous visitor without a cartId);
 *  - the cart is missing or EP returns an error (stale cookie, deleted cart);
 *  - browser context with no proxy available.
 *
 * Browser path (Studio canvas / data-query preview) routes through the
 * consumer's `/api/ep/proxy/getCart` so the better-auth session cookie
 * resolves the same shopper / cart that SSR sees.
 */
export async function epGetCart(): Promise<CartReadResult> {
  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return callEpProxy<CartReadResult>("getCart", {}, null);
  }

  if (!isUsableAuth(auth)) return null;
  if (!auth.cartId) return null;
  const client = buildEpClient(auth);
  try {
    return await readCart(client, auth.cartId, {
      locale: auth.locale,
      currency: auth.currency,
    });
  } catch {
    return null;
  }
}
