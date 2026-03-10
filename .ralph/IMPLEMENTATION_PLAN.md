# Implementation Plan

**Last updated:** 2026-03-10 (rev 11 — composable checkout spec added)
**Branch:** `feat/server-cart-shopper-context`
**Focus:** Checkout session model — server-authoritative session, payment adapters, gateway components

---

## Status Summary

| Category | Count |
|----------|-------|
| Active specs | 6 (checkout-session-* + composable-checkout) |
| Total items implemented | 80 / 88 |
| Test suites | 75 |
| Total tests | 1,406 |
| Build verified | 2026-03-10 |

| Spec | Phase | Status |
|------|-------|--------|
| `checkout-session-foundation.md` | A | Complete |
| `checkout-session-clover.md` | B | Complete |
| `checkout-session-stripe.md` | C | Complete |
| `checkout-session-hardening.md` | D | Complete |
| `checkout-session-consumer-routes.md` | Consumer | Complete |
| `composable-checkout.md` | Composable | In Progress |

---

## Codebase Baseline (Reference)

### Surviving Composable Components (Unchanged)
- `EPCustomerInfoFields`, `EPShippingAddressFields`, `EPBillingAddressFields` — manage own state, fall back gracefully
- `EPBillingAddressToggle`, `EPCountrySelect` — standalone
- `EPCheckoutCartSummary`, `EPCheckoutCartItemList`, `EPCheckoutCartField` — provide/read `checkoutCartData`, independent of checkout flow
- `EPPromoCodeInput` — standalone

### Existing Dependencies Used
- `swr` — peerDependency (>=1.0.0), used by `use-checkout-session.ts`
- `@stripe/stripe-js` + `@stripe/react-stripe-js` — bundled deps, used by Phase C
- `zod` — available for session schema validation
- `js-cookie` — available for cookie operations
- `stripe` (server-side) — added in Phase C (C-1.1); also fixes pre-existing gap where `setup-payment.ts` / `confirm-payment.ts` imported it without it being in `package.json`
- No Clover npm package — Clover SDK loaded via script tag; types defined manually in `clover-types.ts`

### Existing API Patterns (followed throughout)
- Handler functions: default-exported async functions in `src/api/endpoints/`
- Use `APIResponse<T>` from `src/api/utils/api-helpers.ts`
- Validation via `src/api/utils/validation.ts` (note: only checks Stripe env vars — see SG-8)
- Error handling via `src/api/utils/error-handling.ts` (`CheckoutError` hierarchy, `StripeError` but no `CloverError` — see SG-7)
- EP SDK calls via `@epcc-sdk/sdks-shopper`
- Cart cookie pattern in `src/shopper-context/server/cart-cookie.ts`

### Known Pre-existing Gap (Fixed)
- EP `confirmPayment` was never called in the old composable checkout. The session model fixes this by design — the confirm handler captures the EP transaction after the gateway confirms.

### Clover 3DS Flow (Reference)
- Token: `clover.createToken()` → single-use token
- Charge: `POST /v1/charges` with idempotency key `clover-charge-${orderId}`
- 3DS detection: `threeDsData.status` → `METHOD_FLOW` | `CHALLENGE` | null
- Method: `perform3DSFingerPrinting(...)` → `executePatch` CustomEvent → `finalizeCloverPayment(chargeId, flowStatus)`
- Challenge: `perform3DSChallenge(...)` → `executePatch` CustomEvent → `finalizeCloverPayment(chargeId, flowStatus)`
- EP capture: `POST /v2/orders/{id}/transactions/{id}/capture` with `custom_reference: chargeId`
- State machine phases: idle → tokenizing → charging → fingerprinting/challenging → completing → done/error
- Card declined = HTTP 402 from Clover → error with `code: "card_declined"`
- 3DS SDK URL: `https://checkout.clover.com/clover3DS/clover3DS-sdk.js`, loaded as singleton promise
- `window.clover3DSUtil` exposes `perform3DSFingerPrinting()` and `perform3DSChallenge()`

---

## Spec Gaps & Decisions

### SG-1: Form Field Pre-Population After Page Refresh
**Gap:** Surviving form components read from `checkoutData` DataProvider for initial pre-population. After Phase D deletes `EPCheckoutProvider`, `checkoutData` won't exist.
**Decision:** Phase D adds D-4.3 to adapt all 3 form components to also read from `checkoutSession.customerInfo` / `checkoutSession.shippingAddress` / `checkoutSession.billingAddress` when `checkoutData` is absent.

### SG-2: Orphaned Hooks After Phase D
**Gap:** `use-checkout.tsx` and `use-stripe-payment.tsx` remain after Phase D.
**Decision:** Leave untouched. `use-stripe-payment.tsx` is used by the legacy `EPPaymentForm` (not in scope for session model). Legacy monolithic components (EPCheckoutForm, EPPaymentForm, EPOrderSummary, EPCheckoutConfirmation) are out of scope.

