import { getACart } from "@epcc-sdk/sdks-shopper";
import { normalizeCart } from "../utils/normalize";
import type { EpServerAuth } from "./types";
import { buildEpClient, isUsableAuth } from "./ep-client";

export interface EpGetCartInput {
  auth: EpServerAuth;
}

/**
 * Fetches a cart by ID, server-side. Returns null when:
 *  - auth is missing or incomplete (Studio canvas, unauthenticated call);
 *  - no cartId is present on the auth payload (anonymous visitor — server
 *    reads must not create carts; creation is a mutation and belongs on
 *    `POST /api/ep/cart/items`);
 *  - the cart is missing or EP returns an error (stale cookie, deleted cart).
 */
export async function epGetCart({
  auth,
}: EpGetCartInput): Promise<ReturnType<typeof normalizeCart> | null> {
  if (!isUsableAuth(auth)) return null;
  if (!auth.cartId) return null;
  const client = buildEpClient(auth);
  try {
    const response = await getACart({
      client,
      path: { cartID: auth.cartId },
      query: { include: ["items"] },
    });
    if (!response.data) return null;
    return normalizeCart(response.data, auth.locale ?? "en-US");
  } catch {
    return null;
  }
}
