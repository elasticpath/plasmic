/**
 * handlePay — single-shot checkout flow.
 *
 * Slice 1 (this PR): anonymous guest happy path. Steps on success:
 *   1. Load session (→ 410 if missing)
 *   2. Guard: status open + gateway present + adapter registered + required fields
 *   3. Re-fetch cart, compare hash (→ 409 with refreshed session if mismatch)
 *   4. Adapter.initializePayment(session, { confirmation_token, ... })
 *      - The adapter calls EP's createCartPaymentIntent({ confirm: true, ... })
 *      - Returns "succeeded" or "failed" (slice 1)
 *   5. On succeeded:
 *      a. checkoutApi (cart→order) using admin token
 *      b. confirmOrder (sync PI status to EP) using admin token
 *      c. Run cart cleanup (deletes the EP cart; failures swallowed)
 *      d. applyPaymentSucceeded → session.status = "complete"
 *   6. On failed: applyPaymentFailed → session stays open, payment.status=failed
 *   7. Persist session, return 200
 *
 * Slices 2+ add: requires_action (3DS), subscription gate (ACCOUNT_REQUIRED),
 * account checkout body, resume-payment route.
 */
import {
  getACart,
  checkoutApi,
  confirmOrder,
  paymentSetup,
  updateACart,
  createShopperClient,
} from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
} from "../../../checkout/session/types";
import { hashCart } from "../../../checkout/session/cart-hash";
import { buildGuestCheckoutBody } from "../../../checkout/session/checkout-body-builder";
import { runCartCleanup } from "../../../checkout/session/cart-cleanup";
import { persistOrderCustomFields } from "../../../checkout/session/order-custom-fields";
import {
  applyPaymentSucceeded,
  applyPaymentFailed,
} from "../../../checkout/session/session-state-transition";
import { toCustomAttributes } from "../../../ep-server-functions/place-order";
import { createLogger } from "../../../utils/logger";

const log = createLogger("Pay");

/** Gateway + method used to settle a zero-total (free) order — EP best
 * practice, since third-party gateways reject a 0 charge. */
const FREE_ORDER_GATEWAY = "manual";
const FREE_ORDER_METHOD = "purchase";

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

/** Order total in EP minor units, summed across cart items. Prefers each
 * item's line `value.amount`; falls back to `unit_price.amount * quantity`.
 * Used to decide the free (== 0) vs paid (> 0) settlement path. */
function cartItemsTotal(
  items: Array<{
    quantity?: number;
    unit_price?: { amount?: number };
    value?: { amount?: number };
  }>
): number {
  return items.reduce((sum, it) => {
    const line =
      it.value?.amount ??
      (it.unit_price?.amount != null
        ? it.unit_price.amount * (it.quantity ?? 1)
        : 0);
    return sum + line;
  }, 0);
}

/** Persist the session's extra fields + consent flags as cart custom
 * attributes immediately before checkout, so they travel with the order. */
