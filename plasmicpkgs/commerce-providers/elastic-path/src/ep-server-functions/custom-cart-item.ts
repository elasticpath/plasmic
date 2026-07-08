/**
 * Deep-module write primitive for storefront-injected cart lines.
 *
 * `addCustomCartItem` writes a single EP `custom_item` (a name + amount, not a
 * catalog product) into a cart, enforcing sanity bounds, then re-reads and
 * normalizes the cart. It is the authoritative-money building block behind the
 * Studio extension API's `ep.applyCartAdjustment` (PRD #371) and is reused by
 * the future typed family members (`setShippingLine`, `setTax`, `applyDiscount`).
 *
 * The primitive is **pure over an injected EP client**: it never reads the
 * request-scoped session or process globals, so it is trivially mockable and
 * the caller controls which credentials write the line. A *positive* fee is
 * harmless to replay (it only adds cost to the shopper's own cart) so the MVP
 * adapter passes a shopper-auth client; a future discount member can hand this
 * same primitive a client-credentials client without a redesign (PRD #371,
 * ADR "EP cart is the sole authority for charged amounts").
 *
 * Trust contract: injected money lands in the EP cart, EP re-prices, and
 * checkout charges the cart's server-computed `meta.display_price`. The bounds
 * here (`amountMinor ≥ 0`, `label` required, `kind` within the enum) stop a
 * buggy tenant function from producing a nonsensical order line; they are a
 * guard, not the trust boundary (the cart's pricing is).
 */
import { getACart, manageCarts } from "@epcc-sdk/sdks-shopper";
import type { Cart } from "../types/cart";
import { normalizeCart } from "../utils/normalize";
import { buildCartReadHeaders } from "../utils/cart-read-headers";
import type { buildEpClient } from "./ep-client";

/** The adjustment families a `custom_item` line may represent in the MVP. */
export const CART_ADJUSTMENT_KINDS = ["fee", "handling", "shipping"] as const;
export type CartAdjustmentKind = (typeof CART_ADJUSTMENT_KINDS)[number];

export interface AddCustomCartItemInput {
  /** Cart to write the line into. Required — the primitive never creates carts. */
  cartId: string;
  /** Human-readable line name shown in the cart, e.g. "Handling fee". */
  label: string;
  /** Amount in minor currency units (e.g. cents). Must be a non-negative integer. */
  amountMinor: number;
  /** Adjustment family. Recorded on the line so a reader can distinguish it. */
  kind: CartAdjustmentKind;
  /** Units of the adjustment. Defaults to 1. */
  quantity?: number;
  /** Locale for re-pricing the returned cart. Defaults to "en-US". */
  locale?: string;
  /** ISO 4217 currency for the cart re-read (X-Moltin-Currency). */
  currency?: string;
}

type EpClient = ReturnType<typeof buildEpClient>;

/**
 * Writes a bounded, labelled `custom_item` adjustment line into `cartId` using
 * the supplied EP client, then returns the re-priced, normalized cart.
 *
 * Throws (before any network call) when a bound is violated, and propagates the
 * underlying SDK error when EP rejects the write.
 */
export async function addCustomCartItem(
  client: EpClient,
  input: AddCustomCartItemInput
): Promise<Cart> {
  const { cartId, label, amountMinor, kind } = input;
  const quantity = input.quantity ?? 1;

  if (!cartId) {
    throw new Error("addCustomCartItem: cartId is required");
  }
  if (typeof label !== "string" || label.trim() === "") {
    throw new Error("addCustomCartItem: label is required");
  }
  if (!CART_ADJUSTMENT_KINDS.includes(kind)) {
    throw new Error(
      `addCustomCartItem: kind must be one of ${CART_ADJUSTMENT_KINDS.join(
        ", "
      )} (got ${JSON.stringify(kind)})`
    );
  }
  // Minor units are integers; a negative amount would be a discount, which the
  // MVP deliberately does not allow through this (shopper-auth) path.
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error(
      "addCustomCartItem: amountMinor must be a non-negative integer (minor currency units)"
    );
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("addCustomCartItem: quantity must be a positive integer");
  }

  await manageCarts({
    client,
    path: { cartID: cartId },
    body: {
      data: {
        type: "custom_item",
        name: label,
        quantity,
        // `includes_tax: true` keeps the charged amount exactly `amountMinor`
        // (EP treats it as tax-inclusive and adds nothing on top) — the
        // predictable default for a flat adjustment.
        price: { amount: amountMinor, includes_tax: true },
        // Tag the family so a downstream reader can tell a storefront-injected
        // adjustment from a catalog `custom_item`.
        custom_inputs: { kind },
      } as never,
    },
  });

  const cart = await getACart({
    client,
    path: { cartID: cartId },
    query: { include: ["items"] },
    headers: buildCartReadHeaders({
      locale: input.locale,
      currency: input.currency,
    }),
  });
  return normalizeCart(cart.data!, input.locale ?? "en-US");
}
