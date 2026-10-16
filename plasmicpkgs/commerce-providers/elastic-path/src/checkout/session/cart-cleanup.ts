/**
 * Cart Cleanup Operation — runs after a successful order is created.
 *
 * Slice 1: anonymous guest only — delete the EP cart. The next add-to-cart
 * action lazily creates a fresh cart through the existing cart-routes path.
 *
 * Failures are logged but never propagated. The order is genuine; cleanup
 * is housekeeping.
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
  return Array.isArray(r.data?.data) ? (r.data!.data as LineRef[]) : null;
}

/**
 * After an order completes, removes from the cart what the order took and
 * keeps the rest: a line added, or a quantity raised, after the order was
 * created stays in the shopper's cart. Each order item names the cart line
 * it came from. Deletes the whole cart when nothing is left, or when the
 * order or cart cannot be read, so a paid line is never left behind.
 */
export async function removeOrderedLines(
  config: CartCleanupConfig & { orderId: string }
): Promise<void> {
  const { host, clientId, getClientCredentialsToken, cartId, orderId } = config;
  if (!cartId) return;

  let client: ReturnType<typeof buildFixedTokenEpClient>;
  let orderItems: LineRef[] | null = null;
  let cartItems: LineRef[] | null = null;
  try {
    client = buildFixedTokenEpClient({
      host,
      clientId,
      token: await getClientCredentialsToken(),
    });
    orderItems = listOf(await getOrderItems({ client, path: { orderID: orderId } }));
    cartItems = listOf(await getCartItems({ client, path: { cartID: cartId } }));
  } catch (err) {
    log.warn("Could not read the order or cart to keep unordered lines", {
      cartId,
      orderId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
  }
  if (!orderItems || !cartItems) {
    await runCartCleanup(config);
    return;
  }

  const ordered = new Map<string, number>();
  for (const item of orderItems) {
    const lineId = item.relationships?.cart_item?.data?.id;
    if (typeof lineId !== "string") continue;
    ordered.set(lineId, (ordered.get(lineId) ?? 0) + Number(item.quantity ?? 0));
  }

  const plan = cartItems.map((line) => {
    const id = String(line.id ?? "");
    const quantity = Number(line.quantity ?? 0);
    const managed =
      line.sku === EP_SHIPPING_LINE_SKU || line.type === "promotion_item";
    const left = managed ? 0 : quantity - (ordered.get(id) ?? 0);
    return { id, quantity, left, managed };
  });
  if (!plan.some((p) => p.left > 0)) {
    await runCartCleanup(config);
    return;
  }

  for (const p of plan) {
    if (p.left === p.quantity && !p.managed) continue;
    try {
      if (p.left > 0) {
        await updateACartItem({
          client: client!,
          path: { cartID: cartId, cartitemID: p.id },
          body: { data: { id: p.id, quantity: p.left } as never },
        });
      } else {
        await deleteACartItem({
          client: client!,
          path: { cartID: cartId, cartitemID: p.id },
        });
      }
    } catch (err) {
      log.warn("Could not remove an ordered line from the cart", {
        cartId,
        orderId,
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
    }
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