async function persistCustomAttributes(
  client: ReturnType<typeof createShopperClient>["client"],
  cartId: string,
  session: CheckoutSession
): Promise<void> {
  const attrs = toCustomAttributes(session.customAttributes);
  if (!attrs) return;
  try {
    await updateACart({
      client,
      path: { cartID: cartId },
      body: { data: { custom_attributes: attrs as never } },
    });
  } catch (err) {
    // Non-fatal: the order can still be placed without the extra attributes.
    log.warn("Failed to persist cart custom attributes", {
      cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
  }
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

async function buildAdminEpClient(ctx: SessionHandlerContext) {
  const token = ctx.getClientCredentialsToken
    ? await ctx.getClientCredentialsToken()
    : "";
  const { client } = createShopperClient(
    { baseUrl: ctx.epCredentials.apiBaseUrl },
    {
      clientId: ctx.epCredentials.clientId,
      storage: {
        get: () => token,
        set: () => {},
      },
    }
  );
  return client;
}

/**
 * Settle a zero-total order: cart → order, then a manual/purchase payment
 * (which authorises-and-captures with no card), then cart cleanup. EP's
 * documented approach for free orders — third-party gateways reject a 0
 * charge. Assumes the store has the manual gateway enabled.
 */
async function settleFreeOrder(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  session: CheckoutSession,
  adminClient: ReturnType<typeof createShopperClient>["client"],
  ttl: number
): Promise<SessionResponse> {
  // 1. checkoutApi (cart → order)
  let orderId: string;
  try {
    const checkoutResponse = await checkoutApi({
      client: adminClient,
      path: { cartID: session.cartId },
      body: buildGuestCheckoutBody(session) as any,
    });
    const oid = (checkoutResponse.data as any)?.data?.id;
    if (!oid) throw new Error("checkoutApi response missing order id");
    orderId = oid;
  } catch (err) {
    log.error("Free-order checkoutApi failed", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Free order creation failed", code: "EP_ERROR" },
      },
    };
  }

  // 1b. Write the checkout extras/consents onto the order as flow fields
  //     (best-effort — the order is already created). Needs the
  //     client_credentials grant via an explicit Bearer header.
  await persistOrderCustomFields({
    host: ctx.epCredentials.apiBaseUrl,
    token: ctx.getClientCredentialsToken ? await ctx.getClientCredentialsToken() : "",
    orderId,
    input: session.customAttributes,
  });

  // 2. manual/purchase settles the zero-total order with no card step.
  try {
    await paymentSetup({
      client: adminClient,
      path: { orderID: orderId },
      body: {
        data: { gateway: FREE_ORDER_GATEWAY, method: FREE_ORDER_METHOD },
      } as never,
    });
  } catch (err) {
    log.error("Manual settlement of free order failed", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: {
          message:
            "Free order could not be settled (is the manual gateway enabled?)",
          code: "EP_ERROR",
        },
      },
    };
  }

  // 3. Cart cleanup — best-effort housekeeping.
  if (ctx.getClientCredentialsToken) {
    await runCartCleanup({
      host: ctx.epCredentials.apiBaseUrl,
      clientId: ctx.epCredentials.clientId,
      getClientCredentialsToken: ctx.getClientCredentialsToken,
      cartId: session.cartId,
    });
  }

  // 4. Mark complete and persist.
  const completeSession = applyPaymentSucceeded(
    { ...session, payment: { ...session.payment, gateway: FREE_ORDER_GATEWAY } },
    { orderId, paymentIntentId: "", gatewayMetadata: { free: true } }
  );

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", completeSession, ttl, req);
  } catch (err) {
    log.error("Failed to persist complete free-order session", {
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

  log.info("Free order settled", {
    sessionId: completeSession.id,
    orderId,
  } as Record<string, unknown>);

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(completeSession) },
    },
    headers: setResult.headers,
  };
}

