/**
 * Cart cleanup after an order completes.
 *
 * `runCartCleanup` empties the cart: it deletes the cart, and when Elastic
 * Path refuses (an account's last cart cannot be deleted) it deletes the
 * cart's items instead, then checks the cart is empty. `removeOrderedLines`
 * keeps the lines the order did not take (added while a 3DS challenge was
 * open) and falls back to emptying the cart whenever it cannot prove every
 * ordered line was removed.
 *
 * Both answer whether the ordered lines are gone. Failures are logged, never
 * thrown: the order is genuine.
 */
import {
  deleteACart,
  deleteACartItem,
  deleteAllCartItems,
  getCartItems,
  getOrderItems,
  updateACart,
  updateACartItem,
} from "@epcc-sdk/sdks-shopper";
import { buildFixedTokenEpClient } from "../../ep-server-functions/fixed-token-ep-client";
import { isShippingLine } from "./shipping-line-sku";
import { createLogger } from "../../utils/logger";

const log = createLogger("CartCleanup");

/**
 * `payment.gatewayMetadata` flag on a completed session whose cart could not
 * be emptied of the ordered lines. The next checkout session for that cart
 * retries the cleanup and refuses to start until it succeeds.
 */
export const CART_CLEANUP_PENDING = "cartCleanupPending";

export interface CartCleanupConfig {
  host: string;
  clientId: string;
  getClientCredentialsToken: () => Promise<string>;
  cartId: string;
}

interface LineRef {
  id?: unknown;
  type?: unknown;
  sku?: unknown;
  quantity?: unknown;
  relationships?: { cart_item?: { data?: { id?: unknown } } };
}

function listOf(res: unknown): LineRef[] | null {
  const r = res as { data?: { data?: unknown }; error?: unknown } | undefined;
  if (!r || r.error) return null;
  const list = r.data?.data;
  return Array.isArray(list) ? (list as LineRef[]) : null;
}

function refused(res: unknown): boolean {
  return Boolean((res as { error?: unknown } | undefined)?.error);
}

/**
 * The cart line each order item came from, with the quantity ordered; null
 * when any order item does not name its cart line.
 */
function orderedByLine(orderItems: LineRef[]): Map<string, number> | null {
  const ordered = new Map<string, number>();
  for (const item of orderItems) {
    const lineId = item.relationships?.cart_item?.data?.id;
    if (typeof lineId !== "string" || !lineId) return null;
    ordered.set(lineId, (ordered.get(lineId) ?? 0) + Number(item.quantity ?? 0));
  }
  return ordered;
}

/**
 * After an order completes, removes from the cart what the order took and
 * keeps the rest: a line added, or a quantity raised, after the order was
 * created stays in the shopper's cart. Each order item names the cart line it
 * came from. Deletes the whole cart when nothing is left, or when the order or
 * cart cannot be read, an order item names no cart line, or any removal
 * fails, so a paid line is never left behind.
 */
export async function removeOrderedLines(
  config: CartCleanupConfig & { orderId: string }
): Promise<boolean> {
  const { host, clientId, getClientCredentialsToken, cartId, orderId } = config;
  if (!cartId) return true;

  try {
    const client = buildFixedTokenEpClient({
      host,
      clientId,
      token: await getClientCredentialsToken(),
    });
    const orderItems = listOf(await getOrderItems({ client, path: { orderID: orderId } }));
    const cartItems = listOf(await getCartItems({ client, path: { cartID: cartId } }));
    const ordered = orderItems && orderedByLine(orderItems);
    if (!ordered || !cartItems) {
      throw new Error("order or cart lines unreadable");
    }

    const plan = cartItems.map((line) => {
      const id = String(line.id ?? "");
      const quantity = Number(line.quantity ?? 0);
      const managed = isShippingLine(line) || line.type === "promotion_item";
      const left = managed ? 0 : quantity - (ordered.get(id) ?? 0);
      return { id, quantity, left, managed };
    });
    if (!plan.some((p) => p.left > 0)) {
      return runCartCleanup(config);
    }

    for (const p of plan) {
      if (p.left === p.quantity && !p.managed) continue;
      const res =
        p.left > 0
          ? await updateACartItem({
              client,
              path: { cartID: cartId, cartitemID: p.id },
              body: { data: { id: p.id, quantity: p.left } as never },
            })
          : await deleteACartItem({
              client,
              path: { cartID: cartId, cartitemID: p.id },
            });
      if (refused(res)) throw new Error("cart line update refused");
    }
    return true;
  } catch (err) {
    log.warn("Could not keep the unordered cart lines; emptying the cart", {
      cartId,
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return runCartCleanup(config);
  }
}

/** Empties the cart; true when Elastic Path then reports it empty. */
export async function runCartCleanup(config: CartCleanupConfig): Promise<boolean> {
  const { host, clientId, getClientCredentialsToken, cartId } = config;
  if (!cartId) return true;

  try {
    const client = buildFixedTokenEpClient({
      host,
      clientId,
      token: await getClientCredentialsToken(),
    });
    const deleted = await deleteACart({ client, path: { cartID: cartId } });
    if (refused(deleted)) {
      // An account's last cart cannot be deleted; its items can. The cart
      // stays, so it must not keep the paid PaymentIntent either.
      const emptied = await deleteAllCartItems({ client, path: { cartID: cartId } });
      if (refused(emptied)) throw new Error("cart items delete refused");
      const unlinked = await updateACart({
        client,
        path: { cartID: cartId },
        body: { data: { payment_intent_id: "" } } as never,
      });
      if (refused(unlinked)) throw new Error("cart PaymentIntent unlink refused");
    }
    const left = listOf(await getCartItems({ client, path: { cartID: cartId } }));
    if (!left) throw new Error("cart unreadable after cleanup");
    if (left.length > 0) throw new Error("cart still holds lines after cleanup");
    return true;
  } catch (err) {
    log.error("Cart cleanup failed: the cart may still hold ordered lines", {
      cartId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
