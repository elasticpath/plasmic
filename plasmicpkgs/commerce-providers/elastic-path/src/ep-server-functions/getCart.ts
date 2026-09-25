import { getACart } from "@epcc-sdk/sdks-shopper";
import { buildCartReadHeaders } from "../utils/cart-read-headers";
import { normalizeCart } from "../utils/normalize";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import { getCurrentEpSession } from "./session-context";
type CartReadResult = ReturnType<typeof normalizeCart> | null;

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
    const response = await getACart({
      client,
      path: { cartID: auth.cartId },
      query: { include: ["items"] },
      // SSR parity with the client cart read: re-price for the shopper's
      // locale/currency at read time (headers omitted when unset).
      headers: buildCartReadHeaders({
        locale: auth.locale,
        currency: auth.currency,
      }),
    });
    if (!response.data) return null;
    return normalizeCart(response.data, auth.locale ?? "en-US");
  } catch {
    return null;
  }
}
