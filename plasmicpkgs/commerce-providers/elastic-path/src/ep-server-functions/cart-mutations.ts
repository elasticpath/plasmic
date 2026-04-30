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
