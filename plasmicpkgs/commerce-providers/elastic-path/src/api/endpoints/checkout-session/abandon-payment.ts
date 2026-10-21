/**
 * handleAbandonPayment — unlink the Stripe PaymentIntent from the EP cart
 * after a failed/cancelled 3DS challenge.
 *
 * EP Update Cart: PUT /v2/carts/{cartID} with `{ data: { payment_intent_id: "" } }`.
 * That removes the cart's PI association so a later /pay can
 * createCartPaymentIntent a new PI. With an order held for the PI, abandon
 * also cancels the PI in Stripe (see below); with none, the PI is only
 * unlinked.
 *
 * Only valid while session.payment.status is requires_action (the 3DS
 * challenge is still open). Must not run after a successful handleNextAction
 * → resumePayment path (resume requires the same status and consumes it).
 * Runs under the per-cart settle-once guard, so it never races a resume.
 * Releases the PaymentIntent only when the adapter reads it as still waiting
 * for the challenge or failed: 409 PAYMENT_ALREADY_TAKEN when it took the
 * payment, 409 PAYMENT_STATUS_UNVERIFIED / 502 PAYMENT_STATUS_UNKNOWN when its
 * state cannot be read.
 * The session drops the order /pay held for the abandoned PaymentIntent.
 *
 * When the PaymentIntent still waits for its challenge and an order is held
 * for it, abandon first voids it through that order (order-void.ts): order
 * confirm, then transaction cancel (which cancels the PI in Stripe), then the
 * order's stock is returned and the order cancelled. Otherwise it does not create a PaymentIntent, call
 * updateCartPaymentIntent, confirmOrder, checkoutApi, or /confirm.
 */
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  CartPaymentIntentState,
} from "../../../checkout/session/types";
import { applyAbandonedRequiresAction } from "../../../checkout/session/session-state-transition";
import { isCartPaymentIntentAdapter } from "../../../checkout/session/payment-sequence";
import { clearCartPaymentIntentId } from "../../../checkout/session/clear-cart-payment-intent";
import { buildShopperEpClient } from "../../../checkout/session/shopper-client";
import { settleOnceOrBusy } from "../../../checkout/session/settle-once";
import { releasingShippingLine } from "../../../checkout/session/shipping-line-scope";
import { buildAdminEpClient } from "../../../checkout/session/admin-client";
import { finalizePaidSession } from "../../../checkout/session/finalize-paid-session";
import {
  cancelUnpaidOrder,
  markOrderForReconciliation,
} from "../../../checkout/session/order-creation";
import {
  releaseOrderStock,
  voidHeldOrderPayment,
} from "../../../checkout/session/order-void";
import {
  readCartPaymentIntentState,
  unreadablePaymentResponse,
} from "../../../checkout/session/payment-challenge";
import { createLogger } from "../../../utils/logger";
import { toClientSession } from "../../../checkout/session/client-session";

const log = createLogger("AbandonPayment");

export async function handleAbandonPayment(
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

  // Only a live 3DS challenge may be abandoned. Idle / failed / succeeded
  // must not unlink a PI — especially not one resumePayment is about to use.
  if (session.payment.status !== "requires_action") {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: "Session payment is not awaiting a gateway action",
          code: "SESSION_NOT_ABANDONABLE",
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
          message: `Abandon is only supported for cart_payment_intent, not ${session.payment.gateway ?? "none"}`,
          code: "UNKNOWN_GATEWAY",
        },
      },
    };
  }

  const open = session;
  return settleOnceOrBusy(open, () => releasingShippingLine(ctx, open.cartId, async () => {
    // Release only a PaymentIntent that has not taken the payment: one still
    // waiting for the challenge, or one that can no longer pay. A taken
    // payment must settle its order; an unread one is left alone.
    const state = await readCartPaymentIntentState(adapter, open, req.body);
    const heldOrderId = open.order?.id;
    if (state === "awaiting_action" && heldOrderId) {
      // The challenge can still complete after the cart lets go of it: void
      // the PaymentIntent through the held order first.
      return voidThenAbandon(req, ctx, ttl, open, heldOrderId, () =>
        readCartPaymentIntentState(adapter, open, req.body)
      );
    }
    if (state === "failed" || state === "awaiting_action") {
      return abandonOpenChallenge(req, ctx, ttl, open);
    }
    if (state === "settled") {
      return {
        status: 409,
        body: {
          success: false,
          error: {
            message: "Your payment went through. Finishing your order.",
            code: "PAYMENT_ALREADY_TAKEN",
          },
          data: { session: toClientSession(open) },
        },
      };
    }
    log.error("Abandon refused: the payment's state cannot be read", {
      sessionId: open.id,
      state,
    });
    return unreadablePaymentResponse(state, open);
  }));
}

