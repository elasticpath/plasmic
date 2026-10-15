/**
 * Records a cart that server code just created as the session's cart. The
 * set-cart endpoint has no route, so this server call is the only way in.
 *
 * Returns the Set-Cookie header strings to forward on the caller's response.
 */
import type { EpAuth } from "./create-ep-auth-better";

export async function persistCartId(
  epAuth: EpAuth,
  request: Request,
  cartId: string
): Promise<string[]> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  let res: Response;
  try {
    res = await (epAuth.handler.api as any).epCart({
      body: { cartId },
      headers: new Headers(cookieHeader ? { cookie: cookieHeader } : {}),
      asResponse: true,
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const setCookies: string[] = [];
  res.headers.forEach((value: string, key: string) => {
    if (key.toLowerCase() === "set-cookie") setCookies.push(value);
  });
  return setCookies;
}
