/**
 * handleResumePayment - post-3DS Stripe resume.
 *
 * After /pay stores requires_action, the client completes 3DS and POSTs here.
 * /pay already holds the order for the PaymentIntent. Resume reads the
 * PaymentIntent's state through the adapter and confirms the order only when
 * the payment was taken (confirmOrder syncs the PaymentIntent). When the
 * order can no longer record a payment the gateway reports taken, the
 * session completes and the order is marked for reconciliation. Resume runs
 * under the same per-cart settle-once guard as /pay: concurrent resumes from
 * one session share one result, and an order already paid is answered as is.
 *
 * Sessions whose challenge started before /pay held an order re-check the
 * cart hash, then checkoutApi → confirmOrder.
 *
 * Does not create a PaymentIntent, re-assert shipping, or use Clover
 * handleConfirm.
 */
import { getACart, getAnOrder } from "@epcc-sdk/sdks-shopper";
import { settleOnceOrBusy } from "../../../checkout/session/settle-once";
import { releasingShippingLine } from "../../../checkout/session/shipping-line-scope";
import {
  readCartPaymentIntentState,
  unreadablePaymentResponse,
} from "../../../checkout/session/payment-challenge";
import { clearCartPaymentIntentId } from "../../../checkout/session/clear-cart-payment-intent";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  CartPaymentIntentState,
} from "../../../checkout/session/types";
import { hashCart } from "../../../checkout/session/cart-hash";
import { readCartResponse } from "../../../ep-server-functions/read-cart";
import {
  CART_CHANGED_REVIEW_MESSAGE,
  checkoutFailureReason,
  checkoutRejectedReviewMessage,
  confirmCartPaymentOrder,
  createOrderFromCart,
  endCheckoutForReview,
  markOrderForReconciliation,
  shopperLines,
  writeOrderCustomFields,
  type ShopperLine,
} from "../../../checkout/session/order-creation";
import {
  isOrderPaid,
  paymentIntentPhase,
} from "../../../checkout/session/payment-intent-status";
import {
  resolveRequiresShipping,
  cartHasPhysicalItem,
} from "../../../checkout/session/cart-shipping";
import { buildAdminEpClient } from "../../../checkout/session/admin-client";
import { buildShopperEpClient } from "../../../checkout/session/shopper-client";
import { applyPaymentFailed } from "../../../checkout/session/session-state-transition";
import { finalizePaidSession } from "../../../checkout/session/finalize-paid-session";
import { isCartPaymentIntentAdapter } from "../../../checkout/session/payment-sequence";
import { createLogger } from "../../../utils/logger";
import { toClientSession } from "../../../checkout/session/client-session";

const log = createLogger("ResumePayment");

function storedPaymentIntentId(session: CheckoutSession): string | undefined {
  const id = session.payment.gatewayMetadata?.paymentIntentId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** Nested Stripe PI status if EP included it (same unwrap as stripe-adapter). */
function nestedPiStatus(payload: unknown): string | undefined {
  const p: any = payload;
  const wrap =
    p?.meta?.payment_intent ??
    p?.payment_intent ??
    p?.data?.meta?.payment_intent ??
    p?.data?.payment_intent;
  const pi = wrap?.payment_intent ?? wrap;
  return typeof pi?.status === "string" ? pi.status : undefined;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  const e: any = err;
  const details = e?.errors
    ?.map((item: any) => item?.detail || item?.title || item?.code)
    .filter(Boolean)
    .join("; ");
  if (details) return details;
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.title === "string") return e.title;
  if (typeof e?.message === "string") return e.message;
  return String(err);
}

type ConfirmOutcome = "succeeded" | "requires_action" | "failed" | "unknown";

/**
 * Classify confirmOrder using documented/typed fields: OrderResponse.payment,
 * nested payment_intent.status, SDK error, or thrown Error.
 *
 * unknown is an internal outcome, not a PaymentStatus. Unrecognised 200s and
 * confirm failures without a documented PI/order signal stay retryable
 * without claiming 3DS is still required or completing the session.
 * Unlike /pay, resume has no adapter result — only confirmOrder — so a bare
 * `{ id }` must not be treated as success.
 */
