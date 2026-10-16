/**
 * handleResumePayment - post-3DS Stripe resume.
 *
 * After /pay stores requires_action, the client completes 3DS and POSTs here.
 * /pay already holds the order for the PaymentIntent, so resume confirms that
 * order (confirmOrder syncs the PaymentIntent). Resume runs under the same
 * per-cart settle-once guard as /pay: concurrent resumes from one session
 * share one result, and an order already settled is answered as is.
 *
 * Sessions whose challenge started before /pay held an order re-check the
 * cart hash, then checkoutApi → confirmOrder.
 *
 * Does not create a PaymentIntent, re-assert shipping, or use Clover
 * handleConfirm.
 */
import { checkoutApi, confirmOrder, getAnOrder } from "@epcc-sdk/sdks-shopper";
import { settleOnceOrBusy } from "../../../checkout/session/settle-once";
import { readKeysFrom } from "../../../checkout/session/payment-challenge";
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
import { buildGuestCheckoutBody } from "../../../checkout/session/checkout-body-builder";
import { persistOrderCustomFields } from "../../../checkout/session/order-custom-fields";
import {
  resolveRequiresShipping,
  cartHasPhysicalItem,
} from "../../../checkout/session/cart-shipping";
import { buildAdminEpClient } from "../../../checkout/session/admin-client";
import { buildShopperEpClient } from "../../../checkout/session/shopper-client";
import { EP_SHIPPING_LINE_SKU } from "../../../checkout/session/set-shipping-line";
import {
  applyPaymentFailed,
  applyPaymentRequiresAction,
} from "../../../checkout/session/session-state-transition";
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

  if (piStatus === "requires_action") {
    return { outcome: "requires_action" };
  }
  if (
    piStatus === "requires_payment_method" ||
    piStatus === "canceled" ||
    piStatus === "cancelled"
  ) {
    return { outcome: "failed", errorMessage: `status: ${piStatus}` };
  }
  if (
    piStatus === "succeeded" ||
    piStatus === "requires_capture" ||
    piStatus === "processing"
  ) {
    return { outcome: "succeeded" };
  }

  if (payment === "unpaid") {
    return { outcome: "requires_action" };
  }
  if (
    payment === "paid" ||
    payment === "authorized" ||
    payment === "partially_paid" ||
    payment === "partially_authorized"
  ) {
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
    } as Record<string, unknown>);
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
    } as Record<string, unknown>);
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
  const readState = () =>
    adapter.readPaymentIntentState
      ? adapter.readPaymentIntentState(open, readKeysFrom(req.body))
      : Promise.resolve<CartPaymentIntentState>("unverifiable");
  return settleOnceOrBusy(open, () =>
    open.order?.id
      ? settleHeldOrder(req, ctx, ttl, open, open.order!.id, paymentIntentId, readState)
      : resumeWithoutHeldOrder(req, ctx, ttl, open, paymentIntentId, readState)
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
  let state: CartPaymentIntentState;
  try {
    state = await readState();
  } catch {
    state = "unreadable";
  }
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
    case "unverifiable":
      log.error("Resume refused: the payment's state cannot be read", {
        sessionId: session.id,
        gateway: session.payment.gateway,
      } as Record<string, unknown>);
      return {
        status: 409,
        body: {
          success: false,
          error: {
            message:
              "We couldn't check your payment, so your order was not placed. Please try again.",
            code: "PAYMENT_STATUS_UNVERIFIED",
          },
          data: { session: toClientSession(session) },
        },
      };
    default:
      return {
        status: 502,
        body: {
          success: false,
          error: {
            message: "We couldn't check your payment. Please try again.",
            code: "PAYMENT_STATUS_UNKNOWN",
          },
          data: { session: toClientSession(session) },
        },
      };
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
    } as Record<string, unknown>);
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
 * finds the order settled (a replayed resume) answers with it and leaves the
 * cart alone.
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

  let orderPayment: string | undefined;
  try {
    const res = await getAnOrder({ client: adminClient, path: { orderID: orderId } });
    const payment = (res as any)?.data?.data?.payment;
    orderPayment = typeof payment === "string" ? payment : undefined;
  } catch {
    orderPayment = undefined;
  }
  if (orderPayment === "paid" || orderPayment === "authorized") {
    return finalizePaidSession({
      ctx,
      req,
      ttl,
      session,
      gateway: session.payment.gateway as string,
      orderId,
      paymentIntentId,
      gatewayMetadata: session.payment.gatewayMetadata,
      cleanUpCart: false,
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

  let freshCartItems: Array<{
    id: string;
    quantity: number;
    sku?: string;
    product_id?: string;
  }> = [];
  try {
    const cartResponse = await readCartResponse(
      shopperClient,
      session.cartId,
      ctx
    );
    const items =
      (cartResponse as any)?.included?.items ??
      (cartResponse as any)?.data?.items ??
      [];
    freshCartItems = (Array.isArray(items) ? items : []).filter(
      (it: { sku?: string }) => it?.sku !== EP_SHIPPING_LINE_SKU
    );
  } catch (err) {
    log.error("Failed to re-fetch cart for hash check", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
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
    // Do not persist the new hash. The stored hash is the snapshot the
    // existing PaymentIntent was created against; rewriting it would let a
    // later resume confirm that PI against a different cart.
    return {
      status: 409,
      body: {
        success: false,
        error: {
          message: "Cart has changed since session was created",
          code: "CART_MISMATCH",
        },
        data: { session: toClientSession(session) },
      },
    };
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
  if (missingFields.length > 0) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: `Missing required fields: ${missingFields.join(", ")}`,
          code: "MISSING_FIELDS",
        },
      },
    };
  }

  const adminClient = await buildAdminEpClient(ctx);

  let orderId: string;
  try {
    const checkoutResponse = await checkoutApi({
      client: adminClient,
      path: { cartID: session.cartId },
      body: buildGuestCheckoutBody(session) as any,
    });
    const oid = (checkoutResponse.data as any)?.data?.id;
    if (!oid) throw new Error("checkoutApi response missing order id");
    orderId = oid as string;
  } catch (err) {
    log.error("EP checkoutApi failed on resume", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: {
          message: "Failed to create order for resumed payment",
          code: "EP_ERROR",
        },
      },
    };
  }

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
    confirmResult = await confirmOrder({
      client: adminClient,
      path: { orderID: orderId, paymentID: paymentIntentId } as any,
      body: { data: {} } as any,
    });
  } catch (err) {
    confirmThrown = err;
  }

  const classified = classifyConfirmOrderResult(confirmResult, confirmThrown);

  if (classified.outcome === "succeeded") {
    await persistOrderCustomFields({
      host: ctx.epCredentials.apiBaseUrl,
      token: ctx.getClientCredentialsToken
        ? await ctx.getClientCredentialsToken()
        : "",
      orderId,
      input: session.customAttributes,
    });

    return finalizePaidSession({
      ctx,
      req,
      ttl,
      session,
      gateway: session.payment.gateway as string,
      orderId,
      paymentIntentId,
      gatewayMetadata: session.payment.gatewayMetadata,
      keepLinesNotOrdered: options.keepLinesNotOrdered,
    });
  }

  if (classified.outcome === "failed") {
    return declinePayment(req, ctx, ttl, session, adminClient, classified.errorMessage);
  }

  if (classified.outcome === "unknown") {
    // Session already persisted with order (if checkoutApi just created one).
    // Leave payment.status as requires_action so resume remains callable;
    // do not claim 3DS is still outstanding.
    log.error("confirmOrder failed without a payment-status signal", {
      sessionId: session.id,
      orderId,
      error: classified.errorMessage,
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: {
          message: "Failed to confirm resumed payment",
          code: "EP_ERROR",
        },
      },
    };
  }

  // Documented still-requires-action / unpaid — keep retryable, keep order.
  const pendingSession = applyPaymentRequiresAction(
    { ...session, order: { id: orderId } },
    {
      clientToken: session.payment.clientToken,
      actionData: session.payment.actionData,
      gatewayMetadata: session.payment.gatewayMetadata,
    }
  );
  const { headers, storeError } = await persistOpenSession(
    ctx,
    req,
    ttl,
    pendingSession
  );
  if (storeError) return storeError;

  log.info("Resume confirm did not complete payment", {
    sessionId: pendingSession.id,
    orderId,
    error: classified.errorMessage,
  } as Record<string, unknown>);

  return {
    status: 409,
    body: {
      success: false,
      error: {
        message:
          classified.errorMessage ||
          "Payment still requires action; retry resume after completing 3DS",
        code: "PAYMENT_STILL_REQUIRES_ACTION",
      },
      data: { session: toClientSession(pendingSession) },
    },
    headers,
  };
}