### SG-3: Cookie Encryption
**Gap:** Spec says "encrypted JSON in httpOnly cookie" but no crypto dependency existed.
**Decision:** Node.js built-in `crypto` (AES-256-GCM). Encryption key from env var `CHECKOUT_SESSION_SECRET`.

### SG-4: Clover SDK Types
**Gap:** No Clover TypeScript package as a dependency.
**Decision:** Types defined manually in `src/checkout/session/adapters/clover-types.ts`. SDK loaded via script tag at runtime.

### SG-5: Server-Side Stripe Import
**Gap:** `stripe` (server-side SDK) not in `package.json`.
**Decision:** Added in Phase C (C-1.1). Lazy `require('stripe')` inside the adapter factory avoids pulling it into client bundles.

### SG-6: Request Object Abstraction
**Gap:** Handlers need a framework-agnostic request/response type.
**Decision:** `SessionRequest` type: `{ body, headers, cookies }`. `SessionResponse` type: `{ status, body, headers? }`. Consumer route files translate their framework's req/res into this shape.

### SG-7: No CloverError in Error Hierarchy
**Gap:** `error-handling.ts` has `StripeError` but no `CloverError`.
**Decision:** Clover adapter uses `PaymentError` with `details.gateway: "clover"` and gateway-specific `details.code` values. No new class needed.

### SG-8: validateEnvironmentVariables() Only Checks Stripe
**Gap:** Session handlers need to validate `CHECKOUT_SESSION_SECRET` and gateway-specific vars.
**Decision:** Session handlers do NOT call `validateEnvironmentVariables()`. `CookieSessionStore` validates `CHECKOUT_SESSION_SECRET` at construction. Gateway vars validated when adapters are instantiated in consumer's `checkout-config.ts`.

### SG-9: Existing stripe Server SDK Missing from package.json
**Gap:** `setup-payment.ts` and `confirm-payment.ts` imported `stripe` without it in `package.json`.
**Decision:** Phase C (C-1.1) adds `stripe` to `package.json`, fixing both the session model need and this pre-existing gap.

---

## Key Learnings

- **tsdx build cache corruption:** `ENOENT` errors during tsdx build → clear `node_modules/.cache`.
- **tsdx inline type imports:** `rollup-plugin-typescript2` does NOT support `import { Foo, type Bar }` syntax. Use separate `import type { Bar }` statements. Fixed in `EPCheckoutSessionProvider.tsx` and all Clover components.
- **Stripe lazy require:** `require('stripe')` inside the adapter factory (not top-level) prevents the Node.js-only SDK from being pulled into client bundles by consumer bundlers.
- **Virtual mock pattern:** `jest.mock("stripe", ..., { virtual: true })` needed when `stripe` may not be physically installed in the monorepo dev environment.
- **esbuild mock pattern:** Use `jest.mock()` at top, then `require()` to get mocked refs (same as Phase A handlers). `jest.spyOn` on `jest.requireActual()` does NOT work with esbuild — use full mock factory instead.
- **`@jest-environment jsdom` docblock:** All test files that need DOM must include `/** @jest-environment jsdom */` as the first docblock line. Root `jest.config.js` defaults to `node`; `jest.config.checkout.js` sets `jsdom`, but `yarn test` runs the root config in CI.
- **`global.fetch` mock setup:** `global.fetch = jest.fn()` must be set before `mockReset()` is called — otherwise `mockReset` throws if fetch is undefined.
- **jest.config.checkout.js testMatch bug:** Original pattern only matched `checkout/` (legacy), NOT `checkout-session/`. Fixed by adding explicit `checkout-session/**` pattern.
- **SWR deduplication:** `EPStripePayment` uses `useCheckoutSession(apiBaseUrl)` internally. SWR deduplicates by key, so it shares cache with `EPCheckoutSessionProvider`. Tests mock `../use-checkout-session` directly instead of SWR.
- **EPStripePayment refAction:** `submitPayment` refAction calls `stripe.confirmPayment()` then `hook.confirmPayment({ paymentIntentId })`. Exposed for designers to wire to a "Pay" button.
- **EPCheckoutSessionProvider DataProvider callbacks:** Includes `updateSession` and `calculateShipping` callbacks so child components (e.g., `EPShippingMethodSelector`) can call mutations without ref access to the provider.
- **`./server` subpath export:** tsdx bundles all JS into the main entry. Server-only code (handlers, `CookieSessionStore`, adapters) can't be in the main entry without pulling Node.js-only deps into client bundles. Solution: separate `build-server.mjs` using esbuild (externalizes all deps) produces `dist/server.js`, mapped via `package.json` `"exports"` to `"./server"`. Consumer imports from `@elasticpath/plasmic-ep-commerce-elastic-path/server`.
- **Consumer route helper pattern:** `lib/checkout-handler.ts` provides `runHandler(req, res, handler)` that adapts Next.js `NextApiRequest` → `SessionRequest`, calls handler, writes `SessionResponse`. All 5 route files are thin wrappers (~15 lines each).
- **EP SDK client pattern:** Handlers use `{ settings: { application_id, host } } as any` for the EP client, matching the existing handler pattern. Not `createShopperClient()`.
- **`EPCloverCardField.tsx`:** Internal shared component created to avoid 4× duplication across card field components. Not referenced in any spec.
- **EP order retry in `/pay`:** When `session.order` already exists (from a previous failed payment attempt), the handler skips `checkoutApi` and reuses the existing order ID. A new `paymentSetup` (authorize) is still created because the previous authorization may have been voided or expired. The double-submit guard (`session.status !== "open"`) prevents concurrent retries; the `failed` case in the adapter result mapping resets status to `"open"` to enable retries.
- **`toHaveClass` / `toHaveTextContent` not available:** Root jest config does not include `@testing-library/jest-dom`. Use plain DOM assertions like `element.className.includes()` and `element.textContent` instead.