export function classifyConfirmOrderResult(
  result: unknown,
  thrown?: unknown
): { outcome: ConfirmOutcome; errorMessage?: string } {
  const failSource = thrown ?? (result as any)?.error;
  if (failSource) {
    const text = errorText(failSource);
    const lower = text.toLowerCase();
    if (lower.includes("requires_action")) {
      return { outcome: "requires_action", errorMessage: text };
    }
    if (
      lower.includes("requires_payment_method") ||
      lower.includes("canceled") ||
      lower.includes("cancelled")
    ) {
      return { outcome: "failed", errorMessage: text };
    }
    return { outcome: "unknown", errorMessage: text };
  }

  const payload: any =
    (result as any)?.data?.data ?? (result as any)?.data ?? result;
  const piStatus = nestedPiStatus(payload) ?? nestedPiStatus(result);
  const payment: string | undefined = payload?.payment;
  const orderStatus: string | undefined = payload?.status;

  switch (paymentIntentPhase(piStatus)) {
    case "pending":
      return { outcome: "requires_action" };
    case "failed":
      return { outcome: "failed", errorMessage: `status: ${piStatus}` };
    case "settled":
      return { outcome: "succeeded" };
    default:
      break;
  }

  if (payment === "unpaid") {
    return { outcome: "requires_action" };
  }
  if (isOrderPaid(payment)) {
    return { outcome: "succeeded" };
  }
  if (orderStatus === "cancelled") {
    return { outcome: "failed", errorMessage: "order cancelled" };
  }

  return { outcome: "unknown" };
}

async function persistOpenSession(
  ctx: SessionHandlerContext,
  req: SessionRequest,
  ttl: number,
  session: CheckoutSession
): Promise<{ headers?: Record<string, string>; storeError?: SessionResponse }> {
  try {
    const setResult = await ctx.sessionStore.set("current", session, ttl, req);
    return { headers: setResult.headers };
  } catch (err) {
    log.error("Failed to persist session", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      storeError: {
        status: 500,
        body: {
          success: false,
          error: { message: "Failed to store session", code: "STORE_ERROR" },
        },
      },
    };
  }
}

export async function handleResumePayment(
  req: SessionRequest,
  ctx: SessionHandlerContext
): Promise<SessionResponse> {
  const ttl = ctx.sessionTtlSeconds ?? 1800;

  let session: CheckoutSession | null;
  try {
    session = await ctx.sessionStore.get("current", req);
  } catch (err) {
    log.error("Failed to read session from store", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 500,
      body: {
        success: false,
        error: { message: "Failed to read session", code: "STORE_ERROR" },
      },
    };
  }

  if (!session) {
    return {
      status: 410,
      body: {
        success: false,
        error: {
          message: "Session not found or has expired",
          code: "SESSION_GONE",
        },
      },
    };
  }

  if (session.status !== "open") {
    return {
      status: 400,
      body: {
        success: false,
        error: { message: "Session is not open", code: "SESSION_NOT_OPEN" },
      },
    };
  }

  if (session.payment.status !== "requires_action") {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: "Session payment is not awaiting a gateway action",
          code: "SESSION_NOT_RESUMABLE",
        },
      },
    };
  }

  const adapter = session.payment.gateway
    ? ctx.adapterRegistry.getAdapter(session.payment.gateway)
    : undefined;
  if (!adapter || !isCartPaymentIntentAdapter(adapter)) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: `Resume is only supported for cart_payment_intent, not ${session.payment.gateway ?? "none"}`,
          code: "UNKNOWN_GATEWAY",
        },
      },
    };
  }

  const paymentIntentId = storedPaymentIntentId(session);
  if (!paymentIntentId) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: "Session has no payment intent to resume",
          code: "NO_PAYMENT_INTENT",
        },
      },
    };
  }

  const open = session;
  const heldOrderId = open.order?.id;
  const readState = () => readCartPaymentIntentState(adapter, open, req.body);
  return settleOnceOrBusy(open, () =>
    releasingShippingLine(ctx, open.cartId, () =>
      heldOrderId
        ? settleHeldOrder(req, ctx, ttl, open, heldOrderId, paymentIntentId, readState)
        : resumeWithoutHeldOrder(req, ctx, ttl, open, paymentIntentId, readState)
    )
  );
}

/**
 * Confirm only a PaymentIntent the gateway reports as settled: Elastic Path's
 * confirm on one still awaiting 3DS records a pending payment and the order
 * can no longer take that PaymentIntent. Returns the response to send instead
 * of confirming, or `null` to go on.
 */
async function refuseUnsettled(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  ttl: number,
  session: CheckoutSession,
  readState: () => Promise<CartPaymentIntentState>
): Promise<SessionResponse | null> {
  const state = await readState();
  switch (state) {
    case "settled":
      return null;
    case "failed":
      return declinePayment(
        req,
        ctx,
        ttl,
        session,
        await buildAdminEpClient(ctx),
        "Card authentication failed"
      );
    case "awaiting_action":
      return {
        status: 409,
        body: {
          success: false,
          error: {
            message: "Finish the card check, then try again",
            code: "PAYMENT_STILL_REQUIRES_ACTION",
          },
          data: { session: toClientSession(session) },
        },
      };
    default:
      log.error("Resume refused: the payment's state cannot be read", {
        sessionId: session.id,
        gateway: session.payment.gateway,
        state,
      });
      return unreadablePaymentResponse(state, session);
  }
}

