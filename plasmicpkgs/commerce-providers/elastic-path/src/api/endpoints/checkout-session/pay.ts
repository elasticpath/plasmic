/**
 * handlePay — takes payment for the checkout session's cart.
 *
 *   1. Load the session (410 when missing). A session that is not open gets
 *      400; one whose cart PaymentIntent waits for a 3DS challenge gets 409
 *      PAYMENT_ACTION_PENDING with the session. The rest runs under the
 *      per-cart settle-once guard. 409 ACCOUNT_CHANGED (session dropped)
 *      when the shopper's selected account is not the session's.
 *   2. Re-read the cart: 409 EMPTY_CART with nothing to buy, 409 CART_MISMATCH
 *      (session refreshed) when its lines changed, 400 MISSING_FIELDS or
 *      INVALID_EMAIL.
 *   3. Re-assert (or clear) the shipping line, then charge only the total the
 *      session last showed (409 TOTAL_CHANGED otherwise). A zero total settles
 *      for free with the manual gateway (`free-order.ts`). The line comes out
 *      of the cart again when pay ends (`shipping-line-scope.ts`).
 *   4. Dispatch on the adapter's payment sequence:
 *      - cart_payment_intent: initializePayment. On success, checkout →
 *        confirmOrder → finalize. When 3DS is needed, the order is created
 *        first and the challenge is returned only when its total is the shown
 *        total; resume-payment later confirms that held order.
 *      - order_first: checkout (or reuse an unpaid session order) →
 *        buildPaymentSetup → paymentSetup.
 *      - legacy (Clover): initializePayment only.
 *   An order whose total is not the shown total takes no payment: it is
 *   cancelled and 409 ORDER_TOTAL_CHANGED returns the session with that total.
 */
import { getAnOrder, updateACart } from "@epcc-sdk/sdks-shopper";
import type { Client } from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  CartPaymentIntentAdapter,
  LegacyPaymentAdapter,
  OrderFirstAdapter,
  PaymentAdapterResult,
} from "../../../checkout/session/types";
import {
  isCartPaymentIntentAdapter,
  isLegacyPaymentAdapter,
  isOrderFirstAdapter,
} from "../../../checkout/session/payment-sequence";
import { hashCart } from "../../../checkout/session/cart-hash";
import { readCartResponse } from "../../../ep-server-functions/read-cart";
import { clearCartPaymentIntentId } from "../../../checkout/session/clear-cart-payment-intent";
import { filterAllowedCustomAttributes } from "../../../checkout/session/custom-attributes-allowlist";
import {
  resolveRequiresShipping,
  cartHasPhysicalItem,
} from "../../../checkout/session/cart-shipping";
import { buildAdminEpClient } from "../../../checkout/session/admin-client";
import { buildShopperEpClient } from "../../../checkout/session/shopper-client";
import {
  applyShippingSelection,
  ShippingResolutionError,
} from "../../../checkout/session/apply-shipping-selection";
import { clearCartShippingLine } from "../../../checkout/session/set-shipping-line";
import {
  applyPaymentFailed,
  applyPaymentRequiresAction,
} from "../../../checkout/session/session-state-transition";
import { finalizePaidSession } from "../../../checkout/session/finalize-paid-session";
import { readOrderTotal, type OrderTotal } from "../../../checkout/session/order-total";
import {
  checkoutFailureReason,
  checkoutRejectedReviewMessage,
  confirmCartPaymentOrder,
  createOrderFromCart,
  endCheckoutForReview,
  markOrderForReconciliation,
  refuseOrderTotal,
  shopperLines,
  writeOrderCustomFields,
  type ShopperLine,
} from "../../../checkout/session/order-creation";
import { settleFreeOrder } from "../../../checkout/session/free-order";
import { isOrderPaid } from "../../../checkout/session/payment-intent-status";
import {
  orderRuleInput,
  takeOrderPayment,
} from "../../../checkout/session/order-payment";
import { toCustomAttributes } from "../../../ep-server-functions/place-order";
import { createLogger } from "../../../utils/logger";
import { formatMinor } from "../../../utils/price";
import { toClientSession } from "../../../checkout/session/client-session";
import type { EpCartResponse, SessionTotals } from "../../../checkout/session/types";
import { hasPurchasableItem } from "../../../checkout/session/purchasable-items";
import { invalidEmail, isCheckoutEmail } from "../../../checkout/session/checkout-email";
import {
  cartLines,
  totalsFromCart,
} from "../../../checkout/session/session-totals";
import { settleOnceOrBusy } from "../../../checkout/session/settle-once";
import {
  quoteSessionTotals,
  releasingShippingLine,
} from "../../../checkout/session/shipping-line-scope";
import { refuseChangedAccount } from "../../../checkout/session/checkout-account";
import {
  awaitsCartPaymentChallenge,
  paymentActionPending,
} from "../../../checkout/session/payment-challenge";

