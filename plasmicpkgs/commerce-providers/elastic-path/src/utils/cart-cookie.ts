import { ELASTICPATH_CART_COOKIE } from '../const'
import { getCookies, setCookies, removeCookies } from './cookies'

/**
 * @deprecated Use server-side httpOnly cookie via `resolveCartId` from
 * `shopper-context/server/resolve-cart-id.ts`. The new architecture manages
 * cart identity with httpOnly cookies that are not readable by client JS.
 */
export const getCartId = () =>
  getCookies<string>(ELASTICPATH_CART_COOKIE)

/**
 * @deprecated Use server-side httpOnly cookie via `buildCartCookieHeader` from
 * `shopper-context/server/cart-cookie.ts`. The server sets the cart cookie in
 * API route responses using Set-Cookie headers.
 */
export const setCartId = (id: string) =>
  setCookies(ELASTICPATH_CART_COOKIE, id)

/**
 * @deprecated Use server-side httpOnly cookie via `buildClearCartCookieHeader`
 * from `shopper-context/server/cart-cookie.ts`. The server clears the cart
 * cookie by setting Max-Age=0 in the Set-Cookie header.
 */
export const removeCartCookie = () =>
  removeCookies(ELASTICPATH_CART_COOKIE)
