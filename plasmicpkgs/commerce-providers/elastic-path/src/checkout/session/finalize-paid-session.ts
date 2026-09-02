/**
 * Shared tail for paid checkout once the EP order exists and the gateway
 * PaymentIntent is synced (or /pay confirm failed after the charge succeeded).
 * 
 * Cart cleanup is best-effort. applyPaymentSucceeded completes the session.
 * Callers handle order custom-field writes themselves so /pay can write them
 * before confirmOrder.
 */
import type {
  CheckoutSession,
  ClientCheckoutSession,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
} from "./types";
import { applyPaymentSucceeded } from "./session-state-transition";
import { runCartCleanup } from "./cart-cleanup";
import { createLogger } from "../../utils/logger";

const log = createLogger("FinalizePaidSession");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

export interface FinalizePaidSessionParams {
  ctx: SessionHandlerContext;
  req: SessionRequest;
  ttl: number;
  session: CheckoutSession;
  gateway: string;
  orderId: string;
  paymentIntentId: string;
  gatewayMetadata?: Record<string, unknown>;
  reconciliationError?: string | null;
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
    gatewayMetadata,
    reconciliationError = null,
  } = params;

  if (ctx.getClientCredentialsToken) {
    await runCartCleanup({
      host: ctx.epCredentials.apiBaseUrl,
      clientId: ctx.epCredentials.clientId,
      getClientCredentialsToken: ctx.getClientCredentialsToken,
      cartId: session.cartId,
    });
  }

  const completeSession = applyPaymentSucceeded(
    { ...session, payment: { ...session.payment, gateway } },
    {
      orderId,
      paymentIntentId,
      gatewayMetadata: {
        ...(gatewayMetadata ?? {}),
        ...(reconciliationError ? { needsReconciliation: true } : {}),
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
      data: { session: toClientSession(completeSession) },
      ...(reconciliationError ? { reconciliationPending: true } : {}),
    },
    headers: setResult.headers,
  };
}
