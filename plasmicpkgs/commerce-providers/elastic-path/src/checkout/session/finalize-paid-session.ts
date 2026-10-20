/**
 * Shared tail for paid checkout once the EP order exists and the gateway
 * PaymentIntent is synced (or /pay confirm failed after the charge succeeded).
 *
 * For cart_payment_intent gateways, clears cart payment_intent_id before
 * best-effort cart deletion so a surviving cart cannot reattach a paid PI —
 * but only when confirmOrder reconciliation succeeded. When
 * reconciliationError is set, the Cart PI link is left in place.
 * Cart cleanup failures (and detach failures after a successful charge) are
 * logged and never turn a completed order into a retryable payment failure.
 * Callers handle order custom-field writes themselves so /pay can write them
 * before confirmOrder.
 */
import type {
  CheckoutSession,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
} from "./types";
import { applyPaymentSucceeded } from "./session-state-transition";
import { CART_CLEANUP_PENDING, removeOrderedLines, runCartCleanup } from "./cart-cleanup";
import { clearCartPaymentIntentId } from "./clear-cart-payment-intent";
import { isCartPaymentIntentAdapter } from "./payment-sequence";
import { buildShopperEpClient } from "./shopper-client";
import { buildAdminEpClientFromToken } from "./admin-client";
import { createLogger } from "../../utils/logger";
import { toClientSession } from "./client-session";

const log = createLogger("FinalizePaidSession");

/** True when the cart no longer links to a PaymentIntent (or never could). */
async function detachCartPaymentIntentIfNeeded(
  ctx: SessionHandlerContext,
  gateway: string,
  cartId: string
): Promise<boolean> {
  const adapter = ctx.adapterRegistry.getAdapter(gateway);
  if (!adapter || !isCartPaymentIntentAdapter(adapter)) {
    return true;
  }
  if (!cartId) return true;

  // Prefer client_credentials (same as cart delete). A present-but-expired
  // shopper token must not block success cleanup when admin credentials exist.
  let adminToken = "";
  if (ctx.getClientCredentialsToken) {
    try {
      adminToken = await ctx.getClientCredentialsToken();
    } catch (err) {
      log.warn(
        "Cart PaymentIntent detach — could not mint admin token after successful payment; trying shopper token",
        {
          cartId,
          gateway,
          error: err instanceof Error ? err.message : String(err),
        }
      );
    }
  }
  if (!adminToken && !ctx.shopperAccessToken) {
    log.warn(
      "Cart PaymentIntent detach skipped — no shopper or admin token after successful payment",
      { cartId, gateway }
    );
    return false;
  }

  const result = await clearCartPaymentIntentId({
    client: adminToken
      ? buildAdminEpClientFromToken(ctx, adminToken)
      : buildShopperEpClient(ctx),
    cartId,
  });
  if (!result.ok) {
    // Order/payment already succeeded — do not fail the response (retry is dangerous).
    log.warn(
      "Failed to clear cart payment_intent_id after successful payment (non-fatal)",
      {
        cartId,
        gateway,
        error: result.errorMessage,
      }
    );
  }
  return result.ok;
}

export interface FinalizePaidSessionParams {
  ctx: SessionHandlerContext;
  req: SessionRequest;
  ttl: number;
  session: CheckoutSession;
  gateway: string;
  orderId: string;
  paymentIntentId?: string;
  transactionId?: string;
  gatewayMetadata?: Record<string, unknown>;
  reconciliationError?: string | null;
  /**
   * Default true. False when the order was already settled by an earlier
   * request, whose cleanup already ran: the cart may be the shopper's next one.
   */
  cleanUpCart?: boolean;
  /**
   * Keep cart lines the order did not take (added after the order was
   * created) instead of deleting the cart.
   */
  keepLinesNotOrdered?: boolean;
}

export async function finalizePaidSession(
  params: FinalizePaidSessionParams
): Promise<SessionResponse> {
  const {
    ctx,
    req,
    ttl,
    session,
    gateway,
    orderId,
    paymentIntentId,
    transactionId,
    gatewayMetadata,
    reconciliationError = null,
    cleanUpCart = true,
    keepLinesNotOrdered = false,
  } = params;

  // Keep the Cart PI association when confirmOrder reconciliation failed —
  // ops may still need the link. Clear only after a clean reconcile.
  const detached =
    cleanUpCart && reconciliationError == null
      ? await detachCartPaymentIntentIfNeeded(ctx, gateway, session.cartId)
      : false;

  let cartCleaned = true;
  if (cleanUpCart && ctx.getClientCredentialsToken) {
    const cleanup = {
      host: ctx.epCredentials.apiBaseUrl,
      clientId: ctx.epCredentials.clientId,
      getClientCredentialsToken: ctx.getClientCredentialsToken,
      cartId: session.cartId,
    };
    // A cart kept for the shopper must not still link to the paid
    // PaymentIntent; when it could not be unlinked, empty it instead.
    cartCleaned = await (keepLinesNotOrdered && detached
      ? removeOrderedLines({ ...cleanup, orderId })
      : runCartCleanup(cleanup));
  }

  const completeSession = applyPaymentSucceeded(
    { ...session, payment: { ...session.payment, gateway } },
    {
      orderId,
      paymentIntentId,
      transactionId,
      gatewayMetadata: {
        ...(gatewayMetadata ?? {}),
        ...(reconciliationError ? { needsReconciliation: true } : {}),
        // The next checkout session for this cart retries the cleanup first.
        ...(cartCleaned ? {} : { [CART_CLEANUP_PENDING]: true }),
      },
    }
  );

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", completeSession, ttl, req);
  } catch (err) {
    log.error("Failed to persist complete session", {
      sessionId: completeSession.id,
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
      data: { session: toClientSession(completeSession) },
      ...(reconciliationError ? { reconciliationPending: true } : {}),
    },
    headers: setResult.headers,
  };
}
