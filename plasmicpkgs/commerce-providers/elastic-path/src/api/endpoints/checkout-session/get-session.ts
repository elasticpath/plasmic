/**
 * A-4.2: Get Checkout Session
 *
 * Reads the current session from the store and returns the client-visible
 * shape. Returns `{ session: null }` (not a 404) when no session exists so
 * the client can distinguish "no session yet" from an error.
 */
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
} from "../../../checkout/session/types";
import { createLogger } from "../../../utils/logger";

const log = createLogger("GetSession");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

export async function handleGetSession(
  req: SessionRequest,
  ctx: SessionHandlerContext
): Promise<SessionResponse> {
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
      status: 200,
      body: {
        success: true,
        data: { session: null },
      },
    };
  }

  log.info("Session retrieved", {
    sessionId: session.id,
    status: session.status,
  } as Record<string, unknown>);

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(session) },
    },
  };
}
