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
import { createShopperClient, updateACart } from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
} from "../../../checkout/session/types";
import { applyAbandonedRequiresAction } from "../../../checkout/session/session-state-transition";
import { createLogger } from "../../../utils/logger";

const log = createLogger("AbandonPayment");

const STRIPE_GATEWAY = "stripe";

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

function epErrorMessage(error: unknown): string {
  const e: any = error;
  const details = e?.errors
    ?.map((item: any) => item?.detail || item?.title)
    .filter(Boolean)
    .join("; ");
  if (details) return details;
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.message === "string") return e.message;
  if (error instanceof Error) return error.message;
  return "Failed to reset cart payment";
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

  if (session.payment.gateway !== STRIPE_GATEWAY) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: `Abandon is only supported for stripe, not ${session.payment.gateway ?? "none"}`,
          code: "UNKNOWN_GATEWAY",
        },
      },
    };
  }

  const shopperClient = buildShopperEpClient(ctx);
  let updateResult: { error?: unknown };
  try {
    updateResult = (await updateACart({
      client: shopperClient,
      path: { cartID: session.cartId },
      body: {
        data: {
          payment_intent_id: "",
        },
      },
    })) as { error?: unknown };
  } catch (err) {
    log.error("updateACart threw while clearing payment_intent_id", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: {
          message: epErrorMessage(err),
          code: "EP_ERROR",
        },
      },
    };
  }

  if (updateResult?.error) {
    log.error("updateACart failed while clearing payment_intent_id", {
      cartId: session.cartId,
      error: epErrorMessage(updateResult.error),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: {
          message: epErrorMessage(updateResult.error),
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
