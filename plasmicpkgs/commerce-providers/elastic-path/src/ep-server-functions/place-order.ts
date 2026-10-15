import {
  checkoutApi,
  deleteAllCartItems,
  paymentSetup,
  updateACart,
} from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { readCartResponse } from "./read-cart";
import {
  manualPaymentAllowed,
  type ManualPaymentRule,
} from "../checkout/session/manual-payment-rule";
import { mapTransactionResponse } from "../checkout/session/payment-sequence";
import { readOrderTotal } from "../checkout/session/order-total";

const MANUAL_GATEWAY = "manual";
const NOT_AVAILABLE =
  "epPlaceOrder: this payment method is not available for this order";

export interface EpPlaceOrderOptions {
  /**
   * Allows the `manual` gateway for an order with a total above zero. The
   * same rule a host gives `createManualAdapter({ allow })`.
   */
  allowManual?: ManualPaymentRule;
}

/**
 * Server-side order placement for host code: converts the session's cart into
 * an order, takes payment, and clears the cart. It needs a `withEpSession`
 * scope and never runs from the browser; the EP proxy route does not place
 * orders.
 *
 * Payment defaults to the `manual` gateway with the `purchase` method.
 * `manual` is allowed for an order whose total is zero. For an order with a
 * total above zero it is allowed only when `options.allowManual` returns
 * `true` for the cart and account. The rule runs before the order is
 * created. Any other gateway is passed to Elastic Path unchanged. The call
 * throws when payment does not succeed.
 */

/** A billing or shipping address. Missing parts are sent as empty strings. */
export interface EpPlaceOrderAddress {
  first_name?: string;
  last_name?: string;
  company_name?: string;
  line_1?: string;
  line_2?: string;
  city?: string;
  county?: string;
  postcode?: string;
  country?: string;
}

export interface EpPlaceOrderInput {
  /** Order contact. `name` is the full display name; `email` the receipt address. */
  customer: { name: string; email: string };
  billingAddress: EpPlaceOrderAddress;
  /**
   * Optional shipping address. When omitted, the billing address is sent as
   * the shipping address too (shipping-same-as-billing) — EP requires a
   * shipping address whenever any cart item is flagged shippable, even for a
   * single-page / effectively digital checkout. Set `shippingSameAsBilling`
   * to `false` to omit it entirely.
   */
  shippingAddress?: EpPlaceOrderAddress;
  /** Default `true`: fall back to billing as shipping when none is given. */
  shippingSameAsBilling?: boolean;
  /**
   * Arbitrary extra fields and consent flags. Persisted as the cart's
   * `custom_attributes` (typed per JS runtime type) immediately before
   * checkout so they travel with the order context. EP caps a cart at 20
   * custom attributes; empty values are dropped.
   */
  customAttributes?: Record<string, string | number | boolean>;
  /** Payment gateway. Default `"manual"`. */
  paymentGateway?: string;
  /** Payment method. Default `"purchase"`. */
  paymentMethod?: string;
  /** Clear the cart after a successful order. Default `true`. */
  clearCart?: boolean;
}

export interface EpPlaceOrderResult {
  orderId: string;
  status: string;
  payment: string;
  total: number;
  currency: string;
  /** True when the order total is zero (free product — no real payment taken). */
  isFree: boolean;
}

type TypedAttribute = { type: "string" | "boolean" | "integer" | "float"; value: unknown };

/**
 * Maps a flat `{ key: value }` map to EP's typed `custom_attributes`
 * shape. Empty strings and nullish values are dropped (EP rejects them
 * and they carry no signal). Exported for unit testing.
 */
