# Checkout Session Foundation

> Phase A of the checkout session model. Server-side session state, cookie persistence, API route handlers, and the EPCheckoutSessionProvider Plasmic component.

## Jobs to Be Done

- As a **storefront developer**, I want a server-authoritative checkout session so that checkout state survives page reloads and is resistant to client-side tampering
- As a **Plasmic designer**, I want an EPCheckoutSessionProvider that exposes `checkoutSession` data and refActions so I can bind form fields, totals, and buttons to session state
- As a **storefront developer**, I want framework-agnostic route handler functions so I can wire them into any Next.js router (App Router or Pages Router)

## Acceptance Criteria

- [ ] `SessionStore` interface with `get(id)`, `set(id, session, ttl)`, `delete(id)` methods
- [ ] `CookieSessionStore` implementation — encrypted JSON in httpOnly cookie (~300-400 bytes coordination record)
- [ ] `CheckoutSession` TypeScript interface matching the exploration doc (including `cartHash`, `payment.gatewayMetadata.epTransactionId`, `payment.actionData`)
- [ ] `useCheckoutSession()` hook — SWR-cached, reads from `GET /current`, exposes session + mutation helpers
- [ ] `EPCheckoutSessionProvider` Plasmic component — DataProvider `"checkoutSession"`, payment registration context, previewState support
- [ ] refActions on provider: `createSession()`, `updateSession(data)`, `calculateShipping()`, `placeOrder(shippingRateId?)`, `confirmPayment(gatewayData)`, `reset()`
- [ ] 6 framework-agnostic route handler functions exported from the package:
  - `handleCreateSession(req)` — POST, creates session from cart, sets cookie
  - `handleGetSession(req)` — GET, reads session from cookie, reconstructs from EP if needed
  - `handleUpdateSession(req)` — PATCH, updates customer/address/shipping fields
  - `handleCalculateShipping(req)` — POST, fetches shipping rates for current address
  - `handlePay(req)` — POST, validates cart hash, creates EP order, authorizes EP payment, calls gateway adapter
  - `handleConfirm(req)` — POST, calls gateway adapter confirm, captures EP transaction (supports multiple calls for 3DS)
- [ ] `PaymentAdapter` interface with `initializePayment()` and `confirmPayment()` returning `requires_action | ready | succeeded | failed`
- [ ] Adapter registry (`getAdapter(name)`) with validation — unknown gateway returns 400
- [ ] Session creation trigger: provider mounts → checks cookie → GET to hydrate or waits for `createSession()`
- [ ] Session expiry: cookie TTL (30 minutes default), expired sessions return null from GET
- [ ] Cart hash validation in `/pay` handler — 409 response with refreshed session if cart changed
- [ ] Address format translation (camelCase session → snake_case EP) in `/pay` handler
- [ ] EP checkout sequence in `/pay`: validate hash → checkout cart → read tax → authorize payment → call adapter
- [ ] EP capture in `/confirm`: after adapter confirms success, capture EP transaction with gateway order ID
- [ ] Payment retry on same order: if gateway charge fails after EP checkout, allow re-authorize + re-charge on the same EP order
- [ ] Double-submit protection: reject `placeOrder()` if session status !== "open"
- [ ] Design-time mock data for `checkoutSession` DataProvider (previewStates: auto, collecting, paying, complete)
- [ ] Registration metadata with refActions, props, DataProvider name
- [ ] All handler functions accept typed request objects and return typed responses (no framework coupling)

## Happy Path

1. Consumer wires handler functions into their route framework (App Router, Pages Router, Express)
2. Designer drops `EPCheckoutSessionProvider` into checkout page
3. User navigates to checkout — provider mounts, calls `createSession()` with cart ID
4. Server creates session, snapshots cart, sets encrypted cookie
5. User fills form fields (managed by existing EPCustomerInfoFields etc.)
6. Designer's "Continue" button calls `updateSession({ customerInfo, shippingAddress })` via refAction
7. Server recalculates, returns updated session
8. `calculateShipping()` fetches rates, session updates with `availableShippingRates`
9. User selects shipping method — `updateSession({ selectedShippingRateId })`
10. User clicks "Place Order" — `placeOrder()` fires
11. Server validates cart hash, creates EP order (tax resolved), authorizes, charges gateway
12. Payment component handles client-side flow (3DS if needed)
13. `confirmPayment(gatewayData)` finalizes — server captures EP transaction
14. Session status → "complete", redirect to confirmation page

## Edge Cases

| Scenario | Expected Behaviour |
|----------|-------------------|
| Cart changed between session create and /pay | 409 with refreshed session, client shows "Cart updated" message |
| Session cookie missing/expired | GET returns null, provider prompts `createSession()` |
| Double-click on Place Order | Second call rejected — session status !== "open" |
| Gateway charge fails after EP order created | Allow retry: re-authorize + re-charge on same EP order |
| Unknown gateway name sent to /pay | 400 response: "Unknown payment gateway" |
| Session update with missing required fields for /pay | /pay validates completeness, returns 400 with missing field names |
| EP checkout API fails | 502 with error message, session remains "open" for retry |
| Browser refresh during checkout | Cookie persists, GET /current hydrates session |
| EP rate limits hit | Handler returns 503 with retry-after header |
| Multiple tabs open on checkout | Same session cookie — last write wins, no conflict |

## File Targets

| File | Type | Purpose |
|------|------|---------|
| `src/checkout/session/types.ts` | New | CheckoutSession, PaymentAdapter, SessionStore interfaces |
| `src/checkout/session/cookie-store.ts` | New | CookieSessionStore implementation |
| `src/checkout/session/adapter-registry.ts` | New | PaymentAdapter registry + getAdapter() |
| `src/checkout/session/use-checkout-session.ts` | New | SWR-cached hook |
| `src/checkout/session/EPCheckoutSessionProvider.tsx` | New | Plasmic component |
| `src/checkout/session/payment-registration-context.ts` | New | Internal React context for gateway registration |
| `src/checkout/session/design-time-data.ts` | New | Mock session data for previewStates |
| `src/api/endpoints/checkout-session/create-session.ts` | New | handleCreateSession handler |
| `src/api/endpoints/checkout-session/get-session.ts` | New | handleGetSession handler |
| `src/api/endpoints/checkout-session/update-session.ts` | New | handleUpdateSession handler |
| `src/api/endpoints/checkout-session/calculate-shipping.ts` | New | handleCalculateShipping handler |
| `src/api/endpoints/checkout-session/pay.ts` | New | handlePay handler (EP checkout + authorize + adapter) |
| `src/api/endpoints/checkout-session/confirm.ts` | New | handleConfirm handler (adapter confirm + EP capture) |
| `src/api/endpoints/checkout-session/index.ts` | New | Exports all handlers |
| `src/checkout/session/index.ts` | New | Exports component, hook, types |
| `src/checkout/session/__tests__/*.test.ts(x)` | New | Unit tests for all above |

## Out of Scope

- Vercel KV session store (Phase D — cookie store only for now)
- EP Custom API background sync for analytics
- Stripe/Clover webhook handlers
- Debounced session sync for single-page responsiveness (Phase D optimization)
- Session migration tooling (old → new)
