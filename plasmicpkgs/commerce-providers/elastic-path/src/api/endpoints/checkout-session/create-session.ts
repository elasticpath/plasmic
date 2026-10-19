/**
 * A-4.1: Create Checkout Session
 *
 * Initialises a new checkout session for the shopper's session cart
 * (`ctx.sessionCartId`) and selected account (`checkout-account.ts`; none
 * for a guest); a cart id in the request body is ignored. Fetches the cart
 * from EP to compute the initial cart hash (used later in /pay to detect
 * cart mutations), stores the session via the SessionStore, and returns a 201
 * with the client-visible session shape plus Set-Cookie headers.
 */
import { randomUUID } from "crypto";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  SessionTotals,
} from "../../../checkout/session/types";
import { hashCart } from "../../../checkout/session/cart-hash";
import { readCartResponse } from "../../../ep-server-functions/read-cart";
import { buildAdminEpClient } from "../../../checkout/session/admin-client";
import { buildShopperEpClient } from "../../../checkout/session/shopper-client";
import { EP_SHIPPING_LINE_SKU } from "../../../checkout/session/set-shipping-line";
import { hasPurchasableItem } from "../../../checkout/session/purchasable-items";
import {
  totalsFromCart,
  totalsWithoutShipping,
} from "../../../checkout/session/session-totals";
import { CART_CLEANUP_PENDING, runCartCleanup } from "../../../checkout/session/cart-cleanup";
import { createLogger } from "../../../utils/logger";
import { toClientSession } from "../../../checkout/session/client-session";
import { selectedAccount } from "../../../checkout/session/checkout-account";

const log = createLogger("CreateSession");

async function refuseIfCleanupPending(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  cartId: string
): Promise<SessionResponse | null> {
  let previous: CheckoutSession | null = null;
  try {
    previous = await ctx.sessionStore.get("current", req);
  } catch {
    previous = null;
  }
  const pending =
    previous?.status === "complete" &&
    previous.cartId === cartId &&
    previous.payment.gatewayMetadata?.[CART_CLEANUP_PENDING] === true;
  if (!pending) return null;

  const cleaned = ctx.getClientCredentialsToken
    ? await runCartCleanup({
        host: ctx.epCredentials.apiBaseUrl,
        clientId: ctx.epCredentials.clientId,
        getClientCredentialsToken: ctx.getClientCredentialsToken,
        cartId,
      })
    : false;
  if (cleaned) return null;
  return {
    status: 409,
    body: {
      success: false,
      error: {
        message:
          "Your last order's items are still in your cart and could not be removed yet, so checkout cannot start. Please try again in a moment.",
        code: "CART_CLEANUP_PENDING",
      },
    },
  };
}

export async function handleCreateSession(
  req: SessionRequest,
  ctx: SessionHandlerContext
): Promise<SessionResponse> {
  const { body } = req;

  const cartId = ctx.sessionCartId;
  if (!cartId) {
    return {
      status: 409,
      body: {
        success: false,
        error: { message: "Your cart is empty", code: "NO_CART" },
      },
    };
  }

  const ttl = ctx.sessionTtlSeconds ?? 1800;

  // The last checkout on this cart could not remove its ordered lines: finish
  // that first, so this checkout cannot buy them again.
  const pending = await refuseIfCleanupPending(req, ctx, cartId);
  if (pending) return pending;

  // Authenticated client to read the cart (compute hash + totals). Prefer the
  // shopper token; fall back to the admin token when no shopper token is
  // present. A tokenless client cannot read a private cart (→ EP 401).
  const client = ctx.shopperAccessToken
    ? buildShopperEpClient(ctx)
    : await buildAdminEpClient(ctx);

  let cartItems: Array<{ id: string; quantity: number; unit_price?: { amount?: number }; value?: { amount?: number } }> = [];
  let totals: SessionTotals | null = null;
  let purchasable = false;

  try {
    const cartResponse = await readCartResponse(client, cartId, ctx);
    const items =
      (cartResponse as any)?.included?.items ??
      (cartResponse as any)?.data?.items ??
      [];
    // Match /pay: drop the storefront-managed shipping line so selecting a
    // rate cannot 409 the cart-hash check.
    cartItems = (Array.isArray(items) ? items : []).filter(
      (it: { sku?: string }) => it?.sku !== EP_SHIPPING_LINE_SKU
    );
    purchasable = hasPurchasableItem(items);
    totals = totalsWithoutShipping(totalsFromCart(cartResponse));
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

  if (!purchasable) {
    return {
      status: 409,
      body: {
        success: false,
        error: { message: "Your cart is empty", code: "EMPTY_CART" },
      },
    };
  }

  const cartHash = hashCart(cartItems);
  const sessionId = randomUUID();
  const now = Date.now();

  const requiresShipping =
    typeof body.requiresShipping === "boolean" ? body.requiresShipping : true;

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
    totals,
    requiresShipping,
    customAttributes: {},
    payment: {
      gateway: null,
      status: "idle",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: null,
    account: selectedAccount(ctx),
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
