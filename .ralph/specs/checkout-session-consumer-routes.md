# Checkout Session — Consumer Route Examples

> Consumer-side Next.js route files that wire the package's handler functions into the storefront app. Pages Router for the Clover storefront deployment.

## Jobs to Be Done

- As a **storefront developer**, I want ready-to-use route files that wire the checkout session handlers into my Next.js app
- As a **storefront developer**, I want to understand the minimal setup required to get checkout sessions working

## Acceptance Criteria

- [ ] Pages Router route files provided for all 6 endpoints (Clover storefront uses Pages Router):
  - `pages/api/checkout/sessions/index.ts`
  - `pages/api/checkout/sessions/current.ts`
  - `pages/api/checkout/sessions/current/shipping.ts`
  - `pages/api/checkout/sessions/current/pay.ts`
  - `pages/api/checkout/sessions/current/confirm.ts`
- [ ] Each route file: imports handler from package, passes request + EP credentials, returns response
- [ ] EP credentials resolved from env vars (`EP_CLIENT_ID`, `EP_CLIENT_SECRET`, `EP_API_BASE_URL`)
- [ ] Clover credentials resolved from env vars (`CLOVER_ECOMMERCE_API_KEY`, `CLOVER_API_BASE_URL`)
- [ ] Stripe credentials resolved from env vars (`STRIPE_SECRET_KEY`)
- [ ] Gateway adapters registered in a shared config file that routes import
- [ ] Consumer route files deployed to the Clover storefront at `/Users/robert.field/Documents/Projects/EP/clover/worktree-alpha/apps/storefront/`

## Happy Path

1. Developer installs the package, copies route files into their Next.js app
2. Sets env vars for EP + Clover (or Stripe) credentials
3. Creates a shared adapter config that registers the gateways they use
4. Routes delegate to the package's handler functions — no business logic in the route files
5. Plasmic components connect to the routes via `EPCheckoutSessionProvider`'s `apiBaseUrl` prop (default: "/api")

## Edge Cases

| Scenario | Expected Behaviour |
|----------|-------------------|
| Missing EP credentials | Handler returns 500 with "Payment service not configured" |
| Missing gateway credentials (e.g., no STRIPE_SECRET_KEY) | Adapter registration skipped, `/pay` with that gateway returns 400 |
| Tenant-aware setup (multi-tenant) | Route files can resolve credentials from tenant headers (documented pattern) |
| CORS issues | Routes are same-origin (Next.js API routes), no CORS needed |

## File Targets (Consumer Storefront)

| File | Type | Purpose |
|------|------|---------|
| `pages/api/checkout/sessions/index.ts` | New | Create session route (Pages Router) |
| `pages/api/checkout/sessions/current.ts` | New | Get/update session route |
| `pages/api/checkout/sessions/current/shipping.ts` | New | Calculate shipping route |
| `pages/api/checkout/sessions/current/pay.ts` | New | Pay route (EP checkout + gateway charge) |
| `pages/api/checkout/sessions/current/confirm.ts` | New | Confirm route (3DS finalize + EP capture) |
| `lib/checkout-config.ts` | New | Adapter registry configuration |

## Out of Scope

- Express/Fastify/Hono route examples (Next.js only)
- Authentication middleware (assumes public checkout)
- Rate limiting middleware
- Logging/monitoring middleware
