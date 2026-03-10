/**
 * A-4.1: Create Checkout Session
 *
 * Initialises a new checkout session for the given cartId. Fetches the cart
 * from EP to compute the initial cart hash (used later in /pay to detect
 * cart mutations), stores the session via the SessionStore, and returns a 201
 * with the client-visible session shape plus Set-Cookie headers.
 */
import { randomUUID } from "crypto";
import { getACart } from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
} from "../../../checkout/session/types";
import { hashCart } from "../../../checkout/session/cart-hash";
import { createLogger } from "../../../utils/logger";

const log = createLogger("CreateSession");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

export async function handleCreateSession(
  req: SessionRequest,
  ctx: SessionHandlerContext
): Promise<SessionResponse> {
  const { body } = req;

  // Validate cartId
  if (!body.cartId || typeof body.cartId !== "string") {
    return {
      status: 400,
      body: {
        success: false,
        error: { message: "cartId is required and must be a string", code: "VALIDATION_ERROR" },
      },
    };
  }

  const cartId = body.cartId as string;
  const ttl = ctx.sessionTtlSeconds ?? 1800;

  // The EP SDK's Client<> type is complex; the settings-only object is the
  // documented lightweight pattern used throughout this codebase.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = {
    settings: {
      application_id: ctx.epCredentials.clientId,
      host: ctx.epCredentials.apiBaseUrl,
    },
  } as any;

  let cartItems: Array<{ id: string; quantity: number; unit_price?: { amount?: number }; value?: { amount?: number } }> = [];

  try {
    const cartResponse = await getACart({ client, path: { cartID: cartId } });
    const items = (cartResponse.data as any)?.included?.items ?? (cartResponse.data as any)?.data?.items ?? [];
    cartItems = Array.isArray(items) ? items : [];
  } catch (err) {
    log.error("Failed to fetch cart from EP", {
      cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Failed to fetch cart from Elastic Path", code: "EP_ERROR" },
      },
    };
  }

  const cartHash = hashCart(cartItems);
  const sessionId = randomUUID();
  const now = Date.now();

  const session: CheckoutSession = {
    id: sessionId,
    status: "open",
    cartId,
    cartHash,
    customerInfo: null,
    shippingAddress: null,
    billingAddress: null,
    selectedShippingRateId: null,
    availableShippingRates: [],
    totals: null,
    payment: {
      gateway: null,
      status: "idle",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: null,
    expiresAt: now + ttl * 1000,
  };

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", session, ttl, req);
  } catch (err) {
    log.error("Failed to persist session", {
      sessionId,
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

  log.info("Checkout session created", {
    sessionId,
    cartId,
  } as Record<string, unknown>);

  return {
    status: 201,
    body: {
      success: true,
      data: { session: toClientSession(session) },
    },
    headers: setResult.headers,
  };
}
