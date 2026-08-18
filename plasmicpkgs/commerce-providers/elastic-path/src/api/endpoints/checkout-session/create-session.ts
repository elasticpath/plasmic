/**
 * A-4.1: Create Checkout Session
 *
 * Initialises a new checkout session for the given cartId. Fetches the cart
 * from EP to compute the initial cart hash (used later in /pay to detect
 * cart mutations), stores the session via the SessionStore, and returns a 201
 * with the client-visible session shape plus Set-Cookie headers.
 */
import { randomUUID } from "crypto";
import { getACart, createShopperClient } from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
  SessionTotals,
} from "../../../checkout/session/types";
import { hashCart } from "../../../checkout/session/cart-hash";
import { EP_SHIPPING_LINE_SKU } from "../../../checkout/session/set-shipping-line";
import { createLogger } from "../../../utils/logger";

const log = createLogger("CreateSession");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

/**
 * Derive session totals from an EP cart's `meta.display_price`. Returns null
 * when the cart carries no price meta (e.g. an empty cart) — the Stripe
 * Element then falls back to its default amount and /pay recomputes the total
 * from the live cart anyway.
 */
function extractTotals(cartData: any): SessionTotals | null {
  const dp = cartData?.meta?.display_price;
  if (!dp) return null;
  const total = dp.with_tax?.amount;
  if (typeof total !== "number") return null;
  return {
    subtotal: dp.without_tax?.amount ?? total,
    tax: dp.tax?.amount ?? 0,
    shipping: 0,
    total,
    currency: dp.with_tax?.currency ?? "",
  };
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

  // Authenticated client to read the cart (compute hash + totals). Prefer the
  // shopper token; fall back to the admin token when no shopper token is
  // present. A tokenless client cannot read a private cart (→ EP 401).
  let cartReadToken = ctx.shopperAccessToken ?? "";
  if (!cartReadToken && ctx.getClientCredentialsToken) {
    cartReadToken = await ctx.getClientCredentialsToken();
  }
  const { client } = createShopperClient(
    { baseUrl: ctx.epCredentials.apiBaseUrl },
    {
      clientId: ctx.epCredentials.clientId,
      storage: { get: () => cartReadToken, set: () => {} },
    },
  );

  let cartItems: Array<{ id: string; quantity: number; unit_price?: { amount?: number }; value?: { amount?: number } }> = [];
  let totals: SessionTotals | null = null;

  try {
    const cartResponse = await getACart({
      client,
      path: { cartID: cartId },
      query: { include: ["items"] },
    });
    const items =
      (cartResponse.data as any)?.included?.items ??
      (cartResponse.data as any)?.data?.items ??
      [];
    // Match /pay: drop the storefront-managed shipping line so selecting a
    // rate cannot 409 the cart-hash check.
    cartItems = (Array.isArray(items) ? items : []).filter(
      (it: { sku?: string }) => it?.sku !== EP_SHIPPING_LINE_SKU
    );
    totals = extractTotals((cartResponse.data as any)?.data);
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