export function toCustomAttributes(
  input?: Record<string, string | number | boolean>
): Record<string, TypedAttribute> | undefined {
  if (!input) return undefined;
  const out: Record<string, TypedAttribute> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    const type =
      typeof value === "boolean"
        ? "boolean"
        : typeof value === "number"
          ? Number.isInteger(value)
            ? "integer"
            : "float"
          : "string";
    out[key] = { type, value };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Normalises an address to the EP shape, filling absent parts with "". */
export function normalizeAddress(a: EpPlaceOrderAddress | undefined) {
  if (!a) return undefined;
  return {
    first_name: a.first_name ?? "",
    last_name: a.last_name ?? "",
    company_name: a.company_name ?? "",
    line_1: a.line_1 ?? "",
    line_2: a.line_2 ?? "",
    city: a.city ?? "",
    county: a.county ?? "",
    postcode: a.postcode ?? "",
    country: a.country ?? "",
  };
}

export async function epPlaceOrder(
  input: EpPlaceOrderInput,
  options: EpPlaceOrderOptions = {}
): Promise<EpPlaceOrderResult> {
  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth)) {
    throw new Error("epPlaceOrder: no EP session");
  }
  const cartId = auth.cartId;
  if (!cartId) {
    throw new Error("epPlaceOrder: no cart on session");
  }

  const client = buildEpClient(auth);

  const gateway = input.paymentGateway ?? MANUAL_GATEWAY;
  const isManual = gateway.trim().toLowerCase() === MANUAL_GATEWAY;
  let manualForFreeOrder = false;
  if (isManual) {
    const cart = await readCartResponse(client, cartId, auth);
    manualForFreeOrder =
      cart.data?.meta?.display_price?.with_tax?.amount === 0;
    if (
      !manualForFreeOrder &&
      !(await manualPaymentAllowed(options.allowManual, {
        cart,
        account: auth.accountId ? { id: auth.accountId } : null,
      }))
    ) {
      throw new Error(NOT_AVAILABLE);
    }
  }

  // 1. Persist extra fields + consents as cart custom attributes. A single
  //    update wins because EP replaces all custom attributes per write.
  const customAttributes = toCustomAttributes(input.customAttributes);
  if (customAttributes) {
    await updateACart({
      client,
      path: { cartID: cartId },
      body: { data: { custom_attributes: customAttributes as never } },
    });
  }

  // 2. Convert the cart to an order. EP requires a shipping address when any
  //    item is shippable, so default it to the billing address unless the
  //    caller explicitly opts out.
  const shippingAddress =
    input.shippingAddress ??
    (input.shippingSameAsBilling === false ? undefined : input.billingAddress);
  const checkoutRes = await checkoutApi({
    client,
    path: { cartID: cartId },
    body: {
      data: {
        customer: { name: input.customer.name, email: input.customer.email },
        billing_address: normalizeAddress(input.billingAddress) as never,
        ...(shippingAddress
          ? { shipping_address: normalizeAddress(shippingAddress) as never }
          : {}),
      },
    },
  });
  const order = checkoutRes.data?.data;
  if (!order?.id) {
    const detail =
      (checkoutRes as { error?: { errors?: Array<{ detail?: string }> } })
        .error?.errors?.map((e) => e.detail).filter(Boolean).join("; ") ||
      (checkoutRes as { error?: { message?: string } }).error?.message ||
      "unknown error";
    throw new Error(`epPlaceOrder: checkout did not return an order (${detail})`);
  }

  const orderTotal = await readOrderTotal(client, order);
  if (!orderTotal) {
    throw new Error(`epPlaceOrder: no order total for order ${order.id}`);
  }
  const total = orderTotal.amount;
  const currency = orderTotal.currency ?? auth.currency ?? "";

  if (manualForFreeOrder && total !== 0) {
    throw new Error(NOT_AVAILABLE);
  }

  // 3. Take payment.
  let payRes: unknown;
  let payThrown: unknown;
  try {
    payRes = await paymentSetup({
      client,
      path: { orderID: order.id },
      body: {
        data: {
          gateway,
          method: input.paymentMethod ?? "purchase",
        } as never,
      },
    });
  } catch (err) {
    payThrown = err;
  }
  const paid = mapTransactionResponse(payRes, payThrown);
  if (paid.status !== "succeeded") {
    throw new Error(
      `epPlaceOrder: payment failed for order ${order.id} (${
        paid.errorMessage ?? paid.status
      })`
    );
  }
  const payment = (payRes as { data?: { data?: { status?: unknown } } })
    ?.data?.data;

  // 4. Clear the cart on success (best-effort — a failed clear is non-fatal).
  if (input.clearCart !== false) {
    try {
      await deleteAllCartItems({ client, path: { cartID: cartId } });
    } catch {
      /* non-fatal: the order is already placed */
    }
  }

  return {
    orderId: order.id,
    status: (order.status as string | undefined) ?? "",
    payment:
      (payment?.status as string | undefined) ??
      (order.payment as string | undefined) ??
      "",
    total,
    currency,
    isFree: total === 0,
  };
}
