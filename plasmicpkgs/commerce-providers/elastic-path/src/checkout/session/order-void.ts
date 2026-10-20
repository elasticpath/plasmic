/**
 * Voiding the PaymentIntent of an order held for a 3DS challenge.
 *
 * Elastic Path has no cart-level cancel for a cart PaymentIntent, and the
 * shopper can still complete an open challenge after the cart lets go of it.
 * The PaymentIntent can only be voided through the held order: confirming the
 * order records a pending transaction for it, and cancelling that transaction
 * cancels the PaymentIntent in Stripe, after which the challenge cannot
 * complete. Confirming allocates the order's stock, and cancelling does not
 * return it, so the stock is deallocated afterwards.
 *
 * Only abandon calls this, and only for a PaymentIntent the gateway reports as
 * still waiting for its challenge. Resume never confirms an unsettled payment.
 */
import {
  cancelATransaction,
  getAnOrder,
  getOrderItems,
  getOrderTransactions,
} from "@epcc-sdk/sdks-shopper";
import type { Client } from "@epcc-sdk/sdks-shopper";
import type { SessionHandlerContext } from "./types";
import { confirmCartPaymentOrder } from "./order-creation";
import { isOrderPaid } from "./payment-intent-status";
import { createLogger } from "../../utils/logger";

const log = createLogger("OrderVoid");

export type VoidOutcome =
  /** The PaymentIntent is cancelled; it can no longer take a payment. */
  | { outcome: "voided" }
  /** The order took the payment (the challenge completed first). */
  | { outcome: "paid" }
  /** The void did not happen; `reason` says why. */
  | { outcome: "failed"; reason: string };

interface TransactionRef {
  id?: unknown;
  status?: unknown;
}

function refused(res: unknown): string | null {
  const r = res as { error?: { errors?: Array<{ detail?: unknown; title?: unknown }> } } | undefined;
  if (!r?.error) return null;
  const detail = r.error.errors?.map((e) => e.detail ?? e.title).filter(Boolean).join(" ");
  return typeof detail === "string" && detail ? detail : "refused";
}

async function pendingTransactionId(client: Client, orderId: string): Promise<string | null> {
  const res = await getOrderTransactions({ client, path: { orderID: orderId } });
  const list = (res as { data?: { data?: TransactionRef[] } }).data?.data;
  const pending = Array.isArray(list) ? list.find((t) => t.status === "pending") : undefined;
  return typeof pending?.id === "string" ? pending.id : null;
}

/**
 * Cancels the held order's PaymentIntent. Re-uses a pending transaction an
 * earlier attempt left, else confirms the order to get one.
 */
export async function voidHeldOrderPayment(client: Client, orderId: string): Promise<VoidOutcome> {
  try {
    let transactionId = await pendingTransactionId(client, orderId);
    if (!transactionId) {
      let result: unknown;
      try {
        result = await confirmCartPaymentOrder(client, orderId);
      } catch (err) {
        result = { error: { errors: [{ detail: err instanceof Error ? err.message : String(err) }] } };
      }
      const order = await getAnOrder({ client, path: { orderID: orderId } });
      if (isOrderPaid((order as { data?: { data?: { payment?: unknown } } }).data?.data?.payment)) {
        return { outcome: "paid" };
      }
      transactionId = await pendingTransactionId(client, orderId);
      if (!transactionId) {
        return { outcome: "failed", reason: refused(result) ?? "no pending transaction to cancel" };
      }
    }
    const cancelled = await cancelATransaction({
      client,
      path: { orderID: orderId, transactionID: transactionId },
      body: { data: { reason: "abandoned" } },
    });
    const reason = refused(cancelled);
    return reason ? { outcome: "failed", reason } : { outcome: "voided" };
  } catch (err) {
    return { outcome: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

interface OrderItemRef {
  product_id?: unknown;
  quantity?: unknown;
  location?: unknown;
}

/**
 * Returns the stock a voided order's confirm allocated:
 * `POST /v2/inventories/{product}/transactions` with a multi-location
 * `deallocate` per order item (at the item's location when it has one).
 * Products without stock tracking answer 404 and are skipped. True when every
 * tracked item was deallocated.
 */
export async function releaseOrderStock(
  ctx: SessionHandlerContext,
  client: Client,
  orderId: string
): Promise<boolean> {
  if (!ctx.getClientCredentialsToken) return false;
  try {
    const res = await getOrderItems({ client, path: { orderID: orderId } });
    const items = (res as { data?: { data?: OrderItemRef[] } }).data?.data;
    if (!Array.isArray(items)) throw new Error("order items unreadable");
    const token = await ctx.getClientCredentialsToken();
    let ok = true;
    for (const item of items) {
      if (typeof item.product_id !== "string" || !item.product_id) continue;
      const quantity = Number(item.quantity ?? 0);
      if (!(quantity > 0)) continue;
      const answer = await fetch(
        `${ctx.epCredentials.apiBaseUrl}/v2/inventories/${encodeURIComponent(item.product_id)}/transactions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "EP-Inventories-Multi-Location": "true",
          },
          body: JSON.stringify({
            data: {
              type: "stock-transaction",
              attributes: {
                action: "deallocate",
                quantity,
                ...(typeof item.location === "string" && item.location ? { location: item.location } : {}),
              },
            },
          }),
        }
      );
      if (answer.status === 404) continue;
      if (!answer.ok) {
        ok = false;
        log.error("Could not return stock for a voided order", {
          orderId,
          productId: item.product_id,
          status: answer.status,
        });
      }
    }
    return ok;
  } catch (err) {
    log.error("Could not return stock for a voided order", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