/** The PaymentIntent can no longer pay: unlink it and drop its order so the next pay starts fresh. */
async function declinePayment(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  ttl: number,
  session: CheckoutSession,
  adminClient: Awaited<ReturnType<typeof buildAdminEpClient>>,
  errorMessage: string | undefined
): Promise<SessionResponse> {
  const cleared = await clearCartPaymentIntentId({
    client: adminClient,
    cartId: session.cartId,
  });
  if (!cleared.ok) {
    log.error("Failed to unlink a declined PaymentIntent from the cart", {
      cartId: session.cartId,
      error: cleared.errorMessage,
    });
  }
  const failedSession = applyPaymentFailed(
    { ...session, order: null },
    {
      errorMessage,
      gatewayMetadata: session.payment.gatewayMetadata,
    }
  );
  const { headers, storeError } = await persistOpenSession(
    ctx,
    req,
    ttl,
    failedSession
  );
  if (storeError) return storeError;
  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(failedSession) },
      ...(errorMessage ? { paymentError: errorMessage } : {}),
    },
    headers,
  };
}

/**
 * The order /pay held for this challenge already fixes what is bought, so a
 * cart change during the challenge does not matter here. A request that
 * finds the order already paid answers with it. It finishes the cart cleanup
 * only while the cart still links to this PaymentIntent (the earlier request
 * stopped before it); otherwise the cart may be the shopper's next one.
 */
async function settleHeldOrder(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  ttl: number,
  session: CheckoutSession,
  orderId: string,
  paymentIntentId: string,
  readState: () => Promise<CartPaymentIntentState>
): Promise<SessionResponse> {
  const adminClient = await buildAdminEpClient(ctx);

  const order = await readOrderPayment(adminClient, orderId);
  if (order && isOrderPaid(order.payment)) {
    const cleanupUnfinished =
      (await cartPaymentIntentId(adminClient, session.cartId)) === paymentIntentId;
    return finalizePaidSession({
      ctx,
      req,
      ttl,
      session,
      gateway: session.payment.gateway ?? "",
      orderId,
      paymentIntentId,
      gatewayMetadata: session.payment.gatewayMetadata,
      cleanUpCart: cleanupUnfinished,
      keepLinesNotOrdered: true,
    });
  }

  const refused = await refuseUnsettled(req, ctx, ttl, session, readState);
  if (refused) return refused;

  return confirmAndSettle(req, ctx, ttl, session, adminClient, orderId, paymentIntentId, {
    keepLinesNotOrdered: true,
  });
}

/** Sessions whose challenge started before /pay held the order. */
async function resumeWithoutHeldOrder(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  ttl: number,
  session: CheckoutSession,
  paymentIntentId: string,
  readState: () => Promise<CartPaymentIntentState>
): Promise<SessionResponse> {
  const refused = await refuseUnsettled(req, ctx, ttl, session, readState);
  if (refused) return refused;

  // Cart-hash re-check — same mechanism as /pay, no shipping rewrite.
  const shopperClient = buildShopperEpClient(ctx);

  let freshCartItems: ShopperLine[] = [];
  try {
    const cartResponse = await readCartResponse(
      shopperClient,
      session.cartId,
      ctx
    );
    freshCartItems = shopperLines(cartResponse);
  } catch (err) {
    log.error("Failed to re-fetch cart for hash check", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Failed to fetch cart", code: "EP_ERROR" },
      },
    };
  }

  const freshHash = hashCart(freshCartItems);
  if (freshHash !== session.cartHash) {
    // The payment was taken for a cart that has since changed, and no order
    // was held for it: an order now would not match the charge.
    return endCheckoutForReview({
      req,
      ctx,
      ttl,
      session,
      client: await buildAdminEpClient(ctx),
      paymentReference: paymentIntentId,
      reason: "cart changed during the challenge",
      message: CART_CHANGED_REVIEW_MESSAGE,
    });
  }

  let cartHasPhysical = false;
  if (session.requiresShipping === false) {
    cartHasPhysical = await cartHasPhysicalItem(
      ctx,
      freshCartItems.map((it) => it.product_id ?? "").filter(Boolean)
    );
  }
  const requiresShipping = resolveRequiresShipping(
    session.requiresShipping,
    cartHasPhysical
  );
  const missingFields: string[] = [];
  if (!session.customerInfo) missingFields.push("customerInfo");
  if (!session.billingAddress) missingFields.push("billingAddress");
  if (requiresShipping && !session.shippingAddress)
    missingFields.push("shippingAddress");
  if (requiresShipping && !session.selectedShippingRateId)
    missingFields.push("selectedShippingRateId");
  const adminClient = await buildAdminEpClient(ctx);

  if (missingFields.length > 0) {
    // The payment was taken; this session cannot place its order.
    return endCheckoutForReview({
      req,
      ctx,
      ttl,
      session,
      client: adminClient,
      paymentReference: paymentIntentId,
      reason: `missing ${missingFields.join(", ")}`,
      message: checkoutRejectedReviewMessage(undefined),
    });
  }

  const created = await createOrderFromCart(adminClient, session, {
    message: "Failed to create order for resumed payment",
    logMessage: "EP checkoutApi failed on resume",
  });
  if (created.response) {
    // The payment was taken and no order was created. Checkout is not
    // retried: a failed or lost response may still have created an order.
    return endCheckoutForReview({
      req,
      ctx,
      ttl,
      session,
      client: adminClient,
      paymentReference: paymentIntentId,
      reason: checkoutFailureReason(created.rejection),
      message: checkoutRejectedReviewMessage(created.rejection),
    });
  }
  const orderId = created.order.id;

  const withOrder: CheckoutSession = { ...session, order: { id: orderId } };
  const { storeError } = await persistOpenSession(ctx, req, ttl, withOrder);
  if (storeError) return storeError;

  return confirmAndSettle(req, ctx, ttl, withOrder, adminClient, orderId, paymentIntentId);
}

