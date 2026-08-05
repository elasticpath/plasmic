/**
 * Checkout context factory — built per-request by every checkout-session route.
 *
 * Resolves:
 *   - shopperAccessToken from the better-auth session (shopper-scoped).
 *   - getClientCredentialsToken: a closure-memoized admin token minter,
 *     scoped to this request only (no process-level cache).
 *   - epCartId from the better-auth session (lets routes that need a cartId
 *     read it server-side instead of trusting the client).
 *   - adapterRegistry with Stripe registered when EP_CLIENT_SECRET is set.
 *   - sessionStore (cookie-based JWE).
 */
import {
  CookieSessionStore,
  createAdapterRegistry,
  createClientCredentialsTokenResolver,
  createStripeAdapter,
  resolveAuthSecret,
  type SessionHandlerContext,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { cookies } from "next/headers";
import { epAuth, getEpProviderConfig } from "./ep-auth";

// No fallback: in production this throws rather than encrypting checkout
// sessions under a value that shipped in public example code.
const SESSION_SECRET = resolveAuthSecret(process.env.CHECKOUT_SESSION_SECRET, {
  label: "CHECKOUT_SESSION_SECRET",
});

const sessionStore = new CookieSessionStore(SESSION_SECRET);

export interface RequestCheckoutContext {
  ctx: SessionHandlerContext;
  /** epCartId from the better-auth session — used by /sessions create. */
  epCartId: string | null;
}

export async function buildCheckoutContext(
  request: Request
): Promise<RequestCheckoutContext> {
  const config = await getEpProviderConfig();
  const clientId =
    config?.clientId ??
    process.env.EP_CLIENT_ID ??
    "bootstrap-placeholder";
  const apiBaseUrl =
    config?.host ??
    process.env.EP_HOST ??
    "https://useast.api.elasticpath.com";

  // The session lives in cookies; passing only headers reads nothing.
  const cookieStore = await cookies();
  const session = await epAuth.api
    .getSession({
      cookies: Object.fromEntries(
        cookieStore.getAll().map((c) => [c.name, c.value])
      ),
      headers: Object.fromEntries(request.headers.entries()),
    })
    .catch(() => null);

  const shopperAccessToken = session?.session?.accessToken ?? "";
  const epCartId = session?.cart?.id ?? null;

  // Per-request admin-token resolver. Built only when EP_CLIENT_SECRET is
  // present; absence cleanly disables admin-side EP calls (Stripe gateway
  // won't be registered either).
  const clientSecret = process.env.EP_CLIENT_SECRET;
  const getClientCredentialsToken = clientSecret
    ? createClientCredentialsTokenResolver({
        host: apiBaseUrl,
        clientId,
        clientSecret,
      })
    : undefined;

  // Adapter registry — register Stripe only when admin auth is available.
  const adapterRegistry = createAdapterRegistry();
  if (getClientCredentialsToken) {
    adapterRegistry.register(
      "stripe",
      createStripeAdapter({
        host: apiBaseUrl,
        clientId,
        getClientCredentialsToken,
      })
    );
  }

  const ctx: SessionHandlerContext = {
    epCredentials: { clientId, apiBaseUrl },
    adapterRegistry,
    sessionStore,
    shopperAccessToken,
    getClientCredentialsToken,
  };

  return { ctx, epCartId };
}
