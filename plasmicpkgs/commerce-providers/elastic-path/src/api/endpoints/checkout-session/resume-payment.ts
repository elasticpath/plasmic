/**
 * handleResumePayment - post-3DS Stripe resume.
 * 
 * After /pay stores requires_action, the client completes 3DS and POSTs here.
 * Follows the documented cart-PI flow: checkoutApi → confirmOrder to sync
 * the existing PaymentIntent. Failed confirms may leave an unpaid order;
 * subsequent resumes reuse session.order.
 * 
 * Does not create a PaymentIntent, update the cart PI, re-assert shipping,
 * or use Clover handleConfirm.
 */
import {
  getACart,
  checkoutApi,
  confirmOrder,
  createShopperClient,
} from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
} from "../../../checkout/session/types";
import { hashCart } from "../../../checkout/session/cart-hash";
import { buildGuestCheckoutBody } from "../../../checkout/session/checkout-body-builder";
import { persistOrderCustomFields } from "../../../checkout/session/order-custom-fields";
import {
  resolveRequiresShipping,
  cartHasPhysicalItem,
} from "../../../checkout/session/cart-shipping";
import { buildAdminEpClient } from "../../../checkout/session/admin-client";
import { EP_SHIPPING_LINE_SKU } from "../../../checkout/session/set-shipping-line";
import {
  applyPaymentFailed,
  applyPaymentRequiresAction,
} from "../../../checkout/session/session-state-transition";
import { finalizePaidSession } from "../../../checkout/session/finalize-paid-session";
import { createLogger } from "../../../utils/logger";

const log = createLogger("ResumePayment");

const STRIPE_GATEWAY = "stripe";

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

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

  if (session.payment.gateway !== STRIPE_GATEWAY) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: `Resume is only supported for stripe, not ${session.payment.gateway ?? "none"}`,
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

  // Cart-hash re-check — same mechanism as /pay, no shipping rewrite.
  const { client: shopperClient } = createShopperClient(
    { baseUrl: ctx.epCredentials.apiBaseUrl },
    {
      clientId: ctx.epCredentials.clientId,
      storage: {
        get: () => ctx.shopperAccessToken ?? "",
        set: () => {},
      },
    }
  );

  let freshCartItems: Array<{
    id: string;
    quantity: number;
    sku?: string;
    product_id?: string;
  }> = [];
  try {
    const cartResponse = await getACart({
      client: shopperClient,
      path: { cartID: session.cartId },
      query: { include: ["items"] },
    });
    const items =
      (cartResponse.data as any)?.included?.items ??
      (cartResponse.data as any)?.data?.items ??
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
    cartHasPhysical = await cartHasPhysicalItem({
      host: ctx.epCredentials.apiBaseUrl,
      clientId: ctx.epCredentials.clientId,
      shopperAccessToken: ctx.shopperAccessToken,
      productIds: freshCartItems
        .map((it) => it.product_id ?? "")
        .filter(Boolean),
    });
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

  let orderId = session.order?.id;
  if (!orderId) {
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

    session = { ...session, order: { id: orderId } };
    const { storeError } = await persistOpenSession(ctx, req, ttl, session);
    if (storeError) return storeError;
  }

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
      gateway: STRIPE_GATEWAY,
      orderId,
      paymentIntentId,
      gatewayMetadata: session.payment.gatewayMetadata,
    });
  }

  if (classified.outcome === "failed") {
    const failedSession = applyPaymentFailed(session, {
      errorMessage: classified.errorMessage,
      gatewayMetadata: session.payment.gatewayMetadata,
    });
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
        ...(classified.errorMessage
          ? { paymentError: classified.errorMessage }
          : {}),
      },
      headers,
    };
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