async function confirmAndSettle(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  ttl: number,
  session: CheckoutSession,
  adminClient: Awaited<ReturnType<typeof buildAdminEpClient>>,
  orderId: string,
  paymentIntentId: string,
  options: { keepLinesNotOrdered?: boolean } = {}
): Promise<SessionResponse> {
  let confirmResult: unknown;
  let confirmThrown: unknown;
  try {
    confirmResult = await confirmCartPaymentOrder(adminClient, orderId);
  } catch (err) {
    confirmThrown = err;
  }

  const classified = classifyConfirmOrderResult(confirmResult, confirmThrown);
  const finalize = (reconciliationError: string | null) =>
    finalizePaidSession({
      ctx,
      req,
      ttl,
      session,
      gateway: session.payment.gateway ?? "",
      orderId,
      paymentIntentId,
      gatewayMetadata: session.payment.gatewayMetadata,
      keepLinesNotOrdered: options.keepLinesNotOrdered,
      reconciliationError,
    });

  if (classified.outcome === "succeeded") {
    await writeOrderCustomFields(ctx, orderId, session);
    return finalize(null);
  }

  // The gateway reported the payment taken, but confirm did not record it.
  const order = await readOrderPayment(adminClient, orderId);
  if (order && isOrderPaid(order.payment)) {
    await writeOrderCustomFields(ctx, orderId, session);
    return finalize(null);
  }
  if (!order || order.paymentIntentId === paymentIntentId) {
    // The order still holds the PaymentIntent (or could not be read): the
    // confirm can be retried.
    log.error("confirmOrder did not record a settled payment; retryable", {
      sessionId: session.id,
      orderId,
      error: classified.errorMessage,
    });
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Failed to confirm resumed payment", code: "EP_ERROR" },
      },
    };
  }

  // The order can no longer take this PaymentIntent, which has the money:
  // complete the checkout and record the order for reconciliation.
  await markOrderForReconciliation(adminClient, orderId, paymentIntentId);
  await writeOrderCustomFields(ctx, orderId, session);
  return finalize(classified.errorMessage ?? "confirm did not record the payment");
}

/** The order's payment state and the PaymentIntent it still holds; null when unreadable. */
async function readOrderPayment(
  client: Awaited<ReturnType<typeof buildAdminEpClient>>,
  orderId: string
): Promise<{ payment?: string; paymentIntentId?: string } | null> {
  try {
    const res = await getAnOrder({ client, path: { orderID: orderId } });
    const order = (res as { data?: { data?: { payment?: unknown; payment_intent_id?: unknown } } })
      .data?.data;
    if (!order) return null;
    return {
      payment: typeof order.payment === "string" ? order.payment : undefined,
      paymentIntentId:
        typeof order.payment_intent_id === "string" && order.payment_intent_id
          ? order.payment_intent_id
          : undefined,
    };
  } catch {
    return null;
  }
}

/** The PaymentIntent the cart still links to; undefined when none or unreadable. */
async function cartPaymentIntentId(
  client: Awaited<ReturnType<typeof buildAdminEpClient>>,
  cartId: string
): Promise<string | undefined> {
  try {
    const res = await getACart({ client, path: { cartID: cartId } });
    const id = (res as { data?: { data?: { payment_intent_id?: unknown } } }).data?.data
      ?.payment_intent_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}
