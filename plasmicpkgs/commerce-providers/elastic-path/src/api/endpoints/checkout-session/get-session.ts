/**
 * A-4.2: Get Checkout Session
 *
 * Reads the current session from the store and returns the client-visible
 * shape. Returns `{ session: null }` (not a 404) when no session exists so
 * the client can distinguish "no session yet" from an error. An open session
 * whose cart changed comes back, and is stored, with the cart's new totals.
 */
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
} from "../../../checkout/session/types";
import { createLogger } from "../../../utils/logger";
import { toClientSession } from "../../../checkout/session/client-session";
import { refreshOpenSession } from "../../../checkout/session/refresh-open-session";

const log = createLogger("GetSession");

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
  });

  const refreshed = await refreshOpenSession(ctx, session);
  if (refreshed) {
    try {
      const ttl = ctx.sessionTtlSeconds ?? 1800;
      const setResult = await ctx.sessionStore.set("current", refreshed, ttl, req);
      return {
        status: 200,
        body: {
          success: true,
          data: { session: toClientSession(refreshed) },
        },
        headers: setResult.headers,
      };
    } catch (err) {
      log.error("Failed to store the refreshed session", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(session) },
    },
  };
}
