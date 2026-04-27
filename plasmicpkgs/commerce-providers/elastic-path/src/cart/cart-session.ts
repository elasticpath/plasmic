/**
 * Session-backed cart-ID accessors (PRD #273).
 *
 * Replaces the legacy JS-readable `elasticpath_cart` cookie. The cart ID
 * now lives inside better-auth's stateless `session_data` JWE cookie
 * (HttpOnly), single source of truth.
 *
 * - `getCartIdFromSession()` GETs `/api/ep/get-session` and reads
 *   `session.epCartId`.
 * - `setCartIdInSession(id)` POSTs `{cartId}` to `/api/ep/ep/cart`,
 *   which calls `setSessionCookie` to persist the field. better-auth's
 *   `nextCookies()` plugin handles cookie write-back.
 *
 * Both helpers are browser-only — they fire fetches that include the
 * session cookies via `credentials: "include"`. On the server, code
 * that needs the cart ID should read it from `auth.api.getSession()`
 * directly, not via this module.
 */

const AUTH_BASE_PATH = "/api/ep";

interface SessionResponse {
  user?: { id?: string } | null;
  session?: {
    epCartId?: string;
    [key: string]: unknown;
  } | null;
}

export async function getCartIdFromSession(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    const res = await fetch(`${AUTH_BASE_PATH}/get-session`, {
      credentials: "include",
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as SessionResponse | null;
    return data?.session?.epCartId ?? undefined;
  } catch {
    return undefined;
  }
}

export async function setCartIdInSession(id: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(`${AUTH_BASE_PATH}/ep/cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cartId: id }),
      credentials: "include",
    });
  } catch {
    // Best-effort write. Persist failure is non-fatal — the operation
    // that produced the new cart ID has already succeeded against EP;
    // the next page load will re-derive it from the cookie if it lands.
  }
}
