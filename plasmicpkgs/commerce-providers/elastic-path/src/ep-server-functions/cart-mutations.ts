import {
  createACart,
  deleteACartItem,
  getACart,
  manageCarts,
  updateACartItem,
} from "@epcc-sdk/sdks-shopper";
import type { Cart } from "../types/cart";
import { normalizeCart } from "../utils/normalize";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import {
  addCustomCartItem,
  type CartAdjustmentKind,
} from "./custom-cart-item";
import type { EpServerAuth } from "./types";

async function fetchNormalizedCart(
  client: ReturnType<typeof buildEpClient>,
  auth: EpServerAuth,
  cartId: string
): Promise<Cart> {
  const cart = await getACart({
    client,
    path: { cartID: cartId },
    query: { include: ["items"] },
  });
  return normalizeCart(cart.data!, auth.locale ?? "en-US");
}

export interface EpAddCartItemInput {
  productId: string;
  quantity: number;
  sku?: string;
  customInputs?: Record<string, unknown>;
  /** EP bundle configuration (when adding a configured bundle product). */
  bundleConfiguration?: unknown;
  /** EP location slug for multi-location inventory. */
  location?: string;
}

export interface EpUpdateCartItemInput {
  itemId: string;
  quantity: number;
}

export interface EpRemoveCartItemInput {
  itemId: string;
}

export interface EpApplyCartAdjustmentInput {
  /** Human-readable line label shown in the cart, e.g. "Handling fee". */
  label: string;
  /** Adjustment amount in minor currency units (e.g. cents). Must be ≥ 0. */
  amountMinor: number;
  /** Adjustment family: "fee", "handling", or "shipping". */
  kind: CartAdjustmentKind;
  /** Units of the adjustment (optional, default 1). */
  quantity?: number;
}

export async function epAddCartItem(input: EpAddCartItemInput): Promise<Cart> {
  const auth = getCurrentEpSession();
  if (!isUsableAuth(auth)) {
    throw new Error("epAddCartItem: no EP session");
  }
  const client = buildEpClient(auth);
  let cartId = auth.cartId;

  if (!cartId) {
    const created = await createACart({
      client,
      body: { data: { name: "Cart", description: "Shopping cart" } },
    });
    cartId = created.data?.data?.id;
    if (!cartId) {
      throw new Error("epAddCartItem: failed to create cart");
    }
  }

  const itemData: Record<string, unknown> = {
    type: "cart_item",
    quantity: input.quantity,
  };
  if (input.sku) {
    itemData.sku = input.sku;
  } else {
    itemData.id = input.productId;
  }
  if (input.customInputs) {
    itemData.custom_inputs = input.customInputs;
  }
  if (input.bundleConfiguration) {
    itemData.bundle_configuration = input.bundleConfiguration;
  }
  if (input.location) {
    itemData.location = input.location;
  }

  await manageCarts({
    client,
    path: { cartID: cartId },
    body: { data: itemData as never },
  });

  return fetchNormalizedCart(client, auth, cartId);
}

export async function epUpdateCartItem(
  input: EpUpdateCartItemInput
): Promise<Cart> {
  const auth = getCurrentEpSession();
  if (!isUsableAuth(auth)) {
    throw new Error("epUpdateCartItem: no EP session");
  }
  if (!auth.cartId) {
    throw new Error("epUpdateCartItem: no cart on session");
  }
  const client = buildEpClient(auth);

  await updateACartItem({
    client,
    path: { cartID: auth.cartId, cartitemID: input.itemId },
    body: {
      data: {
        type: "cart_item",
        id: input.itemId,
        quantity: input.quantity,
      },
    },
  });

  return fetchNormalizedCart(client, auth, auth.cartId);
}

/**
 * Studio extension API — `ep.applyCartAdjustment` (PRD #371).
 *
 * Thin adapter over the {@link addCustomCartItem} primitive: resolves the cart
 * and credentials from the request-scoped session (never process globals, so it
 * stays correct under a shared multi-tenant image) and writes a bounded,
 * labelled adjustment line. The EP cart re-prices and checkout (`handlePay`)
 * charges the new server-computed total — the adjustment cannot be forged or
 * removed by a shopper through a public route because money lives only in the
 * EP cart.
 *
 * Uses the shopper-auth client: a *positive* adjustment is harmless to replay
 * (it only adds cost to the shopper's own cart). A future negative-amount
 * member (a discount) would hand the primitive a client-credentials client
 * instead — the primitive is already parameterised for it.
 */
export async function epApplyCartAdjustment(
  input: EpApplyCartAdjustmentInput
): Promise<Cart> {
  const auth = getCurrentEpSession();

  // Browser path (element interaction / Studio canvas): there is no
  // AsyncLocalStorage session in the browser, so route through the consumer's
  // EP proxy. The proxy re-establishes `withEpSession` server-side (credentials
  // + cartId from cookies) and runs this same write with real auth — keeping
  // the credentialed cart write server-only. Mirrors epGetCart's fallback.
  // This is what makes the mutation invokable from a designer's onClick action.
  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return callEpProxy<Cart>("applyCartAdjustment", {
      label: input.label,
      amountMinor: input.amountMinor,
      kind: input.kind,
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    });
  }

  if (!isUsableAuth(auth)) {
    throw new Error("epApplyCartAdjustment: no EP session");
  }
  if (!auth.cartId) {
    throw new Error("epApplyCartAdjustment: no cart on session");
  }
  const client = buildEpClient(auth);

  return addCustomCartItem(client, {
    cartId: auth.cartId,
    label: input.label,
    amountMinor: input.amountMinor,
    kind: input.kind,
    quantity: input.quantity,
    locale: auth.locale,
    currency: auth.currency,
  });
}

export async function epRemoveCartItem(
  input: EpRemoveCartItemInput
): Promise<Cart> {
  const auth = getCurrentEpSession();
  if (!isUsableAuth(auth)) {
    throw new Error("epRemoveCartItem: no EP session");
  }
  if (!auth.cartId) {
    throw new Error("epRemoveCartItem: no cart on session");
  }
  const client = buildEpClient(auth);

  await deleteACartItem({
    client,
    path: { cartID: auth.cartId, cartitemID: input.itemId },
  });

  return fetchNormalizedCart(client, auth, auth.cartId);
}
