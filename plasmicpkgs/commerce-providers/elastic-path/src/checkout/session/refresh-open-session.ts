import { readCartResponse } from "../../ep-server-functions/read-cart";
import { createLogger } from "../../utils/logger";
import { buildAdminEpClient } from "./admin-client";
import { hashCart } from "./cart-hash";
import { shopperLines } from "./order-creation";
import { hasPurchasableItem } from "./purchasable-items";
import { cartLines, totalsFromCart } from "./session-totals";
import { isSettling } from "./settle-once";
import { quoteSessionTotals } from "./shipping-line-scope";
import { buildShopperEpClient } from "./shopper-client";
import type { CheckoutSession, SessionHandlerContext } from "./types";

const log = createLogger("RefreshOpenSession");

function refreshable(session: CheckoutSession): boolean {
  return (
    session.status === "open" &&
    session.payment.status !== "requires_action" &&
    !isSettling(session.cartId)
  );
}

/**
 * Brings an open session up to date with its cart. When the cart's lines
 * changed since the session last looked, returns the session with the cart's
 * new hash and totals, so the browser shows the total `/pay` will charge.
 * Returns null when nothing changed or the session must not move: it is not
 * open, a card check holds its order, a payment for its cart is running, the
 * cart has nothing to buy, or the cart cannot be read.
 */
export async function refreshOpenSession(
  ctx: SessionHandlerContext,
  session: CheckoutSession
): Promise<CheckoutSession | null> {
  if (!refreshable(session)) return null;
  let cartResponse: unknown;
  try {
    const client = ctx.shopperAccessToken
      ? buildShopperEpClient(ctx)
      : await buildAdminEpClient(ctx);
    cartResponse = await readCartResponse(client, session.cartId, ctx);
  } catch (err) {
    log.warn("Could not read the cart to refresh the session", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!hasPurchasableItem(cartLines(cartResponse))) return null;

  const cartHash = hashCart(shopperLines(cartResponse));
  if (cartHash === session.cartHash) return null;

  if (!totalsFromCart(cartResponse) || !refreshable(session)) return null;
  const quoted = await quoteSessionTotals(ctx, session, cartResponse);
  if (!quoted.totals || !refreshable(session)) return null;
  return { ...session, cartHash, ...quoted };
}