/**
 * Voids the held order's PaymentIntent, returns the stock its confirm took,
 * cancels the order, then abandons as usual. When the challenge completed in
 * the meantime, the payment is taken: the order is settled (or, when it can no
 * longer record the payment, marked for reconciliation) and the session ends,
 * so the cart is never freed for a second charge.
 */
async function voidThenAbandon(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  ttl: number,
  session: CheckoutSession,
  orderId: string,
  readState: () => Promise<CartPaymentIntentState>
): Promise<SessionResponse> {
  const client = await buildAdminEpClient(ctx);
  const voided = await voidHeldOrderPayment(client, orderId);
  const paymentIntentId = session.payment.gatewayMetadata?.paymentIntentId;
  const reference = typeof paymentIntentId === "string" ? paymentIntentId : "unknown";

  if (voided.outcome === "voided") {
    await releaseOrderStock(ctx, client, orderId);
    await cancelUnpaidOrder(client, orderId);
    return abandonOpenChallenge(req, ctx, ttl, session);
  }

  if (voided.outcome === "paid") {
    return alreadyTaken(
      await finalizePaidSession({
        ctx,
        req,
        ttl,
        session,
        gateway: session.payment.gateway ?? "",
        orderId,
        paymentIntentId: reference,
        gatewayMetadata: session.payment.gatewayMetadata,
        keepLinesNotOrdered: true,
      })
    );
  }

  // The void failed. If the challenge completed meanwhile, the payment is
  // taken and this order can no longer record it: reconcile, never re-charge.
  if ((await readState()) === "settled") {
    await markOrderForReconciliation(client, orderId, reference);
    return alreadyTaken(
      await finalizePaidSession({
        ctx,
        req,
        ttl,
        session,
        gateway: session.payment.gateway ?? "",
        orderId,
        paymentIntentId: reference,
        gatewayMetadata: session.payment.gatewayMetadata,
        reconciliationError: voided.reason,
      })
    );
  }

  log.error("Abandon could not void the payment; nothing released", {
    sessionId: session.id,
    orderId,
    reason: voided.reason,
  });
  return unreadablePaymentResponse("unreadable", session);
}

/** 409 PAYMENT_ALREADY_TAKEN carrying the session a settlement just completed. */
function alreadyTaken(finalized: SessionResponse): SessionResponse {
  if (finalized.status !== 200) return finalized;
  const body = finalized.body as Record<string, unknown>;
  return {
    ...finalized,
    status: 409,
    body: {
      ...body,
      success: false,
      error: {
        message: "Your payment went through, so your order was placed.",
        code: "PAYMENT_ALREADY_TAKEN",
      },
    },
  };
}

async function abandonOpenChallenge(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  ttl: number,
  session: CheckoutSession
): Promise<SessionResponse> {
  const clearResult = await clearCartPaymentIntentId({
    client: buildShopperEpClient(ctx),
    cartId: session.cartId,
  });
  if (!clearResult.ok) {
    log.error("updateACart failed while clearing payment_intent_id", {
      cartId: session.cartId,
      error: clearResult.errorMessage,
    });
    return {
      status: 502,
      body: {
        success: false,
        error: {
          message: clearResult.errorMessage,
          code: "EP_ERROR",
        },
      },
    };
  }

  const abandoned = applyAbandonedRequiresAction(session);

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", abandoned, ttl, req);
  } catch (err) {
    log.error("Failed to persist abandoned-payment session", {
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

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(abandoned) },
    },
    headers: setResult.headers,
  };
}
