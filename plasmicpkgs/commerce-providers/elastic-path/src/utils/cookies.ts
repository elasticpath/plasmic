import Cookies, { CookieAttributes } from 'js-cookie';
import { ELASTICPATH_COOKIE_EXPIRE } from '../const'

const options: CookieAttributes = {
  expires: ELASTICPATH_COOKIE_EXPIRE,
  sameSite: "none",
  secure: true
}

export const getCookies = <T>(name: string) => {
  const cookie = Cookies.get(name);
  return cookie ? (JSON.parse(cookie) as T) : undefined
}

export const setCookies = (name: string, value: any) => Cookies.set(name, JSON.stringify(value), options);

export const removeCookies = (name: string) => Cookies.remove(name);
