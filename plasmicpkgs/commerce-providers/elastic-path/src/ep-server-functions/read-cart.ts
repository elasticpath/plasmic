import { getACart } from "@epcc-sdk/sdks-shopper";
import type { Cart } from "../types/cart";
import {
  buildCartReadHeaders,
  type CartReadHeaderInput,
} from "../utils/cart-read-headers";
import { normalizeCart } from "../utils/normalize";

type EpClient = Parameters<typeof getACart>[0]["client"];

/**
 * Reads a cart with its lines, priced for the shopper's locale and currency.
 * Every cart read that returns a `Cart` goes through here, so the pricing
 * headers are the same everywhere. Throws when Elastic Path returns no cart.
 */
export async function readCart(
  client: EpClient,
  cartId: string,
  pricing: CartReadHeaderInput
): Promise<Cart> {
  const response = await getACart({
    client,
    path: { cartID: cartId },
    query: { include: ["items"] },
    headers: buildCartReadHeaders(pricing),
  });
  return normalizeCart(response.data!, pricing.locale ?? "en-US");
}
