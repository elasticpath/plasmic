/**
 * Settles a zero-total order: cart → order, then a manual/purchase payment
 * (which authorises and captures with no card), then cart cleanup. This is
 * Elastic Path's documented approach for free orders: third-party gateways
 * reject a zero charge. Assumes the store has the manual gateway enabled.
 */
import type { Client } from "@epcc-sdk/sdks-shopper";
import type {
  CheckoutSession,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
} from "./types";
import { readOrderTotal } from "./order-total";
import { takeOrderPayment } from "./order-payment";
import { clearCartPaymentIntentId } from "./clear-cart-payment-intent";
import { CART_CLEANUP_PENDING, runCartCleanup } from "./cart-cleanup";
import { applyPaymentSucceeded } from "./session-state-transition";
import { toClientSession } from "./client-session";
import {
  createOrderFromCart,
  refuseOrderTotal,
  writeOrderCustomFields,
} from "./order-creation";
import {
  MANUAL_GATEWAY as FREE_ORDER_GATEWAY,
  MANUAL_PURCHASE_METHOD as FREE_ORDER_METHOD,
} from "./adapters/manual-adapter";
import { createLogger } from "../../utils/logger";

const log = createLogger("FreeOrder");

export async function settleFreeOrder(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  session: CheckoutSession,
  adminClient: Client,
  ttl: number
): Promise<SessionResponse> {
  const created = await createOrderFromCart(adminClient, session, {
    message: "Free order creation failed",
    logMessage: "Free-order checkoutApi failed",
  });
  if (created.response) return created.response;
  const orderId = created.order.id;

  const orderTotal = await readOrderTotal(adminClient, orderId, created.order);
  if (!orderTotal) {
    log.error("Free-order checkout produced an order with no total", {
      orderId,
    });
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Order total unavailable", code: "EP_ERROR" },
      },
    };
  }

  // Manual settles only an order whose own total is zero.
  if (orderTotal.amount !== 0) {
    log.warn("Free-order checkout produced an order with a total", {
      orderId,
    });
    return refuseOrderTotal({
      req,
      ctx,
      session,
      ttl,
      client: adminClient,
      orderId,
      total: orderTotal,
    });
  }

  await writeOrderCustomFields(ctx, orderId, session);

  const { result: settled } = await takeOrderPayment(adminClient, orderId, {
    gateway: FREE_ORDER_GATEWAY,
    method: FREE_ORDER_METHOD,
  });
  if (settled.status !== "succeeded") {
    log.error("Manual settlement of free order failed", {
      orderId,
      error: settled.errorMessage ?? settled.status,
    });
    return {
      status: 502,
      body: {
        success: false,
        error: {
          message: "Free order could not be settled (is the manual gateway enabled?)",
          code: "EP_ERROR",
        },
      },
    };
  }

  // Clear any leftover cart PaymentIntent (an earlier failed card attempt)
  // before the best-effort cart delete. The order is already settled, so a
  // failure here is logged, never turned into a payment error.
  const clearPi = await clearCartPaymentIntentId({
    client: adminClient,
    cartId: session.cartId,
  });
  if (!clearPi.ok) {
    log.warn("Failed to clear cart payment_intent_id after free-order settlement (non-fatal)", {
      cartId: session.cartId,
      error: clearPi.errorMessage,
    });
  }

  const cartCleaned = ctx.getClientCredentialsToken
    ? await runCartCleanup({
        host: ctx.epCredentials.apiBaseUrl,
        clientId: ctx.epCredentials.clientId,
        getClientCredentialsToken: ctx.getClientCredentialsToken,
        cartId: session.cartId,
      })
    : true;

  const completeSession = applyPaymentSucceeded(
    { ...session, payment: { ...session.payment, gateway: FREE_ORDER_GATEWAY } },
    {
      orderId,
      gatewayMetadata: { free: true, ...(cartCleaned ? {} : { [CART_CLEANUP_PENDING]: true }) },
    }
  );

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", completeSession, ttl, req);
  } catch (err) {
    log.error("Failed to persist complete free-order session", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 500,
      body: {
        success: false,
        error: { message: "Failed to store session", code: "STORE_ERROR" },
      },
    };
  }

  log.info("Free order settled", {
    sessionId: completeSession.id,
    orderId,
  });

  return {
    status: 200,
    body: { success: true, data: { session: toClientSession(completeSession) } },
    headers: setResult.headers,
  };
}
