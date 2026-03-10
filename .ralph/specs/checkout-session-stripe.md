# Checkout Session — Stripe Payment Components

> Phase C. Stripe payment adapter (server-side) and EPStripePayment Plasmic component. 3DS is handled invisibly by Stripe's SDK.

## Jobs to Be Done

- As a **Plasmic designer**, I want to drop a single EPStripePayment component and configure its appearance theme so Stripe's PaymentElement matches my brand
- As a **storefront developer**, I want a Stripe payment adapter that creates PaymentIntents and verifies payment through the session model

## Acceptance Criteria

### Stripe Payment Adapter (Server-Side)

- [ ] `stripeAdapter` implements `PaymentAdapter` interface
- [ ] `initializePayment()`: creates Stripe PaymentIntent with `automatic_payment_methods: { enabled: true }`, returns `clientToken` (client_secret) and `gatewayMetadata: { paymentIntentId }`
- [ ] PaymentIntent amount = `session.totals.total`, currency = `session.totals.currency`
- [ ] PaymentIntent metadata includes `epOrderId` for reconciliation
- [ ] `confirmPayment()`: retrieves PaymentIntent by ID, checks `status === "succeeded"`, returns result
- [ ] PaymentIntent metadata `order_id` validated against session `order.id` to prevent cross-session attacks
- [ ] Stripe SDK initialized from `STRIPE_SECRET_KEY` env var

### EPStripePayment Component

- [ ] Props: `children?` (slot), `publishableKey`, `appearance?` (Stripe Elements theme object), `layout?` ("tabs" | "accordion"), `className?`, `previewState?`
- [ ] DataProvider `"stripePaymentData"`: `{ isReady, isProcessing, error, paymentMethodType }`
- [ ] Registers gateway name `"stripe"` with EPCheckoutSessionProvider via payment registration context
- [ ] Registers `confirm` handler that calls `stripe.confirmPayment({ clientSecret })` and returns `{ paymentIntentId }`
- [ ] Wraps children in `@stripe/react-stripe-js` `Elements` provider with `clientSecret` and `appearance`
- [ ] Renders Stripe `PaymentElement` inside the Elements provider
- [ ] Stripe handles 3DS internally — no additional code needed
- [ ] Lazy-loads `@stripe/stripe-js` via `loadStripe()` singleton
- [ ] `clientSecret` read from `session.payment.clientToken` after `/pay` returns
- [ ] PreviewStates: auto, ready, processing, error — with static mock card form rendering
- [ ] Registration metadata with props, DataProvider

### Integration

- [ ] EPStripePayment registered in `src/index.tsx` via `registerAll()`
- [ ] Stripe adapter registered in the adapter registry
- [ ] `stripe` (server-side SDK) added to dependencies; `@stripe/stripe-js` and `@stripe/react-stripe-js` remain as existing dependencies
- [ ] `Stripe` (server-side) imported only in the adapter (not bundled client-side)

## Happy Path

1. Designer drops `EPStripePayment` inside `EPCheckoutSessionProvider` with `publishableKey` configured
2. Shopper clicks "Place Order" → `placeOrder()` fires
3. Provider sends `{ gateway: "stripe" }` to `/pay`
4. Server: EP checkout → EP authorize → create PaymentIntent → return `clientSecret`
5. EPStripePayment receives `clientSecret`, loads Stripe SDK, renders PaymentElement
6. Shopper enters card details in PaymentElement
7. EPStripePayment calls `stripe.confirmPayment({ clientSecret })`
8. Stripe handles 3DS internally if needed (modal)
9. On success, provider calls `/confirm` with `{ paymentIntentId }`
10. Server verifies PaymentIntent succeeded, captures EP transaction
11. Session → "complete"

## Edge Cases

| Scenario | Expected Behaviour |
|----------|-------------------|
| Stripe SDK fails to load | `stripePaymentData.error` set, payment form doesn't render |
| PaymentIntent creation fails | `/pay` returns error, session remains "open" |
| `stripe.confirmPayment()` fails (card declined) | Error surfaced in `stripePaymentData.error`, session remains "open" for retry |
| 3DS challenge cancelled by user | `confirmPayment` returns error, payment fails gracefully |
| PaymentIntent `order_id` metadata doesn't match session | `/confirm` returns 400 — potential cross-session attack |
| EPStripePayment placed outside EPCheckoutSessionProvider | Console warning, component renders children but registration no-ops |
| `publishableKey` not provided | Validation error in component, clear message |
| Stripe API key missing on server | `/pay` handler returns 500 with "Payment service not configured" |

## File Targets

| File | Type | Purpose |
|------|------|---------|
| `src/checkout/session/adapters/stripe-adapter.ts` | New | PaymentAdapter implementation for Stripe |
| `src/checkout/session/EPStripePayment.tsx` | New | Stripe Elements wrapper + PaymentElement |
| `src/checkout/session/__tests__/stripe-adapter.test.ts` | New | Adapter unit tests |
| `src/checkout/session/__tests__/EPStripePayment.test.tsx` | New | Component tests |

## Out of Scope

- Stripe webhook handling (payment_intent.succeeded, etc.)
- Stripe refund/void flows
- Stripe saved cards / Customer portal
- Stripe Link integration
- Stripe subscription/recurring payments
- Apple Pay / Google Pay configuration (Stripe enables these via `automatic_payment_methods`)