const log = createLogger("Pay");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapOrderResource(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  const data = asRecord(root.data);
  const inner = data ? asRecord(data.data) : null;
  return inner ?? data ?? (typeof root.payment === "string" ? root : null);
}

/**
 * Read documented OrderResponse.payment from getAnOrder.
 * `paid` / `authorized` are order-level payment, not TransactionResponse.status.
 */
function settledOrderFromGetAnOrder(payload: unknown): {
  settled: boolean;
  payment?: string;
} {
  const order = unwrapOrderResource(payload);
  if (!order) return { settled: false };
  const payment =
    typeof order.payment === "string" ? order.payment.toLowerCase() : undefined;
  return {
    settled: isOrderPaid(payment),
    payment,
  };
}

/** Persist the session's extra fields + consent flags as cart custom
 * attributes immediately before checkout, so they travel with the order. */
async function persistCustomAttributes(
  client: Client,
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
    });
  }
}

type AdminClient = Client;

interface PayContinuation {
  req: SessionRequest;
  ctx: SessionHandlerContext;
  session: CheckoutSession;
  adminClient: AdminClient;
  ttl: number;
  gateway: string;
  gatewayData: Record<string, unknown>;
  /** The total the session last showed the shopper; the only total pay takes. */
  expectedTotal: number;
}

async function persistTotalChanged(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  refreshed: CheckoutSession,
  ttl: number
): Promise<SessionResponse> {
  const error = {
    message: "The order total changed; review the total and try again",
    code: "TOTAL_CHANGED",
  };
  try {
    const setResult = await ctx.sessionStore.set("current", refreshed, ttl, req);
    return {
      status: 409,
      body: {
        success: false,
        error,
        data: { session: toClientSession(refreshed) },
      },
      headers: setResult.headers,
    };
  } catch {
    return { status: 409, body: { success: false, error } };
  }
}

function orderTotalChanged(
  params: PayContinuation,
  orderId: string,
  total: OrderTotal | null
): Promise<SessionResponse> {
  const { req, ctx, session, adminClient, ttl } = params;
  return refuseOrderTotal({ req, ctx, session, ttl, client: adminClient, orderId, total });
}

