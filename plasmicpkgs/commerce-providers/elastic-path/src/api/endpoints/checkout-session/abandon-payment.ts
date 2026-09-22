/**
 * handleAbandonPayment — unlink the Stripe PaymentIntent from the EP cart
 * after a failed/cancelled 3DS challenge.
 *
 * EP Update Cart: PUT /v2/carts/{cartID} with `{ data: { payment_intent_id: "" } }`.
 * That removes the cart's PI association so a later /pay can
 * createCartPaymentIntent a new PI. It does not cancel the Stripe PI.
 *
 * Only valid while session.payment.status is requires_action (the 3DS
 * challenge is still open). Must not run after a successful handleNextAction
 * → resumePayment path (resume requires the same status and consumes it).
 *
 * Does not create a PaymentIntent, call updateCartPaymentIntent, confirmOrder,
 * checkoutApi, or /confirm.
 */
import { createShopperClient } from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
} from "../../../checkout/session/types";
import { applyAbandonedRequiresAction } from "../../../checkout/session/session-state-transition";
import { isCartPaymentIntentAdapter } from "../../../checkout/session/payment-sequence";
import { clearCartPaymentIntentId } from "../../../checkout/session/clear-cart-payment-intent";
import { createLogger } from "../../../utils/logger";

const log = createLogger("AbandonPayment");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

function buildShopperEpClient(ctx: SessionHandlerContext) {
  const { client } = createShopperClient(
    { baseUrl: ctx.epCredentials.apiBaseUrl },
    {
      clientId: ctx.epCredentials.clientId,
      storage: {
        get: () => ctx.shopperAccessToken ?? "",
        set: () => {},
      },
    }
  );
  return client;
}

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

  const clearResult = await clearCartPaymentIntentId({
    client: buildShopperEpClient(ctx),
    cartId: session.cartId,
  });
  if (!clearResult.ok) {
    log.error("updateACart failed while clearing payment_intent_id", {
      cartId: session.cartId,
      error: clearResult.errorMessage,
    } as Record<string, unknown>);
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
    } as Record<string, unknown>);
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
