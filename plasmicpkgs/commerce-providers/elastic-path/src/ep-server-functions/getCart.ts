import { getACart } from "@epcc-sdk/sdks-shopper";
import { normalizeCart } from "../utils/normalize";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import type { EpServerAuth } from "./types";

export interface EpGetCartInput {
  /** Studio canvas / Execute-panel fallback only — see EpGetProductInput. */
  auth?: EpServerAuth;
}

/**
 * Fetches a cart by ID, server-side. Returns null when:
 *  - no ALS session is active (Studio canvas, unauthenticated call);
 *  - the session lacks a cartId (anonymous visitor — server reads must
 *    not create carts; creation is a mutation and belongs on
 *    `POST /api/ep/cart/items`);
 *  - the cart is missing or EP returns an error (stale cookie, deleted cart).
 */
export async function epGetCart(
  input?: EpGetCartInput
): Promise<ReturnType<typeof normalizeCart> | null> {
  const auth = getCurrentEpSession() ?? input?.auth;
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
