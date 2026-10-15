/**
 * Checkout context factory — built per-request by every checkout-session route.
 *
 * Resolves:
 *   - shopperAccessToken from the better-auth session (shopper-scoped).
 *   - accountToken: the selected account's credential, from the same session.
 *   - getClientCredentialsToken: a closure-memoized admin token minter,
 *     scoped to this request only (no process-level cache).
 *   - sessionCartId: the shopper's session cart, the only cart checkout uses.
 *   - adapterRegistry with Stripe registered when EP_CLIENT_SECRET is set.
 *     Zero-total orders complete without a registered gateway.
 *   - sessionStore (cookie-based JWE).
 *   - shippingRateResolver: one static example rate (demo only).
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

const SESSION_SECRET = resolveAuthSecret(process.env.CHECKOUT_SESSION_SECRET, {
  label: "CHECKOUT_SESSION_SECRET",
});

const sessionStore = new CookieSessionStore(SESSION_SECRET);

const EXAMPLE_STANDARD_SHIPPING_AMOUNT_MINOR = 599;

export interface RequestCheckoutContext {
  ctx: SessionHandlerContext;
}

export async function buildCheckoutContext(
  request: Request
): Promise<RequestCheckoutContext> {
  const config = await getEpProviderConfig(epAuth.config.hostAllowlist);
  const clientId =
    config?.clientId ??
    process.env.EP_CLIENT_ID ??
    "bootstrap-placeholder";
  const apiBaseUrl =
    config?.host ??
    process.env.EP_HOST ??
    "https://useast.api.elasticpath.com";

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
  const accountToken = session?.session?.account?.token;
  const sessionCartId = session?.cart?.id ?? undefined;

  // Per-request admin-token resolver. Built only when EP_CLIENT_SECRET is
  // present; absence cleanly disables admin-side EP calls (Stripe gateway
  // won't be registered either). The secret is EP_CLIENT_ID's, which need not
  // be the project's shopper client.
  const clientSecret = process.env.EP_CLIENT_SECRET;
  const getClientCredentialsToken = clientSecret
    ? createClientCredentialsTokenResolver({
        host: apiBaseUrl,
        clientId: process.env.EP_CLIENT_ID ?? clientId,
        clientSecret,
      })
    : undefined;

  // Adapter registry — Stripe when admin auth is available (checkoutApi /
  // paymentSetup need the client-credentials token).
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
    accountToken,
    sessionCartId,
    getClientCredentialsToken,
    // Example/demo pricing only. Production hosts must replace this with real
    // server-side rate logic (carrier API, EP rules, etc.).
    shippingRateResolver: (checkoutSession) => [
      {
        id: "example-standard",
        name: "Standard Shipping",
        description: "Example rate — replace in production",
        amount: EXAMPLE_STANDARD_SHIPPING_AMOUNT_MINOR,
        currency: checkoutSession.totals?.currency || "USD",
        deliveryTime: "5-7 days",
        serviceLevel: "standard",
      },
    ],
  };

  return { ctx };
}
