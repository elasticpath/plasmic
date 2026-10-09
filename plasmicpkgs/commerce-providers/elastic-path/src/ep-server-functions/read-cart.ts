import { getACart } from "@epcc-sdk/sdks-shopper";
import type { Cart } from "../types/cart";
import type { EpLocaleAndCurrency } from "../types/locale-and-currency";
import { buildCartReadHeaders } from "../utils/cart-read-headers";
import { normalizeCart } from "../utils/normalize";

type EpClient = Parameters<typeof getACart>[0]["client"];

type CartResponse = NonNullable<Awaited<ReturnType<typeof getACart>>["data"]>;

/**
 * Reads a cart with its lines, in Elastic Path's own shape, priced for the
 * shopper's locale and currency. Checkout hashes these lines and charges this
 * total, so it reads them unnormalized. Throws when Elastic Path returns no
 * cart.
 */
export async function readCartResponse(
  client: EpClient,
  cartId: string,
  pricing: EpLocaleAndCurrency
): Promise<CartResponse> {
  const response = await getACart({
    client,
    path: { cartID: cartId },
    query: { include: ["items"] },
    headers: buildCartReadHeaders(pricing),
  });
  if (!response.data) {
    throw new Error(`Elastic Path returned no cart for ${cartId}`);
  }
  return response.data;
}

/**
 * Reads a cart with its lines, priced for the shopper's locale and currency.
 * Every cart read that returns a `Cart` goes through here, and checkout reads
 * through `readCartResponse`, so the pricing headers are the same everywhere.
 * Throws when Elastic Path returns no cart.
 */
export async function readCart(
  client: EpClient,
  cartId: string,
  pricing: EpLocaleAndCurrency
): Promise<Cart> {
  return normalizeCart(
    await readCartResponse(client, cartId, pricing),
    pricing.locale ?? "en-US"
  );
}