export async function handlePay(
  req: SessionRequest,
  ctx: SessionHandlerContext
): Promise<SessionResponse> {
  const ttl = ctx.sessionTtlSeconds ?? 1800;

  // 1. Load session
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

  // 2a. Double-submit guard
  if (session.status !== "open") {
    return {
      status: 400,
      body: {
        success: false,
        error: { message: "Session is not open", code: "SESSION_NOT_OPEN" },
      },
    };
  }

  // 2b. Validate required checkout fields. Shipping address + rate are only
  //     required when the checkout collects shipping (requiresShipping !==
  //     false) — digital / single-page checkouts skip them.
  const requiresShipping = session.requiresShipping !== false;
  const missingFields: string[] = [];
  if (!session.customerInfo) missingFields.push("customerInfo");
  if (!session.billingAddress) missingFields.push("billingAddress");
  if (requiresShipping && !session.shippingAddress)
    missingFields.push("shippingAddress");
  if (requiresShipping && !session.selectedShippingRateId)
    missingFields.push("selectedShippingRateId");

  if (missingFields.length > 0) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: `Missing required fields: ${missingFields.join(", ")}`,
          code: "MISSING_FIELDS",
        },
      },
    };
  }

  // 3. Re-fetch cart and compare hash
  const shopperClient = buildShopperEpClient(ctx);
  let freshCartItems: Array<{
    id: string;
    quantity: number;
    unit_price?: { amount?: number };
    value?: { amount?: number };
  }> = [];
  // Authoritative cart total comes from the cart's `meta.display_price` — the
  // same source create-session uses. Summing parsed items is unreliable (the
  // item array can live in different response shapes), so the free/paid branch
  // must NOT depend on it, or a paid cart whose items don't parse would settle
  // for free with no charge.
  let cartMetaTotal: number | null = null;
  try {
    const cartResponse = await getACart({
      client: shopperClient,
      path: { cartID: session.cartId },
    });
    const items =
      (cartResponse.data as any)?.included?.items ??
      (cartResponse.data as any)?.data?.items ??
      [];
    freshCartItems = Array.isArray(items) ? items : [];
    const metaAmount = (cartResponse.data as any)?.data?.meta?.display_price
      ?.with_tax?.amount;
    if (typeof metaAmount === "number") cartMetaTotal = metaAmount;
  } catch (err) {
    log.error("Failed to re-fetch cart for hash check", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Failed to fetch cart", code: "EP_ERROR" },
      },
    };
  }

  const freshHash = hashCart(freshCartItems);
  if (freshHash !== session.cartHash) {
    const refreshed: CheckoutSession = { ...session, cartHash: freshHash };
    try {
      const setResult = await ctx.sessionStore.set("current", refreshed, ttl, req);
      return {
        status: 409,
        body: {
          success: false,
          error: {
            message: "Cart has changed since session was created",
            code: "CART_MISMATCH",
          },
          data: { session: toClientSession(refreshed) },
        },
        headers: setResult.headers,
      };
    } catch {
      return {
        status: 409,
        body: {
          success: false,
          error: {
            message: "Cart has changed since session was created",
            code: "CART_MISMATCH",
          },
        },
      };
    }
  }

  // 3b. Admin client + persist the session's extra fields/consents as cart
  //     custom attributes (best-effort) before any checkout.
  const adminClient = await buildAdminEpClient(ctx);
  await persistCustomAttributes(adminClient, session.cartId, session);

  // 3c. Free-order (zero-total) branch. Stripe and other third-party gateways
  //     reject a 0 charge, so EP best practice is to settle a free order with
  //     the manual gateway — no card, no PaymentIntent. Run it before any
  //     gateway/adapter requirement so a free checkout needs no payment UI.
  // Prefer the authoritative cart-meta total; fall back to summing items only
  // when meta is unavailable. A truly free cart has meta total 0.
  const orderTotal =
    cartMetaTotal !== null ? cartMetaTotal : cartItemsTotal(freshCartItems);
  if (orderTotal === 0) {
    return await settleFreeOrder(req, ctx, session, adminClient, ttl);
  }

  // 4. Paid path — a gateway + registered adapter are required.
  const gateway = req.body.gateway;
  if (!gateway || typeof gateway !== "string") {
    return {
      status: 400,
      body: {
        success: false,
        error: { message: "gateway is required", code: "VALIDATION_ERROR" },
      },
    };
  }
  const adapter = ctx.adapterRegistry.getAdapter(gateway);
  if (!adapter) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: `Unknown payment gateway: ${gateway}`,
          code: "UNKNOWN_GATEWAY",
        },
      },
    };
  }

  // 4a. Single-shot: delegate to adapter (creates+confirms PaymentIntent)
  const { gateway: _gw, ...gatewayData } = req.body as Record<string, unknown>;

  let adapterResult: Awaited<ReturnType<typeof adapter.initializePayment>>;
  try {
    adapterResult = await adapter.initializePayment(session, gatewayData);
  } catch (err) {
    log.error("Payment adapter threw", {
      gateway,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Payment adapter error", code: "ADAPTER_ERROR" },
      },
    };
  }

  // 6. Failed branch — leave session open for retry
  if (adapterResult.status === "failed") {
    const failedSession: CheckoutSession = applyPaymentFailed(
      {
        ...session,
        payment: { ...session.payment, gateway },
      },
      {
        errorMessage: adapterResult.errorMessage,
        gatewayMetadata: adapterResult.gatewayMetadata,
      }
    );

    let setResult: { headers: Record<string, string> };
    try {
      setResult = await ctx.sessionStore.set("current", failedSession, ttl, req);
    } catch (err) {
      log.error("Failed to persist failed-payment session", {
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
        data: { session: toClientSession(failedSession) },
        ...(adapterResult.errorMessage
          ? { paymentError: adapterResult.errorMessage }
          : {}),
      },
      headers: setResult.headers,
    };
  }

  // 5. Succeeded branch — create EP order, confirm, clean up cart
  if (adapterResult.status !== "succeeded") {
    // requires_action / ready ship in slice 2; treat as failed for slice 1.
    log.warn("Adapter returned non-terminal status; treating as failed", {
      status: adapterResult.status,
    } as Record<string, unknown>);
    const failedSession = applyPaymentFailed(
      { ...session, payment: { ...session.payment, gateway } },
      {
        errorMessage: `Unsupported adapter status: ${adapterResult.status}`,
      }
    );
    const setResult = await ctx.sessionStore.set(
      "current",
      failedSession,
      ttl,
      req
    );
    return {
      status: 200,
      body: { success: true, data: { session: toClientSession(failedSession) } },
      headers: setResult.headers,
    };
  }

  // 5a. checkoutApi (cart → order) using admin token
  let orderId: string;
  try {
    const checkoutResponse = await checkoutApi({
      client: adminClient,
      path: { cartID: session.cartId },
      body: buildGuestCheckoutBody(session) as any,
    });
    const oid = (checkoutResponse.data as any)?.data?.id;
    if (!oid) throw new Error("checkoutApi response missing order id");
    orderId = oid;
  } catch (err) {
    log.error("EP checkoutApi failed after payment success", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: {
          message: "Payment succeeded but order creation failed",
          code: "EP_ERROR",
        },
      },
    };
  }

  // 5a-bis. Write the checkout extras/consents onto the order as flow fields
  //         (best-effort — the order is already created and paid). Needs the
  //         client_credentials grant via an explicit Bearer header.
  await persistOrderCustomFields({
    host: ctx.epCredentials.apiBaseUrl,
    token: ctx.getClientCredentialsToken ? await ctx.getClientCredentialsToken() : "",
    orderId,
    input: session.customAttributes,
  });

  // 5b. confirmOrder — syncs the EP-side payment intent status to the order.
  try {
    await confirmOrder({
      client: adminClient,
      path: {
        orderID: orderId,
        // The EP API requires the paymentID on this path. The PI id from the
        // adapter result is what EP returned as the cart's payment intent.
        paymentID: (adapterResult.gatewayOrderId ??
          (adapterResult.gatewayMetadata?.paymentIntentId as string)) as string,
      } as any,
      body: { data: {} } as any,
    });
  } catch (err) {
    log.warn("confirmOrder failed (non-fatal — order is genuine)", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
  }

  // 5c. Cart cleanup — best-effort housekeeping
  if (ctx.getClientCredentialsToken) {
    await runCartCleanup({
      host: ctx.epCredentials.apiBaseUrl,
      clientId: ctx.epCredentials.clientId,
      getClientCredentialsToken: ctx.getClientCredentialsToken,
      cartId: session.cartId,
    });
  }

  // 5d. Mark complete and persist
  const completeSession = applyPaymentSucceeded(
    { ...session, payment: { ...session.payment, gateway } },
    {
      orderId,
      paymentIntentId:
        (adapterResult.gatewayOrderId as string) ??
        ((adapterResult.gatewayMetadata?.paymentIntentId as string) ?? ""),
      gatewayMetadata: adapterResult.gatewayMetadata,
    }
  );

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", completeSession, ttl, req);
  } catch (err) {
    log.error("Failed to persist complete session", {
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

  log.info("Pay handler completed", {
    sessionId: completeSession.id,
    orderId,
  } as Record<string, unknown>);

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(completeSession) },
    },
    headers: setResult.headers,
  };
}
