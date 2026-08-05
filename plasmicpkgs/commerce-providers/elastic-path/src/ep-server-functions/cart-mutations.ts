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

/**
 * Hey API defaults to `throwOnError: false`, so EP rejections resolve as
 * `{ error }` instead of throwing. Format that payload (or a thrown value)
 * into a readable message for callers / the ATC button.
 */
function formatEpSdkError(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object") {
    const e = error as {
      errors?: Array<{ detail?: string; title?: string; message?: string }>;
      message?: string;
    };
    const fromErrors = e.errors
      ?.map((item) => item.detail || item.title || item.message)
      .filter((s): s is string => Boolean(s && s.trim()))
      .join("; ");
    if (fromErrors) return fromErrors;
    if (e.message) return e.message;
  }
  return fallback;
}

function assertEpSdkOk(
  result: { error?: unknown },
  label: string
): void {
  if (result.error) {
    throw new Error(
      `${label}: ${formatEpSdkError(result.error, "unknown error")}`
    );
  }
}

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
  /**
   * EP location slug for multi-location inventory. When the line was added
   * with a location, updates must include it so EP validates stock against
   * that pool (same as the legacy use-update-item hook).
   */
  location?: string;
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

  const addRes = await manageCarts({
    client,
    path: { cartID: cartId },
    body: { data: itemData as never },
  });
  assertEpSdkOk(addRes, "epAddCartItem");
  if (!addRes.data) {
    const status =
      (addRes as { response?: { status?: number } }).response?.status ?? "?";
    throw new Error(
      `epAddCartItem: manageCarts returned no data (HTTP ${status})`
    );
  }

  const cart = await fetchNormalizedCart(client, auth, cartId);
  // Soft EP failures (e.g. unpublished catalog product) can resolve without
  // `error` while leaving the cart empty — surface that instead of a quiet
  // empty success that looks like "add did nothing".
  if (cart.lineItems.length === 0) {
    const includedCount =
      (
        addRes.data as { included?: { items?: unknown[] } } | undefined
      )?.included?.items?.length ?? 0;
    throw new Error(
      `epAddCartItem: cart still empty after add ` +
        `(productId=${input.productId}` +
        `${input.sku ? `, sku=${input.sku}` : ""}, ` +
        `manageCartsIncludedItems=${includedCount}). ` +
        `Check the product is purchasable in the published catalog and that ` +
        `currency/catalog rules allow adding it.`
    );
  }
  return cart;
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

  // Multilocation inventory: quantity changes (including decreases) are
  // validated against a stock pool. Without the line's location slug EP
  // checks the wrong pool and returns "not enough stock to add…", even
  // when lowering quantity. Prefer the caller-supplied slug; otherwise
  // read it from the existing cart line so clients can't drop it.
  let location = input.location?.trim() || undefined;
  if (!location) {
    const existing = await getACart({
      client,
      path: { cartID: auth.cartId },
      query: { include: ["items"] },
    });
    const items = existing?.data?.included?.items ?? [];
    const match = items.find(
      (item) =>
        item &&
        typeof item === "object" &&
        "id" in item &&
        (item as { id?: string }).id === input.itemId
    ) as { location?: string } | undefined;
    const fromLine =
      typeof match?.location === "string" ? match.location.trim() : "";
    if (fromLine) {
      location = fromLine;
    }
  }

  const updateData: Record<string, unknown> = {
    type: "cart_item",
    id: input.itemId,
    quantity: input.quantity,
  };
  if (location) {
    updateData.location = location;
  }

  const updateRes = await updateACartItem({
    client,
    path: { cartID: auth.cartId, cartitemID: input.itemId },
    body: {
      data: updateData as never,
    },
  });
  assertEpSdkOk(updateRes, "epUpdateCartItem");

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

  const deleteRes = await deleteACartItem({
    client,
    path: { cartID: auth.cartId, cartitemID: input.itemId },
  });
  assertEpSdkOk(deleteRes, "epRemoveCartItem");

  return fetchNormalizedCart(client, auth, auth.cartId);
}
