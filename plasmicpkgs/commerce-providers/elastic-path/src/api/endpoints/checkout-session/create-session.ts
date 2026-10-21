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
import { hasPurchasableItem } from "../../../checkout/session/purchasable-items";
import {
  cartLines,
  totalsFromCart,
  totalsWithoutShipping,
} from "../../../checkout/session/session-totals";
import {
  shopperLines,
  type ShopperLine,
} from "../../../checkout/session/order-creation";
import { CART_CLEANUP_PENDING, runCartCleanup } from "../../../checkout/session/cart-cleanup";
import { isSettling } from "../../../checkout/session/settle-once";
import { isShippingLine } from "../../../checkout/session/shipping-line-sku";
import { releaseShippingLine } from "../../../checkout/session/shipping-line-scope";
import { createLogger } from "../../../utils/logger";
import { toClientSession } from "../../../checkout/session/client-session";
import {
  refuseHalfAccount,
  selectedAccount,
} from "../../../checkout/session/checkout-account";

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

  const halfAccount = refuseHalfAccount(ctx);
  if (halfAccount) return halfAccount;

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

  let cartItems: ShopperLine[] = [];
  let totals: SessionTotals | null = null;
  let purchasable = false;
  let leftShippingLine = false;

  try {
    const cartResponse = await readCartResponse(client, cartId, ctx);
    // Match /pay: drop the storefront-managed shipping line so selecting a
    // rate cannot 409 the cart-hash check.
    cartItems = shopperLines(cartResponse);
    purchasable = hasPurchasableItem(cartLines(cartResponse));
    totals = totalsWithoutShipping(totalsFromCart(cartResponse));
    leftShippingLine = cartLines(cartResponse).some(isShippingLine);
  } catch (err) {
    log.error("Failed to fetch cart from EP", {
      cartId,
      error: err instanceof Error ? err.message : String(err),
    });
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

  // A shipping line an earlier checkout or an older storefront left behind
  // comes out, so the cart shows what its lines cost.
  if (leftShippingLine && !isSettling(cartId) && ctx.getClientCredentialsToken) {
    try {
      await releaseShippingLine(await buildAdminEpClient(ctx), cartId);
    } catch (err) {
      log.warn("Could not take a left shipping line out of the cart", {
        cartId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
    });
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
  });

  return {
    status: 201,
    body: {
      success: true,
      data: { session: toClientSession(session) },
    },
    headers: setResult.headers,
  };
}
