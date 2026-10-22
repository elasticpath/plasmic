/**
 * Order steps every checkout path shares: turning the session's cart into an
 * order, writing the checkout extras onto it, and the two ways an order the
 * checkout cannot use is handled (cancelled while unpaid, or marked for
 * reconciliation when it holds a payment it cannot record).
 */
import { checkoutApi, confirmOrder, updateAnOrder } from "@epcc-sdk/sdks-shopper";
import type { AccountCheckout, Client, CustomerCheckout } from "@epcc-sdk/sdks-shopper";
import { buildCheckoutBody } from "./checkout-body-builder";
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
import { isShippingLine } from "./shipping-line-sku";
import { buildShopperEpClient } from "./shopper-client";
import { toClientSession } from "./client-session";
import { readCartResponse } from "../../ep-server-functions/read-cart";
import { clearCartPaymentIntentId } from "./clear-cart-payment-intent";
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
  | { order: CreatedOrder; response?: undefined; rejection?: undefined }
  | {
      order?: undefined;
      response: SessionResponse;
      /** Elastic Path refused the checkout (a 4xx), with its own reason. */
      rejection?: string;
    };

interface CheckoutResult {
  data?: { data?: Partial<CreatedOrder> };
  error?: { errors?: Array<{ detail?: unknown; title?: unknown }> };
  response?: { status?: number };
}

/** Elastic Path's own words for a refused request, joined. */
function epReason(error: CheckoutResult["error"]): string {
  const parts = (error?.errors ?? [])
    .map((e) => (typeof e?.detail === "string" && e.detail) || (typeof e?.title === "string" && e.title) || "")
    .filter(Boolean);
  return parts.join(" ") || "The order could not be placed.";
}

/**
 * Checks out the session's cart. Elastic Path refusing the checkout (a 4xx,
 * such as not enough stock) gives 409 `CHECKOUT_REJECTED` with Elastic Path's
 * reason; any other failure gives 502 `EP_ERROR` with `failure.message`.
 * `failure.logMessage` is what the server logs.
 */
export async function createOrderFromCart(
  client: Client,
  session: CheckoutSession,
  failure: { message: string; logMessage: string }
): Promise<OrderCreation> {
  let res: CheckoutResult;
  try {
    res = (await checkoutApi({
      client,
      path: { cartID: session.cartId },
      // Elastic Path accepts a shipping address without phone_number and
      // instructions; the SDK type marks them required.
      body: buildCheckoutBody(session) as unknown as CustomerCheckout | AccountCheckout,
    })) as CheckoutResult;
  } catch (err) {
    res = {};
    log.error(failure.logMessage, {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const created = res.data?.data;
  if (typeof created?.id === "string" && created.id) {
    return { order: created as CreatedOrder };
  }

  const status = res.response?.status ?? 0;
  if (res.error && status >= 400 && status < 500) {
    const reason = epReason(res.error);
    log.warn("Elastic Path refused the checkout", {
      cartId: session.cartId,
      status,
      reason,
    });
    return {
      rejection: reason,
      response: {
        status: 409,
        body: { success: false, error: { message: reason, code: "CHECKOUT_REJECTED" } },
      },
    };
  }

  if (res.error || res.data) {
    log.error(failure.logMessage, {
      cartId: session.cartId,
      status,
      error: res.error ? epReason(res.error) : "checkoutApi response missing order id",
    });
  }
  return {
    response: {
      status: 502,
      body: { success: false, error: { message: failure.message, code: "EP_ERROR" } },
    },
  };
}

export const CART_CHANGED_REVIEW_MESSAGE =
  "We received your payment, but your cart changed during the card check, so no order was placed. Please contact us and we will complete or refund it.";

/**
 * What the shopper reads when the payment was taken but checkout created no
 * order: Elastic Path's reason when it refused, nothing more when it failed.
 */
export function checkoutRejectedReviewMessage(reason: string | undefined): string {
  const said = reason?.trim().replace(/[.\s]+$/, "");
  return said
    ? `We received your payment, but your order could not be placed: ${said}. Please contact us and we will complete or refund it.`
    : "We received your payment, but your order could not be placed. Please contact us and we will complete or refund it.";
}

/** Why a checkout after a taken payment created no order, for the server log. */
export function checkoutFailureReason(rejection: string | undefined): string {
  return rejection ?? "checkout failed after the payment";
}

/**
 * A payment was taken but no order can match it. Ends the checkout so no
 * route loops: the session completes with no order and is flagged for
 * reconciliation, the server log records the payment, the cart is unlinked
 * from the PaymentIntent (its lines stay), and the shopper is told plainly.
 */
export async function endCheckoutForReview(opts: {
  req: SessionRequest;
  ctx: SessionHandlerContext;
  ttl: number;
  session: CheckoutSession;
  client: Client;
  paymentReference: string;
  reason: string;
  message: string;
}): Promise<SessionResponse> {
  const { req, ctx, ttl, session, client, paymentReference, reason, message } = opts;
  log.error("Payment taken with no matching order; needs reconciliation", {
    sessionId: session.id,
    cartId: session.cartId,
    paymentReference,
    reason,
  });
  const cleared = await clearCartPaymentIntentId({ client, cartId: session.cartId });
  if (!cleared.ok) {
    log.error("Failed to unlink a reviewed PaymentIntent from the cart", {
      cartId: session.cartId,
      error: cleared.errorMessage,
    });
  }
  const ended: CheckoutSession = {
    ...session,
    status: "complete",
    order: null,
    payment: {
      ...session.payment,
      status: "succeeded",
      gatewayMetadata: {
        ...session.payment.gatewayMetadata,
        paymentIntentId: paymentReference,
        needsReconciliation: true,
      },
    },
  };
  let headers: Record<string, string> | undefined;
  try {
    headers = (await ctx.sessionStore.set("current", ended, ttl, req)).headers;
  } catch (err) {
    log.error("Failed to persist a session ended for review", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return {
    status: 409,
    body: {
      success: false,
      error: { message, code: "PAYMENT_NEEDS_REVIEW" },
      data: { session: toClientSession(ended) },
      reconciliationPending: true,
    },
    ...(headers ? { headers } : {}),
  };
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

/** Writes the session's checkout extras onto the order (best effort; never throws). */
export async function writeOrderCustomFields(
  ctx: SessionHandlerContext,
  orderId: string,
  session: CheckoutSession
): Promise<void> {
  let token = "";
  try {
    token = ctx.getClientCredentialsToken ? await ctx.getClientCredentialsToken() : "";
  } catch (err) {
    log.warn("Could not mint a token to write order custom fields", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  await persistOrderCustomFields({
    host: ctx.epCredentials.apiBaseUrl,
    token,
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
    });
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
  });
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
  return cartLines(cartResponse).filter((it) => !isShippingLine(it)) as ShopperLine[];
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
