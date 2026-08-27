/**
 * Deep-module write primitive for the authoritative shipping line.
 *
 * `setCartShippingLine` commits a SERVER-resolved shipping rate (the output of
 * `resolveShippingRate`) into the cart as a single `custom_item` carrying the
 * server-computed amount. It is the credentialed *write* half of the
 * authoritative-mutation template (see ADR-0013): the amount it writes never
 * comes from the client — it comes from the resolved rate, which the server
 * computed via `ctx.shippingRateResolver`.
 *
 * Idempotent: a cart has at most ONE shipping line. Re-selecting a rate
 * REPLACES the line (clear-then-write), never stacks. Lines are marked with a
 * sentinel SKU so the clear step finds them unambiguously and never touches a
 * catalog line.
 *
 * Pure over an injected EP client (mockable). The caller supplies the client —
 * for authoritative shipping that is the `client_credentials` admin client, so
 * the write is server-only; the primitive itself is auth-agnostic.
 */
import { deleteACartItem, getACart, manageCarts } from "@epcc-sdk/sdks-shopper";
import type { Cart } from "../../types/cart";
import { normalizeCart } from "../../utils/normalize";
import { buildCartReadHeaders } from "../../utils/cart-read-headers";
import type { SessionShippingRate } from "./types";

/** Sentinel SKU that marks a storefront-managed shipping line. */
export const EP_SHIPPING_LINE_SKU = "__ep_shipping";

type EpClient = Parameters<typeof manageCarts>[0]["client"];

export interface ClearCartShippingLineInput {
  /** Cart whose managed shipping line(s) should be removed. */
  cartId: string;
}

export interface ClearCartShippingLineResult {
  deletedCount: number;
}

export interface SetCartShippingLineInput {
  /** Cart to write the shipping line into. */
  cartId: string;
  /** Server-resolved rate (from `resolveShippingRate`) — the trusted amount. */
  rate: SessionShippingRate;
  /** Locale for re-pricing the returned cart. Defaults to "en-US". */
  locale?: string;
  /** ISO 4217 currency for the cart re-read (X-Moltin-Currency). */
  currency?: string;
}

/** True for a line previously written by this primitive (sentinel SKU). */
function isManagedShippingLine(item: { sku?: unknown }): boolean {
  return item?.sku === EP_SHIPPING_LINE_SKU;
}

/**
 * Remove every storefront-managed shipping line (`sku === EP_SHIPPING_LINE_SKU`)
 * from the cart. Returns how many lines were deleted so callers can skip a
 * post-clear total refresh when the cart was unchanged.
 */
export async function clearCartShippingLine(
  client: EpClient,
  input: ClearCartShippingLineInput
): Promise<ClearCartShippingLineResult> {
  const { cartId } = input;

  if (!cartId) {
    throw new Error("clearCartShippingLine: cartId is required");
  }

  const current = await getACart({
    client,
    path: { cartID: cartId },
    query: { include: ["items"] },
  });
  const items: Array<{ id?: string; sku?: unknown }> =
    (current.data as { included?: { items?: unknown } })?.included?.items as never ??
    (current.data as { data?: { items?: unknown } })?.data?.items as never ??
    [];
  const staleIds = items
    .filter(isManagedShippingLine)
    .map((it) => it.id)
    .filter((id): id is string => Boolean(id));
  for (const cartitemID of staleIds) {
    await deleteACartItem({ client, path: { cartID: cartId, cartitemID } });
  }
  return { deletedCount: staleIds.length };
}

/**
 * Replace the cart's shipping line with one for `rate`, returning the re-priced,
 * normalized cart. Throws (before any write) on a missing cart or a malformed
 * rate, and propagates the underlying SDK error on a backend failure.
 */
export async function setCartShippingLine(
  client: EpClient,
  input: SetCartShippingLineInput
): Promise<Cart> {
  const { cartId, rate } = input;

  if (!cartId) {
    throw new Error("setCartShippingLine: cartId is required");
  }
  // The rate is server-resolved and trusted; this guards against a malformed
  // source, never against a client value.
  if (!rate || typeof rate.amount !== "number" || !Number.isFinite(rate.amount)) {
    throw new Error(
      "setCartShippingLine: a resolved shipping rate with a numeric amount is required"
    );
  }

  // 1. Idempotency — clear any existing managed shipping line(s) so a
  //    re-selection replaces rather than stacks.
  await clearCartShippingLine(client, { cartId });

  // 2. Write the new shipping line — a custom_item carrying the SERVER amount.
  await manageCarts({
    client,
    path: { cartID: cartId },
    body: {
      data: {
        type: "custom_item",
        name: rate.name || "Shipping",
        sku: EP_SHIPPING_LINE_SKU,
        quantity: 1,
        // includes_tax: true keeps the charged shipping exactly `rate.amount`.
        price: { amount: rate.amount, includes_tax: true },
        // Tie the line back to the resolved rate so checkout re-assertion can
        // recognise and re-verify it.
        custom_inputs: {
          kind: "shipping",
          rateId: rate.id,
          ...(rate.carrier ? { carrier: rate.carrier } : {}),
          ...(rate.serviceLevel ? { serviceLevel: rate.serviceLevel } : {}),
        },
      } as never,
    },
  });

  // 3. Re-read + normalize so the caller sees the re-priced total.
  const updated = await getACart({
    client,
    path: { cartID: cartId },
    query: { include: ["items"] },
    headers: buildCartReadHeaders({
      locale: input.locale,
      currency: input.currency,
    }),
  });
  return normalizeCart(updated.data!, input.locale ?? "en-US");
}
