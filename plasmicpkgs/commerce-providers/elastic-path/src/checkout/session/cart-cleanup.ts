/**
 * Cart cleanup after an order completes.
 *
 * `runCartCleanup` deletes the cart; the shopper's next add-to-cart starts it
 * again. `removeOrderedLines` keeps the lines the order did not take (added
 * while a 3DS challenge was open) and falls back to deleting the cart whenever
 * it cannot prove every ordered line was removed.
 *
 * Failures are logged but never propagated: the order is genuine.
 */
import {
  deleteACart,
  deleteACartItem,
  getCartItems,
  getOrderItems,
  updateACartItem,
} from "@epcc-sdk/sdks-shopper";
import { buildFixedTokenEpClient } from "../../ep-server-functions/fixed-token-ep-client";
import { EP_SHIPPING_LINE_SKU } from "./set-shipping-line";
import { createLogger } from "../../utils/logger";

const log = createLogger("CartCleanup");

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
): Promise<void> {
  const { host, clientId, getClientCredentialsToken, cartId, orderId } = config;
  if (!cartId) return;

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
      const managed = line.sku === EP_SHIPPING_LINE_SKU || line.type === "promotion_item";
      const left = managed ? 0 : quantity - (ordered.get(id) ?? 0);
      return { id, quantity, left, managed };
    });
    if (!plan.some((p) => p.left > 0)) {
      await runCartCleanup(config);
      return;
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
  } catch (err) {
    log.warn("Could not keep the unordered cart lines; deleting the cart", {
      cartId,
      orderId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    await runCartCleanup(config);
  }
}

export async function runCartCleanup(config: CartCleanupConfig): Promise<void> {
  const { host, clientId, getClientCredentialsToken, cartId } = config;
  if (!cartId) return;

  try {
    const adminToken = await getClientCredentialsToken();
    const client = buildFixedTokenEpClient({
      host,
      clientId,
      token: adminToken,
    });
    await deleteACart({ client, path: { cartID: cartId } });
  } catch (err) {
    log.warn("Cart cleanup failed (non-fatal)", {
      cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
  }
}
