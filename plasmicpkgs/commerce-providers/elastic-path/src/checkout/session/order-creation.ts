/**
 * Order steps every checkout path shares: turning the session's cart into an
 * order, writing the checkout extras onto it, and the two ways an order the
 * checkout cannot use is handled (cancelled while unpaid, or marked for
 * reconciliation when it holds a payment it cannot record).
 */
import { checkoutApi, confirmOrder, updateAnOrder } from "@epcc-sdk/sdks-shopper";
import type { Client, CustomerCheckout } from "@epcc-sdk/sdks-shopper";
import { buildGuestCheckoutBody } from "./checkout-body-builder";
import { persistOrderCustomFields } from "./order-custom-fields";
import type { OrderTotal } from "./order-total";
import type {
  CheckoutSession,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
} from "./types";
import { hashCart, type CartItemForHash } from "./cart-hash";
import { cartLines } from "./session-totals";
import { EP_SHIPPING_LINE_SKU } from "./set-shipping-line";
import { buildShopperEpClient } from "./shopper-client";
import { toClientSession } from "./client-session";
import { readCartResponse } from "../../ep-server-functions/read-cart";
import { createLogger } from "../../utils/logger";

const log = createLogger("OrderCreation");

/** The order resource checkout returns, as far as the checkout reads it. */
export interface CreatedOrder {
  id: string;
  meta?: {
    display_price?: {
      with_tax?: { amount?: unknown; currency?: unknown };
      tax?: { amount?: unknown; currency?: unknown };
    };
  };
}

export type OrderCreation =
  | { order: CreatedOrder; response?: undefined }
  | { order?: undefined; response: SessionResponse };

/**
 * Checks out the session's cart. On failure, the 502 to send back: `message`
 * is what the shopper's client sees, `logMessage` what the server logs.
 */
export async function createOrderFromCart(
  client: Client,
  session: CheckoutSession,
  failure: { message: string; logMessage: string }
): Promise<OrderCreation> {
  try {
    const res = await checkoutApi({
      client,
      path: { cartID: session.cartId },
      // Elastic Path accepts a shipping address without phone_number and
      // instructions; the SDK type marks them required.
      body: buildGuestCheckoutBody(session) as unknown as CustomerCheckout,
    });
    const created = (res as { data?: { data?: Partial<CreatedOrder> } }).data?.data;
    if (typeof created?.id !== "string" || !created.id) {
      throw new Error("checkoutApi response missing order id");
    }
    return { order: created as CreatedOrder };
  } catch (err) {
    log.error(failure.logMessage, {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      response: {
        status: 502,
        body: {
          success: false,
          error: { message: failure.message, code: "EP_ERROR" },
        },
      },
    };
  }
}

/**
 * `POST /v2/orders/:id/confirm`: syncs the order with the cart PaymentIntent
 * it took from the cart at checkout. Elastic Path answers 422 without a
 * `data` body, which the SDK type leaves out.
 */
export function confirmCartPaymentOrder(client: Client, orderId: string): Promise<unknown> {
  return confirmOrder({
    client,
    path: { orderID: orderId },
    body: { data: {} },
  } as unknown as Parameters<typeof confirmOrder>[0]);
}

/** Writes the session's checkout extras onto the order (best effort). */
export async function writeOrderCustomFields(
  ctx: SessionHandlerContext,
  orderId: string,
  session: CheckoutSession
): Promise<void> {
  await persistOrderCustomFields({
    host: ctx.epCredentials.apiBaseUrl,
    token: ctx.getClientCredentialsToken ? await ctx.getClientCredentialsToken() : "",
    orderId,
    input: session.customAttributes,
  });
}

/** Cancels an order that took no payment and will not be used (best effort). */
export async function cancelUnpaidOrder(client: Client, orderId: string): Promise<void> {
  try {
    const res = await updateAnOrder({
      client,
      path: { orderID: orderId },
      body: { data: { type: "order", status: "cancelled" } } as never,
    });
    if ((res as { error?: unknown }).error) throw new Error("order update refused");
  } catch (err) {
    log.warn("Could not cancel an unused unpaid order", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
  }
}

/**
 * Records on the order, in `external_ref`, the payment it took but could not
 * record, so the order can be reconciled with the gateway (best effort; the
 * server log carries the same record).
 */
export async function markOrderForReconciliation(
  client: Client,
  orderId: string,
  paymentReference: string
): Promise<void> {
  log.error("Order needs reconciliation with its payment", {
    orderId,
    paymentReference,
  } as Record<string, unknown>);
  try {
    await updateAnOrder({
      client,
      path: { orderID: orderId },
      body: {
        data: { type: "order", external_ref: `needs-reconciliation ${paymentReference}` },
      } as never,
    });
  } catch {
    /* the log above is the record */
  }
}

export type ShopperLine = CartItemForHash & { sku?: string; product_id?: string };

/** The cart's shopper lines: every line but the storefront-managed shipping line. */
export function shopperLines(cartResponse: unknown): ShopperLine[] {
  return cartLines(cartResponse).filter(
    (it) => (it as { sku?: unknown })?.sku !== EP_SHIPPING_LINE_SKU
  ) as ShopperLine[];
}

/**
 * The order checkout created has a total the shopper was not shown. Takes no
 * payment for it: cancels the unused order, puts its total (and the hash of
 * the cart it came from) in the session, and returns that session with 409
 * `ORDER_TOTAL_CHANGED`, so the next submit pays the total now on screen.
 */
export async function refuseOrderTotal(opts: {
  req: SessionRequest;
  ctx: SessionHandlerContext;
  session: CheckoutSession;
  ttl: number;
  client: Client;
  orderId: string;
  total: OrderTotal | null;
}): Promise<SessionResponse> {
  const { req, ctx, session, ttl, client, orderId, total } = opts;
  await cancelUnpaidOrder(client, orderId);

  let cartHash = session.cartHash;
  try {
    const cart = await readCartResponse(buildShopperEpClient(ctx), session.cartId, ctx);
    cartHash = hashCart(shopperLines(cart));
  } catch {
    /* the next pay re-reads the cart and refreshes the hash itself */
  }
  const refreshed: CheckoutSession = {
    ...session,
    order: null,
    cartHash,
    totals: total ? totalsWithOrderTotal(session, total) : session.totals,
  };
  const error = {
    message: "Order total changed; review the total and try again",
    code: "ORDER_TOTAL_CHANGED",
  };
  try {
    const setResult = await ctx.sessionStore.set("current", refreshed, ttl, req);
    return {
      status: 409,
      body: { success: false, error, data: { session: toClientSession(refreshed) } },
      headers: setResult.headers,
    };
  } catch {
    return { status: 409, body: { success: false, error } };
  }
}

/** Session totals with the order's own total, for showing it before a retry. */
function totalsWithOrderTotal(
  session: CheckoutSession,
  total: OrderTotal
): NonNullable<CheckoutSession["totals"]> {
  const base = session.totals ?? {
    subtotal: total.amount,
    tax: 0,
    shipping: 0,
    total: total.amount,
    currency: total.currency ?? "",
  };
  return {
    ...base,
    subtotal: total.amount - base.tax - base.shipping,
    total: total.amount,
    currency: total.currency ?? base.currency,
  };
}
