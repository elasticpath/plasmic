export interface ShopperHeader {
  cartId?: string;
  accountId?: string;
  locale?: string;
  currency?: string;
}

/**
 * Parse X-Shopper-Context header from incoming request.
 * Returns {} if absent or malformed.
 *
 * Works with any request-like object that has headers.
 */
export function parseShopperHeader(
  headers: Record<string, string | string[] | undefined>
): ShopperHeader {
  const raw = headers["x-shopper-context"];
  if (!raw || typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Resolve cart ID from request.
 * Priority: X-Shopper-Context header > httpOnly cookie > null.
 *
 * @param headers - Request headers object
 * @param cookies - Parsed cookies object
 * @param cookieName - Name of the httpOnly cart cookie (default: 'ep_cart')
 */
export function resolveCartId(
  headers: Record<string, string | string[] | undefined>,
  cookies: Record<string, string | undefined>,
  cookieName = "ep_cart"
): string | null {
  const header = parseShopperHeader(headers);
  if (header.cartId) return header.cartId;
  return cookies[cookieName] || null;
}
