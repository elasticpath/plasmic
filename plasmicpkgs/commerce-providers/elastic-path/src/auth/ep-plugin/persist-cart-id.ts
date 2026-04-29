/**
 * Persist a cartId onto the better-auth session cookie by calling the
 * EP plugin's /ep/cart endpoint internally. Used by both the dedicated
 * cart REST routes (`cart/server-routes.ts`) and the EP server-function
 * proxy (`auth/ep-plugin/proxy-routes.ts`) — any place where a cart was
 * just created server-side and the client cookie needs to catch up.
 *
 * Returns the Set-Cookie header strings emitted by the /ep/cart call,
 * so the calling route can forward them onto its own response.
 */
import type { EpAuth } from "./create-ep-auth-better";

export async function persistCartId(
  epAuth: EpAuth,
  request: Request,
  cartId: string
): Promise<string[]> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const incomingOrigin =
    request.headers.get("origin") ?? new URL(request.url).origin;
  const internalReq = new Request(
    `${new URL(request.url).origin}/api/ep/ep/cart`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the client's Origin (or the request's URL origin as
        // fallback) so better-auth's trustedOrigins check passes for
        // this server-to-server-style internal call. Without this the
        // synthetic Request has no Origin header and better-auth
        // rejects with 403 "Invalid origin".
        Origin: incomingOrigin,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({ cartId }),
    }
  );
  let res: Response;
  try {
    res = await epAuth.handler.handler(internalReq);
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
