import {
  checkoutApi,
  deleteAllCartItems,
  paymentSetup,
  updateACart,
} from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";

/**
 * Generic single-page order placement for the composable checkout.
 *
 * Converts the current shopper's cart into an order, takes payment, and
 * clears the cart — the whole "place order" action in one server call, so
 * a single-page checkout (no multi-step flow, optionally no shipping) can
 * complete without orchestrating the 4-step EPCheckoutProvider.
 *
 * Payment defaults to the EP **manual** gateway with the **purchase**
 * method. Manual/purchase authorises-and-captures in one call and requires
 * no card UI, which is exactly the zero-total / free-product short-circuit:
 * a CHF 0 order is completed with no payment step. A store with a real
 * gateway overrides `paymentGateway` / `paymentMethod`.
 *
 * Isomorphic, mirroring `epGetCart`: when there is no SSR session (the
 * shopper-facing browser case — this runs from a button onClick) it POSTs
 * to the consumer's `/api/ep/proxy/placeOrder`, which re-enters this
 * function server-side under `withEpSession` with the real cart + token.
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
  input: EpPlaceOrderInput
): Promise<EpPlaceOrderResult> {
  const auth = getCurrentEpSession();

  // Browser path: no SSR session → go through the consumer proxy, which
  // re-enters this function server-side with the real session.
  if (!isUsableAuth(auth) && shouldUseProxy()) {
    const result = await callEpProxy<EpPlaceOrderResult | null>(
      "placeOrder",
      input as unknown as Record<string, unknown>
    );
    if (!result || !result.orderId) {
      throw new Error("epPlaceOrder: order could not be placed");
    }
    return result;
  }

  if (!isUsableAuth(auth)) {
    throw new Error("epPlaceOrder: no EP session");
  }
  const cartId = auth.cartId;
  if (!cartId) {
    throw new Error("epPlaceOrder: no cart on session");
  }

  const client = buildEpClient(auth);

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

  const total = order.meta?.display_price?.with_tax?.amount ?? 0;
  const currency =
    order.meta?.display_price?.with_tax?.currency ?? auth.currency ?? "";

  // 3. Take payment. Manual/purchase completes the order with no card step,
  //    which also satisfies the zero-total / free-product short-circuit.
  const payRes = await paymentSetup({
    client,
    path: { orderID: order.id },
    body: {
      data: {
        gateway: input.paymentGateway ?? "manual",
        method: input.paymentMethod ?? "purchase",
      } as never,
    },
  });
  const payment = payRes.data?.data;

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
