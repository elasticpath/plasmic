import { getACart } from "@epcc-sdk/sdks-shopper";
import { normalizeCart } from "../utils/normalize";
import { buildCartReadHeaders } from "../utils/cart-read-headers";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import type { EpServerAuth } from "./types";

export interface EpGetCartInput {
  /** SSR-only explicit auth. Never advertised; never bind in Studio. */
  auth?: EpServerAuth;
}

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
export async function epGetCart(
  input?: EpGetCartInput
): Promise<ReturnType<typeof normalizeCart> | null> {
  const auth = getCurrentEpSession() ?? input?.auth;

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return callEpProxy<ReturnType<typeof normalizeCart> | null>(
      "getCart",
      {}
    );
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
