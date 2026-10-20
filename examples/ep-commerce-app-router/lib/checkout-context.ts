/**
 * Checkout context factory — built per-request by every checkout-session route.
 *
 * Resolves:
 *   - checkoutContextFromSession(session): the shopper token, the session
 *     cart (the only cart checkout uses), the selected account and the
 *     signed-in member, locale and currency, all from one getSession. With an
 *     account selected, checkout places the order for that account.
 *   - getClientCredentialsToken: a closure-memoized admin token minter,
 *     scoped to this request only (no process-level cache).
 *   - adapterRegistry with Stripe registered when EP_CLIENT_SECRET is set.
 *     Zero-total orders complete without a registered gateway.
 *   - sessionStore (cookie-based JWE).
 *   - shippingRateResolver: one static example rate (demo only).
 */
import {
  checkoutContextFromSession,
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
        // Lets resume read the PaymentIntent from Stripe before it confirms
        // the order. Without them, resume relies on the keys EP Stripe
        // Payment sends.
        publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || undefined,
        stripeAccount: process.env.NEXT_PUBLIC_STRIPE_ACCOUNT_ID || undefined,
      })
    );
  }

  const ctx: SessionHandlerContext = {
    epCredentials: { clientId, apiBaseUrl },
    adapterRegistry,
    sessionStore,
    ...checkoutContextFromSession(session),
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
