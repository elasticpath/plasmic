import {
  createACart,
  deleteACartItem,
  deleteAPromotionViaPromotionCode,
  getACart,
  manageCarts,
  updateACartItem,
} from "@epcc-sdk/sdks-shopper";
import { readEpErrorCode } from "../browser-call";
import type { Cart } from "../types/cart";
import {
  carriesForwardedMessage,
  classifyEpFailure,
  makeEpCallError,
} from "./call-error";
import { seedEpCartCaches } from "./cart-cache-seed";
import { cartMutationErrorCopy } from "./cart-mutation-error-copy";
import { currentEpDesignRealm } from "./design-realm";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession, type EpSessionContext } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import { readCart } from "./read-cart";
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

function readSessionCart(
  client: ReturnType<typeof buildEpClient>,
  auth: EpServerAuth,
  cartId: string
): Promise<Cart> {
  return readCart(client, cartId, {
    locale: auth.locale,
    currency: auth.currency,
  });
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

export interface EpApplyPromoCodeInput {
  /** The promotion code the shopper typed. */
  code: string;
}

export interface EpRemovePromoCodeInput {
  /** The promotion code currently applied to the cart. */
  code: string;
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

function rejectionFromProxy(err: unknown, failureCopy: string): Error {
  const code = readEpErrorCode(err);
  const correlationId = (err as { correlationId?: unknown } | null)
    ?.correlationId;
  const message = carriesForwardedMessage(err)
    ? err.message
    : code
      ? cartMutationErrorCopy(err, failureCopy)
      : failureCopy;
  return makeEpCallError({
    message,
    code,
    correlationId: typeof correlationId === "string" ? correlationId : undefined,
    cause: err,
  });
}

function rejectionFromServer(err: unknown, failureCopy: string): Error {
  const code = classifyEpFailure(err);
  return makeEpCallError({
    message: cartMutationErrorCopy({ code }, failureCopy),
    code,
    cause: err,
  });
}

function proxyArgs(input: object): Record<string, unknown> {
  return input as Record<string, unknown>;
}

async function writeCart<I>(
  input: I,
  writeViaProxy: (input: I) => Promise<Cart | undefined>,
  writeWithSession: (
    auth: EpSessionContext | undefined,
    input: I
  ) => Promise<Cart>,
  failureCopy: string
): Promise<Cart> {
  const auth = getCurrentEpSession();
  let cart: Cart | undefined;
  if (!isUsableAuth(auth) && shouldUseProxy()) {
    try {
      cart = await writeViaProxy(input);
    } catch (err) {
      throw rejectionFromProxy(err, failureCopy);
    }
  } else {
    try {
      cart = await writeWithSession(auth, input);
    } catch (err) {
      throw rejectionFromServer(err, failureCopy);
    }
  }
  if (!cart) {
    const code =
      currentEpDesignRealm() === "artboard" ? "design_fn_not_served" : undefined;
    throw makeEpCallError({
      code,
      message: code ? cartMutationErrorCopy({ code }, failureCopy) : failureCopy,
    });
  }
  await seedEpCartCaches(cart);
  return cart;
}

/**
 * Adds an item to the shopper's cart and resolves with the updated cart. On
 * the server it writes with the request's session; in the browser it calls
 * the storefront's proxy route, then every `useEpCart()` consumer on the page
 * shows the new cart.
 *
 * Rejects the same way on the server and in the browser: an `Error` whose
 * `message` is shopper copy and whose `code` is stable to branch on —
 * `insufficient_stock`, `no_session`, `dispatch_failed`, `route_not_found`,
 * or `design_fn_not_served` on the Studio canvas. `cause` holds the original
 * failure; `correlationId` is set when a proxy route logged it.
 */
export function epAddCartItem(input: EpAddCartItemInput): Promise<Cart> {
  return writeCart(
    input,
    (i) => callEpProxy<Cart>("addCartItem", proxyArgs(i)),
    addCartItemWithSession,
    "We couldn't add this item to your cart. Please try again."
  );
}

/** Sets a cart line's quantity. Resolves, refreshes and rejects like {@link epAddCartItem}. */
export function epUpdateCartItem(input: EpUpdateCartItemInput): Promise<Cart> {
  return writeCart(
    input,
    (i) => callEpProxy<Cart>("updateCartItem", proxyArgs(i)),
    updateCartItemWithSession,
    "We couldn't update the quantity. Please try again."
  );
}

/** Removes a cart line. Resolves, refreshes and rejects like {@link epAddCartItem}. */
export function epRemoveCartItem(input: EpRemoveCartItemInput): Promise<Cart> {
  return writeCart(
    input,
    (i) => callEpProxy<Cart>("removeCartItem", proxyArgs(i)),
    removeCartItemWithSession,
    "We couldn't remove this item. Please try again."
  );
}

async function addCartItemWithSession(
  auth: EpSessionContext | undefined,
  input: EpAddCartItemInput
): Promise<Cart> {
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

  const cart = await readSessionCart(client, auth, cartId);
  // Soft EP failures (e.g. unpublished catalog product) can resolve without
  // `error` while leaving the cart empty — surface that instead of a quiet
  // empty success that looks like "add did nothing".
  if (cart.items.length === 0) {
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

async function updateCartItemWithSession(
  auth: EpSessionContext | undefined,
  input: EpUpdateCartItemInput
): Promise<Cart> {
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

  return readSessionCart(client, auth, auth.cartId);
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

async function removeCartItemWithSession(
  auth: EpSessionContext | undefined,
  input: EpRemoveCartItemInput
): Promise<Cart> {
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

  return readSessionCart(client, auth, auth.cartId);
}

/**
 * Applies a promotion code to the current cart.
 *
 * The shopper supplies a code and nothing else; Elastic Path decides what it
 * is worth and re-prices the cart. No caller — browser or server — can state
 * a discount amount, which is what separates this from
 * {@link epApplyCartAdjustment} and what makes it safe to reach from a public
 * proxy route.
 *
 * Elastic Path answers a code it will not honour with a 4xx, which
 * `assertEpSdkOk` turns into a throw carrying EP's own reason.
 */
export async function epApplyPromoCode(
  input: EpApplyPromoCodeInput
): Promise<Cart> {
  const code = input.code?.trim();
  if (!code) {
    throw new Error("epApplyPromoCode: no code");
  }

  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return callEpProxy<Cart>("applyPromoCode", { code });
  }

  if (!isUsableAuth(auth)) {
    throw new Error("epApplyPromoCode: no EP session");
  }
  if (!auth.cartId) {
    throw new Error("epApplyPromoCode: no cart on session");
  }
  const client = buildEpClient(auth);

  const applyRes = await manageCarts({
    client,
    path: { cartID: auth.cartId },
    body: { data: { type: "promotion_item", code } },
  });
  assertEpSdkOk(applyRes, "epApplyPromoCode");

  const cart = await readSessionCart(client, auth, auth.cartId);
  // A code the cart does not qualify for can come back 201 with no promotion
  // line written. Reporting that as success leaves the shopper looking at an
  // unchanged total with nothing said, so treat it as the rejection it is.
  if (cart.promotions.length === 0) {
    throw new Error(
      `epApplyPromoCode: "${code}" did not apply to this cart`
    );
  }
  return cart;
}

/**
 * Removes a promotion code from the current cart. Elastic Path keys the
 * removal on the code itself, which is why the applied code is read back off
 * the cart's promotion line rather than remembered in component state.
 */
export async function epRemovePromoCode(
  input: EpRemovePromoCodeInput
): Promise<Cart> {
  const code = input.code?.trim();
  if (!code) {
    throw new Error("epRemovePromoCode: no code");
  }

  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return callEpProxy<Cart>("removePromoCode", { code });
  }

  if (!isUsableAuth(auth)) {
    throw new Error("epRemovePromoCode: no EP session");
  }
  if (!auth.cartId) {
    throw new Error("epRemovePromoCode: no cart on session");
  }
  const client = buildEpClient(auth);

  const deleteRes = await deleteAPromotionViaPromotionCode({
    client,
    path: { cartID: auth.cartId, promoCode: code },
  });
  assertEpSdkOk(deleteRes, "epRemovePromoCode");

  return readSessionCart(client, auth, auth.cartId);
}
