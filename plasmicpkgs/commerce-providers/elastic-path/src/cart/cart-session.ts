/**
 * Browser-only cart-ID accessors. The cart ID lives in better-auth's
 * HttpOnly `session_data` cookie; on the server read it from
 * `auth.api.getSession()` instead.
 */
import { createEpIdentityClient } from "../identity/client";

export async function getCartIdFromSession(
  basePath?: string
): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    const session = await createEpIdentityClient({ basePath }).getSession();
    return session?.session?.epCartId ?? undefined;
  } catch {
    return undefined;
  }
}

export async function setCartIdInSession(
  id: string,
  basePath?: string
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await createEpIdentityClient({ basePath }).setCart({ cartId: id });
  } catch {
    // Best-effort write. Persist failure is non-fatal — the operation
    // that produced the new cart ID has already succeeded against EP;
    // the next page load will re-derive it from the cookie if it lands.
  }
}