---

## Deferred / Future Work

Items explicitly called out as deferred in the specs or not in scope for this branch:

- **Vercel KV session store** — `CookieSessionStore` is the only implementation; KV store is the intended production alternative
- **Webhook-based payment confirmation** — Stripe webhooks (`payment_intent.succeeded`) and Clover webhooks for async confirmation
- **Stripe saved cards / Customer portal** — Stripe `SetupIntent` flow, saved payment methods
- **Stripe Link integration** — one-click Stripe Link checkout
- **Clover saved cards / customer vault** — Clover card vault for returning customers
- **Clover refund/void flows** — post-capture refund and pre-capture void handlers
- **Multi-tender (split payment)** — paying with multiple gateways / gift cards
- **Order confirmation page components** — Plasmic components for the post-checkout confirmation screen
- **Email receipt integration** — triggering transactional email after `complete` status
- **Debounced session sync** — auto-saving form field changes to the session without explicit user action
- **Express / Fastify / Hono route examples** — Consumer spec only documents Next.js Pages Router; other framework adapters are mentioned but not implemented
- **Authentication / rate-limiting middleware for routes** — Consumer route helpers have no auth or rate-limit layer
- **Server-side payment retry rate limiting** — card testing mitigation (referenced in hardening spec)

---

## Composable Checkout (composable-checkout.md)

**Status:** In Progress — Phase 1 (P0) complete

Replaces deleted orchestration (D-5) with new headless Provider → DataProvider components using `useCheckout()` hook.

### Phase 1 (P0) — 4 Items
| Item | Description | Status |
|------|-------------|--------|
| CC-1.1 | `EPCheckoutProvider` — root orchestrator wrapping `useCheckout()`, 9 refActions, `checkoutData` DataProvider | Complete |
| CC-1.2 | `EPCheckoutStepIndicator` — 4-step repeater with `currentStep` DataProvider per iteration | Complete |
| CC-1.3 | `EPCheckoutButton` — step-aware submit/advance button with `checkoutButtonData` DataProvider | Complete |
| CC-1.4 | `EPOrderTotalsBreakdown` — updated priority-1 source to `checkoutData.summary` | Complete |

### Phase 2 (P1) — 3 Items (updates to existing components)
| Item | Description | Status |
|------|-------------|--------|
| CC-2.1 | `EPCustomerInfoFields` — fix pre-population to read from `shopperContextData` instead of `checkoutSession` | Pending |
| CC-2.2 | `EPShippingAddressFields` — add `useAccountAddress(addressId)` refAction, add server-side address validation API call | Pending |
| CC-2.3 | `EPBillingAddressFields` — already aligned, no changes needed | Complete |

### Phase 3 (P2) — 2 Items
| Item | Description | Status |
|------|-------------|--------|
| CC-3.1 | `EPPaymentElements` — Stripe Elements wrapper with `clientSecret` from checkout context, `paymentData` DataProvider | Pending |
| CC-3.2 | `EPShippingMethodSelector` — update to call `useCheckout().calculateShipping()`, add `parentComponentName`, update `selectMethod` to call parent context | Pending |

### Registration
All new Phase 1 components registered in `registerCheckout.tsx` in leaf-first order: `EPCheckoutButton` → `EPCheckoutStepIndicator` → `EPCheckoutProvider`.

---

## Spec Inconsistencies Found During Implementation

- **Consumer spec says "6 endpoints" but there are 5 route files.** `GET /current` and `PATCH /current` are collapsed into a single `current.ts` route file that handles both methods, not two separate files.
- **`EPCloverCardField.tsx` not in any spec.** This shared internal component was created to avoid duplication across the four Clover card field components. It is not referenced in `checkout-session-clover.md`.
- **`lib/checkout-handler.ts` not in Consumer spec.** The spec describes route files but does not mention the `runHandler` helper. It emerged as an implementation necessity.
- **`CHECKOUT_SESSION_SECRET` env var not in spec acceptance criteria.** The Consumer spec lists env vars in the body but `CHECKOUT_SESSION_SECRET` is absent from the formal acceptance criteria checklist.
