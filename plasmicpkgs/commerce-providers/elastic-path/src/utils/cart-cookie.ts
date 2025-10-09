import { ELASTICPATH_CART_COOKIE } from '../const'
import { getCookies, setCookies, removeCookies } from './cookies'

export const getCartId = () =>
  getCookies<string>(ELASTICPATH_CART_COOKIE)

export const setCartId = (id: string) =>
  setCookies(ELASTICPATH_CART_COOKIE, id)

export const removeCartCookie = () =>
  removeCookies(ELASTICPATH_CART_COOKIE)
