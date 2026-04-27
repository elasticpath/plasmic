/**
 * A-4.5: Initiate Payment
 *
 * The most complex handler in Phase A. Steps:
 *   1. Load session (→ 410 if missing)
 *   2. Guard: status must be "open" (double-submit protection → 400)
 *   3. Validate gateway adapter exists (→ 400)
 *   4. Validate required checkout fields present (→ 400)
 *   5. Re-fetch cart, compare hash (→ 409 with refreshed session if mismatch)
 *   6. EP checkout: cart → order
 *   7. Read order totals
 *   8. EP authorize: create a manual/authorize transaction
 *   9. Delegate to adapter.initializePayment()
 *  10. Map adapter result status → session fields
 *  11. Persist + return
 */
import { getACart, checkoutApi, paymentSetup } from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
} from "../../../checkout/session/types";
import { hashCart } from "../../../checkout/session/cart-hash";
import { toEPAddress, toEPCustomer } from "../../../checkout/session/address-utils";
import { createLogger } from "../../../utils/logger";

const log = createLogger("Pay");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
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
      body: { success: false, error: { message: "Failed to read session", code: "STORE_ERROR" } },
    };
  }

  if (!session) {
    return {
      status: 410,
      body: { success: false, error: { message: "Session not found or has expired", code: "SESSION_GONE" } },
    };
  }

  // 2. Double-submit guard
  if (session.status !== "open") {
    return {
      status: 400,
      body: {
        success: false,
        error: { message: "Session is not open", code: "SESSION_NOT_OPEN" },
      },
    };
  }

  // 3. Validate gateway adapter
  const gateway = req.body.gateway;
  if (!gateway || typeof gateway !== "string") {
    return {
      status: 400,
      body: { success: false, error: { message: "gateway is required", code: "VALIDATION_ERROR" } },
    };
  }

  const adapter = ctx.adapterRegistry.getAdapter(gateway);
  if (!adapter) {
    return {
      status: 400,
      body: {
        success: false,
        error: { message: `Unknown payment gateway: ${gateway}`, code: "UNKNOWN_GATEWAY" },
      },
    };
  }

  // 4. Validate required checkout fields
  const missingFields: string[] = [];
  if (!session.customerInfo) missingFields.push("customerInfo");
  if (!session.shippingAddress) missingFields.push("shippingAddress");
  if (!session.billingAddress) missingFields.push("billingAddress");
  if (!session.selectedShippingRateId) missingFields.push("selectedShippingRateId");

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

  // TypeScript narrowing — we validated these above
  const customerInfo = session.customerInfo!;
  const shippingAddress = session.shippingAddress!;
  const billingAddress = session.billingAddress!;

  // The EP SDK's Client<> type is complex; the settings-only object is the
  // documented lightweight pattern used throughout this codebase.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = {
    settings: {
      application_id: ctx.epCredentials.clientId,
      host: ctx.epCredentials.apiBaseUrl,
    },
  } as any;

  // 5. Re-fetch cart and compare hash
  let freshCartItems: Array<{
    id: string;
    quantity: number;
    unit_price?: { amount?: number };
    value?: { amount?: number };
  }> = [];
  try {
    const cartResponse = await getACart({ client, path: { cartID: session.cartId } });
    const items =
      (cartResponse.data as any)?.included?.items ??
      (cartResponse.data as any)?.data?.items ??
      [];
    freshCartItems = Array.isArray(items) ? items : [];
  } catch (err) {
    log.error("Failed to re-fetch cart for hash check", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: { success: false, error: { message: "Failed to fetch cart", code: "EP_ERROR" } },
    };
  }

  const freshHash = hashCart(freshCartItems);
  if (freshHash !== session.cartHash) {
    // Cart has changed — refresh the stored hash and return 409
    const refreshed: CheckoutSession = { ...session, cartHash: freshHash };
    try {
      const setResult = await ctx.sessionStore.set("current", refreshed, ttl, req);
      return {
        status: 409,
        body: {
          success: false,
          error: { message: "Cart has changed since session was created", code: "CART_MISMATCH" },
          data: { session: toClientSession(refreshed) },
        },
        headers: setResult.headers,
      };
    } catch {
      return {
        status: 409,
        body: {
          success: false,
          error: { message: "Cart has changed since session was created", code: "CART_MISMATCH" },
        },
      };
    }
  }

  // 6. EP checkout: cart → order
  // On retry (session.order already populated from a previous failed attempt),
  // skip checkout and reuse the existing EP order. This prevents creating
  // duplicate orders when the gateway charge failed but EP checkout succeeded.
  let orderId: string;
  let totals = session.totals;
  const isRetry = !!session.order;

  if (isRetry) {
    orderId = session.order!.id;
    log.info("Retry detected — reusing existing EP order", {
      orderId,
      sessionId: session.id,
    } as Record<string, unknown>);
  } else {
    // EP's BillingAddress and ShippingAddress types require fields like
    // company_name, phone_number, and instructions that SessionAddress doesn't
    // carry. Provide safe empty-string defaults for optional EP fields.
    const epBilling = toEPAddress(billingAddress);
    const epShipping = toEPAddress(shippingAddress);

    let orderMeta: any;
    try {
      const checkoutResponse = await checkoutApi({
        client,
        path: { cartID: session.cartId },
        body: {
          data: {
            customer: toEPCustomer(customerInfo),
            billing_address: {
              ...epBilling,
              company_name: "",
              line_2: epBilling.line_2 ?? "",
              county: epBilling.county ?? "",
            },
            shipping_address: {
              ...epShipping,
              company_name: "",
              phone_number: "",
              line_2: epShipping.line_2 ?? "",
              county: epShipping.county ?? "",
              instructions: "",
            },
          } as any,
        },
      });

      const orderData = (checkoutResponse.data as any)?.data;
      if (!orderData?.id) {
        throw new Error("EP checkout response missing order ID");
      }
      orderId = orderData.id as string;
      orderMeta = orderData.meta;
    } catch (err) {
      log.error("EP checkout (cart→order) failed", {
        cartId: session.cartId,
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
      return {
        status: 502,
        body: { success: false, error: { message: "Failed to create order", code: "EP_ERROR" } },
      };
    }

    // 7. Extract totals from order meta
    const displayPrice = orderMeta?.display_price;
    totals = {
      subtotal: displayPrice?.without_tax?.amount ?? 0,
      tax: displayPrice?.tax?.amount ?? 0,
      shipping: displayPrice?.shipping?.amount ?? 0,
      total: displayPrice?.with_tax?.amount ?? 0,
      currency:
        displayPrice?.with_tax?.currency ??
        displayPrice?.without_tax?.currency ??
        "USD",
    };
  }

  // 8. EP authorize: create manual/authorize transaction
  // A new authorization is created on every /pay attempt (including retries)
  // because the previous authorization may have been voided or expired.
  let transactionId: string;
  try {
    const authResponse = await paymentSetup({
      client,
      path: { orderID: orderId },
      body: {
        data: {
          gateway: "manual",
          method: "authorize",
        },
      },
    });

    const txData = (authResponse.data as any)?.data;
    if (!txData?.id) {
      throw new Error("EP paymentSetup response missing transaction ID");
    }
    transactionId = txData.id as string;
  } catch (err) {
    log.error("EP paymentSetup (authorize) failed", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Failed to authorize transaction with EP", code: "EP_ERROR" },
      },
    };
  }

  // 9. Delegate to the payment adapter
  const { gateway: _gatewayKey, ...gatewayData } = req.body as Record<string, unknown>;

  let adapterResult: Awaited<ReturnType<typeof adapter.initializePayment>>;
  try {
    adapterResult = await adapter.initializePayment(session, gatewayData);
  } catch (err) {
    log.error("Payment adapter initializePayment threw", {
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

  // 10. Map adapter result → session fields
  const baseSession: CheckoutSession = {
    ...session,
    totals,
    order: { id: orderId, transactionId },
    payment: {
      gateway,
      status: "idle",
      clientToken: adapterResult.clientToken ?? null,
      gatewayMetadata: {
        epTransactionId: transactionId,
        ...(adapterResult.gatewayMetadata ?? {}),
      },
      actionData: null,
    },
  };

  let finalSession: CheckoutSession;

  switch (adapterResult.status) {
    case "ready":
      finalSession = {
        ...baseSession,
        status: "processing",
        payment: { ...baseSession.payment, status: "pending" },
      };
      break;

    case "requires_action":
      finalSession = {
        ...baseSession,
        payment: {
          ...baseSession.payment,
          status: "requires_action",
          actionData: adapterResult.actionData ?? null,
        },
      };
      break;

    case "succeeded":
      // Rare for initializePayment — treat same as "ready" and advance status
      finalSession = {
        ...baseSession,
        status: "processing",
        payment: { ...baseSession.payment, status: "pending" },
      };
      break;

    case "failed":
    default:
      // Session stays "open" to allow retry; surface error in payment
      finalSession = {
        ...baseSession,
        status: "open",
        payment: {
          ...baseSession.payment,
          status: "failed",
        },
      };
      break;
  }

  // 11. Persist and return
  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", finalSession, ttl, req);
  } catch (err) {
    log.error("Failed to persist session after pay", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 500,
      body: { success: false, error: { message: "Failed to store session", code: "STORE_ERROR" } },
    };
  }

  log.info("Pay handler completed", {
    sessionId: finalSession.id,
    orderId,
    adapterStatus: adapterResult.status,
    sessionStatus: finalSession.status,
  } as Record<string, unknown>);

  // For "failed", we still return 200 — the error is expressed in session.payment
  const responseBody: Record<string, unknown> = {
    success: true,
    data: { session: toClientSession(finalSession) },
  };

  if (adapterResult.status === "failed" && adapterResult.errorMessage) {
    responseBody["paymentError"] = adapterResult.errorMessage;
  }

  return {
    status: 200,
    body: responseBody,
    headers: setResult.headers,
  };
}