async function persistRequiresAction(
  params: PayContinuation,
  adapterResult: PaymentAdapterResult
): Promise<SessionResponse> {
  const { req, ctx, session, ttl, gateway } = params;
  const actionSession: CheckoutSession = applyPaymentRequiresAction(
    {
      ...session,
      payment: { ...session.payment, gateway },
    },
    {
      clientToken: adapterResult.clientToken ?? null,
      actionData: adapterResult.actionData ?? null,
      gatewayMetadata: adapterResult.gatewayMetadata,
    }
  );

  try {
    const setResult = await ctx.sessionStore.set(
      "current",
      actionSession,
      ttl,
      req
    );
    return {
      status: 200,
      body: {
        success: true,
        data: { session: toClientSession(actionSession) },
      },
      headers: setResult.headers,
    };
  } catch (err) {
    log.error("Failed to persist requires_action session", {
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
}

async function persistFailedPayment(
  params: PayContinuation,
  adapterResult: PaymentAdapterResult
): Promise<SessionResponse> {
  const { req, ctx, session, ttl, gateway } = params;
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

  try {
    const setResult = await ctx.sessionStore.set(
      "current",
      failedSession,
      ttl,
      req
    );
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
  } catch (err) {
    log.error("Failed to persist failed-payment session", {
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
}

/**
 * A cart PaymentIntent waits for a 3DS challenge. The order is created now,
 * from the cart the PaymentIntent was priced on, so a cart change during the
 * challenge cannot change what is ordered. The challenge is handed to the
 * shopper only when that order's total is the total the shopper was shown.
 */
async function holdOrderForChallenge(
  params: PayContinuation,
  adapterResult: PaymentAdapterResult
): Promise<SessionResponse> {
  const { ctx, session, adminClient, expectedTotal } = params;

  const release = async () => {
    const cleared = await clearCartPaymentIntentId({
      client: adminClient,
      cartId: session.cartId,
    });
    if (!cleared.ok) {
      log.error("Failed to unlink a refused PaymentIntent from the cart", {
        cartId: session.cartId,
        error: cleared.errorMessage,
      });
    }
  };

  const created = await createOrderFromCart(adminClient, session, {
    message: "Order creation failed",
    logMessage: "EP checkoutApi failed before the payment challenge",
  });
  if (created.response) {
    await release();
    return created.response;
  }
  const orderId = created.order.id;
  const total = await readOrderTotal(adminClient, orderId, created.order);

  if (total?.amount !== expectedTotal) {
    log.warn("Order total differs from the session total; not starting the challenge", {
      sessionId: session.id,
      orderId,
    });
    await release();
    return orderTotalChanged(params, orderId, total);
  }

  await writeOrderCustomFields(ctx, orderId, session);

  return persistRequiresAction(
    { ...params, session: { ...session, order: { id: orderId } } },
    adapterResult
  );
}

/** Cart PaymentIntent sequence (Stripe) and Clover legacy initializePayment. */
async function handleInitializePaymentPay(
  params: PayContinuation,
  adapter: CartPaymentIntentAdapter | LegacyPaymentAdapter
): Promise<SessionResponse> {
  const { req, ctx, session, adminClient, ttl, gateway, gatewayData } = params;

  let adapterResult: PaymentAdapterResult;
  try {
    adapterResult = await adapter.initializePayment(session, gatewayData);
  } catch (err) {
    log.error("Payment adapter threw", {
      gateway,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Payment adapter error", code: "ADAPTER_ERROR" },
      },
    };
  }

  if (adapterResult.status === "requires_action") {
    return isCartPaymentIntentAdapter(adapter)
      ? holdOrderForChallenge(params, adapterResult)
      : persistRequiresAction(params, adapterResult);
  }

  if (adapterResult.status === "failed") {
    return persistFailedPayment(params, adapterResult);
  }

  if (adapterResult.status !== "succeeded") {
    log.warn("Adapter returned non-terminal status; treating as failed", {
      status: adapterResult.status,
    });
    return persistFailedPayment(params, {
      status: "failed",
      errorMessage: `Unsupported adapter status: ${adapterResult.status}`,
    });
  }

  const created = await createOrderFromCart(adminClient, session, {
    message: "Payment succeeded but order creation failed",
    logMessage: "EP checkoutApi failed after payment success",
  });
  if (created.response) {
    // The payment was taken and no order was created. Checkout is not
    // retried: a failed or lost response may still have created an order
    // that carries the PaymentIntent.
    return endCheckoutForReview({
      req,
      ctx,
      ttl,
      session: { ...session, payment: { ...session.payment, gateway } },
      client: adminClient,
      paymentReference: adapterResult.gatewayOrderId ?? "unknown",
      reason: checkoutFailureReason(created.rejection),
      message: checkoutRejectedReviewMessage(created.rejection),
    });
  }
  const orderId = created.order.id;
  const orderTotal = await readOrderTotal(adminClient, orderId, created.order);
  const charged = chargedAmount(adapterResult, params.expectedTotal);

  await writeOrderCustomFields(ctx, orderId, session);

  const paymentID = adapterResult.gatewayOrderId;
  let reconciliationError: string | null = null;
  if (!paymentID) {
    reconciliationError = "missing gateway payment id";
    log.error("Cannot reconcile order — no gateway payment id", {
      orderId,
    });
  } else {
    try {
      await confirmCartPaymentOrder(adminClient, orderId);
    } catch (err) {
      reconciliationError = err instanceof Error ? err.message : String(err);
      log.error("confirmOrder failed — order charged but unreconciled", {
        orderId,
        paymentID,
        error: reconciliationError,
      });
    }
  }

  // A cart write that landed between the charge and the order (from outside
  // this storefront) gives an order the charge does not cover.
  const totalDiffers = orderTotal !== null && orderTotal.amount !== charged;
  if (totalDiffers) {
    reconciliationError ??= "order total differs from the amount charged";
    await markOrderForReconciliation(adminClient, orderId, paymentID ?? "unknown");
  }

  log.info("Pay handler completed", {
    sessionId: session.id,
    orderId,
    reconciliationPending: reconciliationError !== null,
  });

  const finalized = await finalizePaidSession({
    ctx,
    req,
    ttl,
    session,
    gateway,
    orderId,
    paymentIntentId: paymentID,
    gatewayMetadata: adapterResult.gatewayMetadata,
    reconciliationError,
  });
  if (!totalDiffers || finalized.status !== 200) return finalized;
  return {
    ...finalized,
    status: 409,
    body: {
      ...(finalized.body as Record<string, unknown>),
      success: false,
      error: {
        message: orderTotalDiffersMessage(charged, orderTotal?.amount, orderTotal?.currency ?? session.totals?.currency),
        code: "PAYMENT_NEEDS_REVIEW",
      },
      reconciliationPending: true,
    },
  };
}

/** The amount the gateway took: its own figure when it reports one, else the shown total. */
function chargedAmount(result: PaymentAdapterResult, shownTotal: number): number {
  const amount = result.gatewayMetadata?.amount;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : shownTotal;
}

function money(amount: number | undefined, currency: string | undefined): string {
  if (typeof amount !== "number") return "a different amount";
  return currency ? formatMinor(amount, currency) : String(amount);
}

function orderTotalDiffersMessage(
  charged: number,
  orderTotal: number | undefined,
  currency: string | undefined
): string {
  return `Your order was placed, but its total (${money(orderTotal, currency)}) is not the amount we charged (${money(charged, currency)}) because your cart changed while paying. We will contact you to settle the difference.`;
}

async function handleOrderFirstPay(
  params: PayContinuation,
  adapter: OrderFirstAdapter
): Promise<SessionResponse> {
  const { req, ctx, session, adminClient, ttl, gateway, gatewayData } = params;

  const existingOrderId = session.order?.id;
  const reuseOrder =
    session.status === "open" &&
    session.payment.status !== "succeeded" &&
    typeof existingOrderId === "string" &&
    existingOrderId.length > 0;

  let orderId: string;
  let sessionWithOrder: CheckoutSession;

  if (reuseOrder) {
    orderId = existingOrderId;
    sessionWithOrder = {
      ...session,
      order: { ...session.order, id: orderId },
      payment: { ...session.payment, gateway },
    };

    let orderPayload: unknown;
    try {
      orderPayload = await getAnOrder({
        client: adminClient,
        path: { orderID: orderId },
      });
    } catch (err) {
      log.error("getAnOrder failed before retry paymentSetup", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        status: 502,
        body: {
          success: false,
          error: {
            message: "Failed to load existing order",
            code: "EP_ERROR",
          },
        },
      };
    }

    const existing = settledOrderFromGetAnOrder(orderPayload);
    const orderResource = unwrapOrderResource(orderPayload);
    const epError = asRecord(orderPayload)?.error;
    if (epError || !orderResource || typeof existing.payment !== "string") {
      log.error("getAnOrder returned no usable order payment status", {
        orderId,
      });
      return {
        status: 502,
        body: {
          success: false,
          error: {
            message: "Failed to load existing order",
            code: "EP_ERROR",
          },
        },
      };
    }
    if (existing.settled) {
      log.info("Order-first retry found already-settled order", {
        sessionId: session.id,
        orderId,
        payment: existing.payment,
      });
      return finalizePaidSession({
        ctx,
        req,
        ttl,
        session: sessionWithOrder,
        gateway,
        orderId,
        gatewayMetadata: {
          ...(session.payment.gatewayMetadata ?? {}),
          ...(existing.payment ? { orderPayment: existing.payment } : {}),
        },
      });
    }
    const reused = await readOrderTotal(
      adminClient,
      orderId,
      orderResource as Parameters<typeof readOrderTotal>[2]
    );
    if (reused?.amount !== params.expectedTotal) {
      log.warn("Unpaid order total differs from the session total; dropping it", {
        sessionId: session.id,
        orderId,
      });
      return orderTotalChanged(params, orderId, reused);
    }
  } else {
    const created = await createOrderFromCart(adminClient, session, {
      message: "Order creation failed",
      logMessage: "EP checkoutApi failed before paymentSetup",
    });
    if (created.response) return created.response;
    orderId = created.order.id;
    const total = await readOrderTotal(adminClient, orderId, created.order);
    if (total?.amount !== params.expectedTotal) {
      log.warn("Order total differs from the session total; not taking payment", {
        sessionId: session.id,
        orderId,
      });
      return orderTotalChanged(params, orderId, total);
    }

    sessionWithOrder = {
      ...session,
      order: { id: orderId },
      payment: { ...session.payment, gateway },
    };

    try {
      await ctx.sessionStore.set("current", sessionWithOrder, ttl, req);
    } catch (err) {
      log.error("Failed to persist unpaid order session", {
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
  }

  await writeOrderCustomFields(ctx, orderId, session);

  const withOrder: PayContinuation = { ...params, session: sessionWithOrder };

  let setup;
  try {
    setup = await adapter.buildPaymentSetup(sessionWithOrder, gatewayData);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("buildPaymentSetup threw", {
      gateway,
      error: message,
    });
    return persistFailedPayment(withOrder, {
      status: "failed",
      errorMessage: message,
      gatewayMetadata: { lastError: message },
    });
  }

  const { result: adapterResult } = await takeOrderPayment(
    adminClient,
    orderId,
    setup
  );

  if (adapterResult.status === "requires_action") {
    return persistRequiresAction(withOrder, adapterResult);
  }
  if (adapterResult.status !== "succeeded") {
    return persistFailedPayment(withOrder, adapterResult);
  }

  log.info("Order-first pay completed", {
    sessionId: session.id,
    orderId,
  });

  return finalizePaidSession({
    ctx,
    req,
    ttl,
    session: sessionWithOrder,
    gateway,
    orderId,
    transactionId: adapterResult.gatewayOrderId,
    gatewayMetadata: adapterResult.gatewayMetadata,
  });
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

  if (awaitsCartPaymentChallenge(session, ctx)) {
    return paymentActionPending(session);
  }

  const open = session;
  return settleOnceOrBusy(open, () =>
    releasingShippingLine(ctx, open.cartId, () => payOpenSession(req, ctx, open, ttl))
  );
}

async function payOpenSession(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  session: CheckoutSession,
  ttl: number
): Promise<SessionResponse> {
  const accountChanged = await refuseChangedAccount(req, ctx, session);
  if (accountChanged) return accountChanged;

  // 2b. Required-field validation is deferred to step 3a (after the cart
  //     fetch), because whether shipping is required is server-authoritative —
  //     inferred from the cart's physical items, not just the client flag — so
  //     all missing fields (contact + shipping) are reported in one response.

  // 2c. Re-apply the customAttributes allow-list before any persistence
  //     (defence in depth — updateSession already gated these on the way in).
  //     Every downstream write (cart custom_attributes, order flow fields, on
  //     both the paid and free branches) reads session.customAttributes, so
  //     filtering once here gates them all. Fail closed: with no allow-list
  //     configured, nothing persists.
  {
    const { allowed, dropped } = filterAllowedCustomAttributes(
      session.customAttributes,
      ctx.allowedCustomAttributeKeys
    );
    if (dropped.length > 0) {
      // Keys only — never the values (they may be PII).
      log.warn("Dropped customAttribute keys not on the allow-list", {
        sessionId: session.id,
        dropped: dropped.join(","),
        allowListConfigured: ctx.allowedCustomAttributeKeys !== undefined,
      });
    }
    session = { ...session, customAttributes: allowed };
  }

  // 3. Re-fetch cart and compare hash
  const shopperClient = buildShopperEpClient(ctx);
  let freshCartItems: ShopperLine[] = [];
  // Authoritative cart total comes from the cart's `meta.display_price` — the
  // same source create-session uses. Summing parsed items is unreliable (the
  // item array can live in different response shapes), so the free/paid branch
  // must NOT depend on it, or a paid cart whose items don't parse would settle
  // for free with no charge.
  let latest: SessionTotals | null = null;
  let cartResponse: EpCartResponse;
  try {
    cartResponse = await readCartResponse(
      shopperClient,
      session.cartId,
      ctx
    );
    // Exclude the storefront-managed shipping line (sentinel SKU) from BOTH the
    // hash and the physical-item lookup. It is server-written (during selection
    // and re-asserted at pay), not a shopper item, so its presence/absence must
    // never trip the cart-mismatch 409 — otherwise every shipping selection
    // would 409 at pay (the create-session hash predates the line).
    freshCartItems = shopperLines(cartResponse);
    latest = totalsFromCart(cartResponse);
  } catch (err) {
    log.error("Failed to re-fetch cart for hash check", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Failed to fetch cart", code: "EP_ERROR" },
      },
    };
  }

  if (!hasPurchasableItem(cartLines(cartResponse))) {
    return {
      status: 409,
      body: {
        success: false,
        error: { message: "Your cart is empty", code: "EMPTY_CART" },
      },
    };
  }

  const freshHash = hashCart(freshCartItems);
  if (freshHash !== session.cartHash) {
    const quoted = latest
      ? await quoteSessionTotals(ctx, session, cartResponse)
      : { totals: session.totals, selectedShippingRateId: session.selectedShippingRateId };
    const refreshed: CheckoutSession = {
      ...session,
      cartHash: freshHash,
      ...quoted,
    };
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

  // 3a. Required-field validation + server-authoritative shipping requirement.
  //     EP requires a shipping address on every checkout (the body builder
  //     defaults it to billing), so a client could set requiresShipping:false
  //     on a PHYSICAL cart and have the goods silently ship to billing. The
  //     client flag may only ADD a requirement: if the cart has any physical
  //     item, shipping is required regardless. We only pay for the product
  //     lookup when the client tried to suppress shipping — the normal path
  //     needs no extra call.
  let cartHasPhysical = false;
  if (session.requiresShipping === false) {
    cartHasPhysical = await cartHasPhysicalItem(
      ctx,
      freshCartItems.map((it) => it.product_id ?? "").filter(Boolean)
    );
    if (cartHasPhysical) {
      log.warn("Physical cart overrode client requiresShipping:false", {
        sessionId: session.id,
      });
    }
  }
  const requiresShipping = resolveRequiresShipping(
    session.requiresShipping,
    cartHasPhysical
  );
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
  if (!isCheckoutEmail(session.customerInfo?.email)) return invalidEmail();

  // 3b. Admin client + persist the session's extra fields/consents as cart
  //     custom attributes (best-effort) before any checkout.
  const adminClient = await buildAdminEpClient(ctx);
  await persistCustomAttributes(adminClient, session.cartId, session);

  // 3b-bis. [Slice #4] Authoritative shipping line at pay.
  //
  //   When requiresShipping: re-assert the server-resolved shipping line. The
  //   cart is shopper-mutable, so a line written at selection can be lowered or
  //   stripped before pay. FAIL CLOSED: a resolvable rate must back the charge
  //   (step 3a already requires selectedShippingRateId). Empty /
  //   irreconcilable rates → 409, never a free ship. The amount is always
  //   server-owned — the client never supplies it. Re-write BEFORE the charge
  //   (adapter PaymentIntent / free-settlement checkout).
  //
  //   When !requiresShipping: CLEAR every managed __ep_shipping line
  //   before free/paid branching or payment init. A digital cart may still
  //   carry a stale line (rate selected then shipping requirement cleared, or
  //   selectedShippingRateId left populated). Effective requiresShipping is
  //   authoritative — never re-write shipping just because a rate id exists.
  if (requiresShipping) {
    try {
      const pricedCart = await applyShippingSelection(ctx, session, {
        client: adminClient,
      });
      latest = totalsFromCart(pricedCart);
    } catch (err) {
      if (err instanceof ShippingResolutionError) {
        log.warn("Selected shipping rate no longer resolvable at pay", {
          sessionId: session.id,
          error: err.message,
        });
        return {
          status: 409,
          body: {
            success: false,
            error: {
              message:
                "Selected shipping rate is no longer available; recalculate shipping",
              code: "SHIPPING_RATE_UNRESOLVABLE",
            },
          },
        };
      }
      log.error("Failed to re-assert shipping line before pay", {
        cartId: session.cartId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        status: 502,
        body: {
          success: false,
          error: { message: "Failed to apply shipping", code: "EP_ERROR" },
        },
      };
    }
  } else {
    let deletedCount = 0;
    try {
      const clearResult = await clearCartShippingLine(adminClient, {
        cartId: session.cartId,
      });
      deletedCount = clearResult.deletedCount;
    } catch (err) {
      log.error("Failed to clear stale shipping line before pay", {
        cartId: session.cartId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        status: 502,
        body: {
          success: false,
          error: { message: "Failed to apply shipping", code: "EP_ERROR" },
        },
      };
    }

    // Only refresh totals when the cart actually changed. A no-op clear leaves
    // the hash-step totals authoritative.
    if (deletedCount > 0) {
      try {
        const reread = await readCartResponse(
          shopperClient,
          session.cartId,
          ctx
        );
        latest = totalsFromCart(reread);
      } catch (err) {
        log.error("Failed to re-read cart total after clearing shipping line", {
          cartId: session.cartId,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          status: 502,
          body: {
            success: false,
            error: { message: "Failed to fetch cart", code: "EP_ERROR" },
          },
        };
      }
    }
  }

  // Fail closed: without an authoritative total there is nothing to check the
  // charge against, so neither settle for free nor charge.
  if (latest === null) {
    log.error("Cart read returned no authoritative total before pay", {
      cartId: session.cartId,
    });
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Failed to fetch cart", code: "EP_ERROR" },
      },
    };
  }

  // 3b-ter. Charge only the total this session last showed the shopper. A
  //     different total (shipping re-asserted, line cleared, selection write
  //     that failed) is shown first and paid on the next submit. When the
  //     browser says which total it showed, that total must match too.
  const shownTotal = req.body.shownTotal;
  if (
    session.totals?.total !== latest.total ||
    (typeof shownTotal === "number" && shownTotal !== latest.total)
  ) {
    return persistTotalChanged(req, ctx, { ...session, totals: latest }, ttl);
  }
  const expectedTotal = latest.total;

  // 3c. Free-order (zero-total) branch. Stripe and other third-party gateways
  //     reject a 0 charge, so EP best practice is to settle a free order with
  //     the manual gateway — no card, no PaymentIntent. Run it before any
  //     gateway/adapter requirement so a free checkout needs no payment UI.
  //
  //     The server is the SOLE authority on free-vs-paid. Settle for free ONLY
  //     on the cart's authoritative `meta.display_price` total being present
  //     AND exactly zero — i.e. an authoritative zero, never an *absence*. The
  //     parsed-items sum is deliberately NOT consulted here (see the note
  //     above the cart re-fetch): a paid cart whose items don't parse would
  //     sum to 0 and route to free settlement, completing with no charge. An
  //     unavailable total already failed closed above, so an unprovable-free
  //     cart can never settle for free.
  if (expectedTotal === 0) {
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

  if (
    adapter.allowsOrder &&
    !(await adapter.allowsOrder(orderRuleInput(cartResponse, session.account?.id)))
  ) {
    log.warn("Gateway refused for this order", {
      sessionId: session.id,
      gateway,
    });
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: "This payment method is not available for this order",
          code: "GATEWAY_NOT_ALLOWED",
        },
      },
    };
  }

  const {
    gateway: _gw,
    shownTotal: _shownTotal,
    ...gatewayData
  } = req.body as Record<string, unknown>;
  const payParams: PayContinuation = {
    req,
    ctx,
    session,
    adminClient,
    ttl,
    gateway,
    gatewayData,
    expectedTotal,
  };

  if (isCartPaymentIntentAdapter(adapter)) {
    return handleInitializePaymentPay(payParams, adapter);
  }
  if (isOrderFirstAdapter(adapter)) {
    return handleOrderFirstPay(payParams, adapter);
  }
  if (isLegacyPaymentAdapter(adapter)) {
    return handleInitializePaymentPay(payParams, adapter);
  }

  return {
    status: 400,
    body: {
      success: false,
      error: {
        message: `Payment adapter for ${gateway} does not declare a payment sequence`,
        code: "UNKNOWN_GATEWAY",
      },
    },
  };
}
