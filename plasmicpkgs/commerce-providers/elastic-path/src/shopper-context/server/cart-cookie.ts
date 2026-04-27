const DEFAULT_COOKIE_NAME = "ep_cart";

export interface CartCookieOptions {
  cookieName?: string;
  secure?: boolean;
  maxAge?: number;
  path?: string;
}

const defaults: Required<CartCookieOptions> = {
  cookieName: DEFAULT_COOKIE_NAME,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60, // 30 days
  path: "/",
};

/**
 * Build Set-Cookie header value for cart ID.
 * Consumer calls res.setHeader('Set-Cookie', ...) with this value.
 */
export function buildCartCookieHeader(
  cartId: string,
  opts?: CartCookieOptions
): string {
  const { cookieName, secure, maxAge, path } = { ...defaults, ...opts };
  const parts = [
    `${cookieName}=${encodeURIComponent(cartId)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Build Set-Cookie header value to clear the cart cookie.
 */
export function buildClearCartCookieHeader(
  opts?: CartCookieOptions
): string {
  const { cookieName, path } = { ...defaults, ...opts };
  return `${cookieName}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`;
}
