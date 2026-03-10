# Implementation Plan

**Last updated:** 2026-03-10 (rev 7 — Phase D complete)
**Branch:** `feat/server-cart-shopper-context`
**Focus:** Checkout session model — server-authoritative session, payment adapters, gateway components

## Status Summary

| Category | Count |
|----------|-------|
| Active specs | 5 (checkout-session-*) |
| Total items to implement | 78 |
| Completed items | 72 |

### Recent Completions
- **Phase D complete** (2026-03-10): All 21 items verified/implemented. Deleted 5 old composable components + 4 test files. Adapted 5 surviving components to read from `checkoutSession` DataProvider. 4 new session-mode tests. 291 tests pass (19 suites).
- **Phase C complete** (2026-03-10): All 8 items implemented + tested. 2 test files, 22 new tests.
- **Phase B complete** (2026-03-10): All 16 items implemented + tested. 3 test files, 34 new tests.
- **Phase A complete** (2026-03-10): All 27 items implemented + tested. 8 test files, 157 new tests.
- **D-1.1 + D-6.1** (cart-hash) completed early — required by A-4.5 pay.ts.
- **Build note**: tsdx build cache can corrupt; clear `node_modules/.cache` if `ENOENT` errors appear.
- **EP SDK note**: `getShippingOptions` exists in `@epcc-sdk/sdks-shopper` (the build agent incorrectly assumed it didn't). calculate-shipping.ts handler uses it correctly.
- **EP SDK client pattern**: Handlers use `{ settings: { application_id, host } } as any` for the EP client, matching the existing handler pattern. Not `createShopperClient()`.
- **EPCloverCardField.tsx internal shared component created** to avoid 4x duplication across card field components.
- **esbuild mock pattern**: use jest.mock() at top, then require() to get mocked refs (same as Phase A handlers).
- **Session exports expanded** in session/index.ts — all Clover components, context, singletons, and adapter exports added.
- **Build note**: tsdx's rollup-plugin-typescript2 does NOT support inline `type` imports (`import { Foo, type Bar }`). Use separate `import type { Bar }` statements. Fixed in EPCheckoutSessionProvider.tsx and all Clover components.
- **Stripe adapter uses `require('stripe')` lazily** inside the factory function to avoid pulling the Node.js server-side SDK into client bundles. tsdx externalizes dependencies, but consumer bundlers would resolve top-level imports.
- **`jest.mock("stripe", ..., { virtual: true })`** needed because `stripe` may not be physically installed in the monorepo dev environment. Virtual mocks let Jest mock modules that don't exist on disk.
- **EPStripePayment uses `useCheckoutSession(apiBaseUrl)` internally** — SWR deduplicates by key, so it shares cache with EPCheckoutSessionProvider. This lets the component call confirmPayment after stripe.confirmPayment succeeds. Tests mock `../use-checkout-session` directly instead of SWR.
- **EPStripePayment exposes `submitPayment` refAction** for the designer to wire to a "Pay" button. The refAction calls stripe.confirmPayment() then hook.confirmPayment({ paymentIntentId }).
- **jest.config.checkout.js** is the correct test config for all checkout/session tests (testEnvironment: jsdom, setup file). NOT the root jest.config.js.
- **Composable component session-mode tests** mock `@plasmicapp/host` entirely with controllable fakes (`mockUseSelector`, `mockUsePlasmicCanvasContext`). `jest.spyOn` on `jest.requireActual()` does NOT work with esbuild — use full mock factory instead.
- **EPCheckoutSessionProvider DataProvider now includes `updateSession` and `calculateShipping` callbacks** — enabling child components (EPShippingMethodSelector) to call mutations without ref access to the provider.

## Active Spec Status

| Spec | Phase | Status |
|------|-------|--------|
| `checkout-session-foundation.md` | A | Complete |
| `checkout-session-clover.md` | B | Complete |
| `checkout-session-stripe.md` | C | Complete |
| `checkout-session-hardening.md` | D | Complete |
| `checkout-session-consumer-routes.md` | Consumer | Pending |

---

## Codebase Baseline (Confirmed via Code Search)

### Directories That DO NOT Exist Yet
- `src/checkout/session/` — all Phase A/B/C files are new
- `src/api/endpoints/checkout-session/` — all session handler files are new

### Existing Code That Will Be Deleted (Phase D)
- `src/checkout/composable/EPCheckoutProvider.tsx` — client-side state machine, 9 refActions, `checkoutData` DataProvider
- `src/checkout/composable/CheckoutContext.tsx` — Stripe bridge context (Symbol.for singleton)
- `src/checkout/composable/EPCheckoutButton.tsx` — step-aware button with `checkoutButtonData` DataProvider
- `src/checkout/composable/EPCheckoutStepIndicator.tsx` — 4-step repeater with `currentStep` DataProvider
- `src/checkout/composable/EPPaymentElements.tsx` — Stripe Elements wrapper with `paymentData` DataProvider

### Existing Code That Will Be Modified (Phase D)
- `src/checkout/composable/EPOrderTotalsBreakdown.tsx` — currently reads `checkoutData.summary` or `checkoutCartData`; must adapt to `checkoutSession.totals`
- `src/checkout/composable/EPShippingMethodSelector.tsx` — currently self-fetches rates from `/api/checkout/calculate-shipping`; must read `checkoutSession.availableShippingRates` and call `updateSession()`
- `src/checkout/composable/index.ts` — remove deleted exports, add session exports
- `src/registerCheckout.tsx` — remove deleted registrations, add session component registrations

### Existing Code That Survives Unchanged
- `src/checkout/composable/EPCustomerInfoFields.tsx` — manages own state, falls back gracefully when `checkoutData` absent
- `src/checkout/composable/EPShippingAddressFields.tsx` — same pattern
- `src/checkout/composable/EPBillingAddressFields.tsx` — same pattern
- `src/checkout/composable/EPBillingAddressToggle.tsx` — standalone toggle
- `src/checkout/composable/EPCountrySelect.tsx` — standalone select
- `src/checkout/composable/EPCheckoutCartSummary.tsx` — provides `checkoutCartData`, independent of checkout flow
- `src/checkout/composable/EPCheckoutCartItemList.tsx` — reads from `checkoutCartData`
- `src/checkout/composable/EPCheckoutCartField.tsx` — reads from `checkoutCartData`
- `src/checkout/composable/EPPromoCodeInput.tsx` — standalone promo input

### Existing Dependencies Confirmed
- `swr` — already a peerDependency (>=1.0.0), no change needed for Phase A
- `@stripe/stripe-js` + `@stripe/react-stripe-js` — already bundled deps, reusable in Phase C
- `zod` — already a dependency, available for session schema validation
- `js-cookie` — already a dependency, available for cookie operations
- No Clover dependencies exist — Phase B will need Clover types defined manually

### Existing API Patterns (to follow)
- Handler functions are default-exported async functions in `src/api/endpoints/`
- Use `APIResponse<T>` pattern from `src/api/utils/api-helpers.ts`
- Validation via `src/api/utils/validation.ts` — **note:** `validateEnvironmentVariables()` only checks Stripe env vars, NOT Clover or session vars (see SG-8)
- Error handling via `src/api/utils/error-handling.ts` (CheckoutError class hierarchy) — **note:** has `StripeError` but no `CloverError` (see SG-7)
- EP SDK calls via `@epcc-sdk/sdks-shopper`
- Cart cookie pattern in `src/shopper-context/server/cart-cookie.ts`

### Known Gaps in Existing Checkout Flow
- **EP confirmPayment never called:** In the existing composable checkout, `EPPaymentElements` calls Stripe's client-side `confirmPayment()` but the EP server-side `confirmPayment()` endpoint is never called afterward. The session model fixes this by design (the confirm handler captures the EP transaction after the gateway confirms).
- **stripe server SDK not in package.json:** `setup-payment.ts` and `confirm-payment.ts` import `stripe` but it's not listed in `package.json` dependencies (see SG-9).

### Clover 3DS Flow (Reference from Storefront — Verified)
- Token: `clover.createToken()` → single-use token
- Charge: `POST /v1/charges` with idempotency key `clover-charge-${orderId}`
- 3DS detection: `threeDsData.status` → `METHOD_FLOW` | `CHALLENGE` | null
- Method: `perform3DSFingerPrinting({ _3DSServerTransId, acsMethodUrl, methodNotificationUrl })` → `executePatch` CustomEvent (detail._3DSStatus) → `finalizeCloverPayment(chargeId, flowStatus)`
- Challenge: `perform3DSChallenge({ messageVersion, acsTransID, acsUrl, threeDSServerTransID })` → `executePatch` CustomEvent → `finalizeCloverPayment(chargeId, flowStatus)`
- Escalation: method → challenge possible (finalize returns status that maps to `requires_challenge`)
- EP capture: `POST /v2/orders/{id}/transactions/{id}/capture` with `custom_reference: chargeId`
- **State machine phases (from CartPayButton):** idle → tokenizing → charging → fingerprinting/challenging → completing → done/error
- **Verified:** `waitForExecutePatch()` in storefront has NO timeout (resolves when event fires). Session model adds 30s timeout (improvement).
- **Verified:** `chargeClover()` signature includes `orderId` as separate param (used in charge description).
- **Verified:** Card declined = HTTP 402 from Clover → error with `code: "card_declined"`.
- **Verified:** `clover3DS-sdk.js` URL = `https://checkout.clover.com/clover3DS/clover3DS-sdk.js`, loaded as singleton promise with `threeDsSdkPromise` module-level variable.
- **Verified:** 3DS SDK exposes `window.clover3DSUtil` with `perform3DSFingerPrinting()` and `perform3DSChallenge()` methods.

---

## Spec Gaps & Decisions

### SG-1: Form Field Pre-Population After Page Refresh
**Gap:** Surviving form components (EPCustomerInfoFields, EPShippingAddressFields, EPBillingAddressFields) read from `checkoutData` DataProvider for initial pre-population. After Phase D deletes EPCheckoutProvider, `checkoutData` won't exist. EPCheckoutSessionProvider exposes `checkoutSession` (different shape).
**Decision:** EPCheckoutSessionProvider should ALSO expose a `checkoutData`-compatible subset for backwards compatibility with surviving form components. Alternatively, form components fall back to empty fields (acceptable for MVP — session stores form data server-side, but page refresh loses local form state until the components are adapted to read from `checkoutSession`).
**Recommendation:** Phase D adds D-4.3 to adapt all 3 form components to also read from `checkoutSession.customerInfo` / `checkoutSession.shippingAddress` / `checkoutSession.billingAddress` when `checkoutData` is absent.

### SG-2: Orphaned Hooks After Phase D
**Gap:** `src/checkout/hooks/use-checkout.tsx` is imported by EPCheckoutProvider (deleted) and legacy components (EPCheckoutForm, EPPaymentForm). `src/checkout/hooks/use-stripe-payment.tsx` is imported by `EPPaymentForm` (legacy) and exported from `src/checkout/index.ts`.
**Decision:** Legacy monolithic components (EPCheckoutForm, EPPaymentForm, EPOrderSummary, EPCheckoutConfirmation) are registered in `registerCheckout.tsx` and are NOT mentioned in Phase D deletion list. They may still be in use. Leave hooks and legacy components untouched for now. Phase D only deletes the composable components listed in the spec.
**Note:** `use-stripe-payment.tsx` is NOT dead code — it's used by the legacy `EPPaymentForm`. It is out of scope for the session model work.

### SG-3: Cookie Encryption
**Gap:** Spec says "encrypted JSON in httpOnly cookie" but no crypto dependency exists.
**Decision:** Use Node.js built-in `crypto` module (AES-256-GCM) for server-side encryption. This is available in all server runtimes (Next.js, Express, etc.). Encryption key from env var `CHECKOUT_SESSION_SECRET`.

### SG-4: Clover SDK Types
**Gap:** No Clover TypeScript package exists as a dependency.
**Decision:** Define Clover types manually in `src/checkout/session/adapters/clover-types.ts`. Clover SDK is loaded via script tag at runtime (not npm package). 3DS SDK loaded lazily.

### SG-5: Server-Side Stripe Import
**Gap:** Spec says "Stripe (server-side) imported only in the adapter (not bundled client-side)". The `stripe` npm package (server-side) is NOT currently a dependency — only `@stripe/stripe-js` (client-side) and `@stripe/react-stripe-js` are.
**Decision:** Phase C must add `stripe` (server-side) as a dependency for the adapter. Use dynamic import or conditional require to avoid client-side bundling.

### SG-6: Request Object Abstraction
**Gap:** Handler functions need a framework-agnostic request/response type. The spec says handlers accept typed request objects but doesn't define the shape. Currently `calculate-shipping.ts` and other existing handlers accept `(req: any, res: any)` (Express/Next.js Pages Router style).
**Decision:** `SessionHandlerContext` in A-1.1 should include a `SessionRequest` type: `{ body: Record<string, unknown>, headers: Record<string, string>, cookies: Record<string, string> }` and handlers should return a `SessionResponse` type: `{ status: number, body: unknown, headers?: Record<string, string> }`. The consumer route files are responsible for translating their framework's req/res into this shape. This avoids coupling handlers to Express, Next.js Pages Router, or App Router.

### SG-7: No CloverError in Error Hierarchy
**Gap:** `src/api/utils/error-handling.ts` has `StripeError` but no `CloverError`. The Clover adapter needs a gateway-specific error type.
**Decision:** The Clover adapter should use `PaymentError` with a `details.gateway: "clover"` field and gateway-specific `details.code` values (e.g., `"card_declined"`, `"authentication_failed"`). No need to add a new `CloverError` class — `PaymentError` already covers payment gateway failures. `handleStripeError()` provides a pattern for mapping gateway-specific error shapes to `PaymentError`.

### SG-8: validateEnvironmentVariables() Only Checks Stripe
**Gap:** `src/api/utils/validation.ts` exports `validateEnvironmentVariables()` which hardcodes checks for `EP_CLIENT_ID`, `EP_HOST`, `STRIPE_SECRET_KEY`, and `STRIPE_PUBLISHABLE_KEY`. Session handlers need their own validation that checks `CHECKOUT_SESSION_SECRET` and gateway-specific vars dynamically (based on which adapters are registered).
**Decision:** Session handlers should NOT call the existing `validateEnvironmentVariables()`. Instead, `SessionHandlerContext` should require credentials to be passed explicitly by the consumer route (already the case — EP credentials come from the config). The `CHECKOUT_SESSION_SECRET` env var should be validated in `CookieSessionStore` constructor at boot time. Gateway env vars are validated when adapters are instantiated in the consumer's `checkout-config.ts`.

### SG-9: Existing stripe Server SDK Missing from package.json
**Gap:** `src/api/endpoints/checkout/setup-payment.ts` and `confirm-payment.ts` both import `stripe` (server-side SDK), but `stripe` is not in `package.json` dependencies. This is a pre-existing issue, not introduced by the session model.
**Decision:** Phase C (C-1.1) adds `stripe` to `package.json` which also fixes this existing gap. No separate fix needed.

---

## Items To Implement

### Phase A: Foundation (checkout-session-foundation.md)

All files in `plasmicpkgs/commerce-providers/elastic-path/src/` unless noted otherwise.

#### A-1: Session types and interfaces
- [x] **A-1.1** Create `src/checkout/session/types.ts`
  - `CheckoutSession` interface (status, cartId, cartHash, customerInfo, shippingAddress, billingAddress, selectedShippingRateId, availableShippingRates, totals, payment { gateway, status, clientToken, gatewayMetadata { epTransactionId }, actionData }, order { id }, expiresAt)
  - `CheckoutSessionStatus` type: "open" | "processing" | "complete" | "expired"
  - `PaymentStatus` type: "idle" | "pending" | "requires_action" | "succeeded" | "failed"
  - `PaymentAdapter` interface: `initializePayment(session, gatewayData)` → `{ status, clientToken?, gatewayMetadata?, actionData? }`, `confirmPayment(session, confirmData)` → `{ status, gatewayOrderId?, actionData? }`
  - `PaymentAdapterResult` type: `{ status: "requires_action" | "ready" | "succeeded" | "failed", ... }`
  - `SessionStore` interface: `get(id)`, `set(id, session, ttl)`, `delete(id)`
  - `SessionHandlerContext` type: EP credentials, adapter registry reference, session store
  - `SessionRequest` type: `{ body: Record<string, unknown>, headers: Record<string, string>, cookies: Record<string, string> }` — framework-agnostic input (see SG-6)
  - `SessionResponse` type: `{ status: number, body: unknown, headers?: Record<string, string> }` — framework-agnostic output
  - Request/response types for each handler
  - **No deps.** Foundation for everything.

#### A-2: Session store
- [x] **A-2.1** Create `src/checkout/session/cookie-store.ts`
  - `CookieSessionStore` implementing `SessionStore`
  - Encrypted JSON in httpOnly cookie using Node.js `crypto` (AES-256-GCM)
  - `encrypt(data, secret)` / `decrypt(ciphertext, secret)` helpers
  - Cookie name: `ep_checkout_session`
  - Cookie options: httpOnly, SameSite=Lax, Secure in production, maxAge from TTL
  - `get(id)`: parse cookie from request headers, decrypt, validate expiry
  - `set(id, session, ttl)`: encrypt, build Set-Cookie header
  - `delete(id)`: build clear cookie header
  - **Deps:** A-1.1 (SessionStore interface)

#### A-3: Adapter registry
- [x] **A-3.1** Create `src/checkout/session/adapter-registry.ts`
  - `AdapterRegistry` class or object: `register(name, adapter)`, `getAdapter(name)` → PaymentAdapter | undefined
  - `createAdapterRegistry()` factory function
  - Validation: `getAdapter()` on unknown name returns undefined (handler returns 400)
  - **Deps:** A-1.1 (PaymentAdapter interface)

#### A-4: API route handlers
- [x] **A-4.1** Create `src/api/endpoints/checkout-session/create-session.ts`
  - `handleCreateSession(req, ctx)` — POST
  - Accepts `{ cartId }`, fetches cart from EP, snapshots cart data, computes cartHash
  - Creates `CheckoutSession` with status "open", sets cookie
  - Returns session (excluding server-only fields)
  - **Deps:** A-1.1, A-2.1, A-3.1

- [x] **A-4.2** Create `src/api/endpoints/checkout-session/get-session.ts`
  - `handleGetSession(req, ctx)` — GET
  - Reads session from cookie, validates expiry
  - Returns session or null (expired/missing → null)
  - **Note:** Spec says "reconstructs from EP if needed" — this is NOT needed. Session is ephemeral (cookie-only). If cookie is expired or missing, return null and let the client call `createSession()` again. No EP reconstruction.
  - **Deps:** A-1.1, A-2.1

- [x] **A-4.3** Create `src/api/endpoints/checkout-session/update-session.ts`
  - `handleUpdateSession(req, ctx)` — PATCH
  - Accepts partial session update (customerInfo, shippingAddress, billingAddress, selectedShippingRateId)
  - Merges into existing session, updates cookie
  - Returns updated session
  - Validates session exists and status === "open"
  - **Deps:** A-1.1, A-2.1

- [x] **A-4.4** Create `src/api/endpoints/checkout-session/calculate-shipping.ts`
  - `handleCalculateShipping(req, ctx)` — POST
  - Reads session from cookie, calls EP shipping API with session's shipping address
  - Returns available rates, stores them in session
  - **Note:** Existing `src/api/endpoints/checkout/calculate-shipping.ts` requires `cartId` in the POST body. The session version reads `cartId` from the session cookie instead — no `cartId` in the request body. Reuse shipping rate normalization logic but not the handler structure.
  - **Deps:** A-1.1, A-2.1. Reuse shipping rate normalization from existing `src/api/endpoints/checkout/calculate-shipping.ts`

- [x] **A-4.5** Create `src/api/endpoints/checkout-session/pay.ts`
  - `handlePay(req, ctx)` — POST
  - Accepts `{ gateway, ...gatewayData }` (e.g., `{ gateway: "clover", token: "..." }`)
  - Validates: session status === "open", cart hash matches (re-fetch cart), all required fields present
  - EP checkout sequence: validate hash → checkout cart (address translation camelCase→snake_case) → read tax → authorize payment → call adapter.initializePayment()
  - On adapter "ready": set session status to "processing", return session
  - On adapter "requires_action": set session payment status to "requires_action", store actionData, return session
  - On adapter "failed": return error, session stays "open" for retry
  - Cart hash mismatch: return 409 with refreshed session
  - Double-submit: reject if status !== "open"
  - Store EP order ID and transaction ID in session
  - **Deps:** A-1.1, A-2.1, A-3.1. Most complex handler.

- [x] **A-4.6** Create `src/api/endpoints/checkout-session/confirm.ts`
  - `handleConfirm(req, ctx)` — POST
  - Accepts `{ ...confirmData }` (gateway-specific, e.g., `{ stage: "method", flowStatus: "Y" }` for Clover)
  - Validates: session status === "processing" or payment status === "requires_action"
  - Calls adapter.confirmPayment()
  - On "succeeded": capture EP transaction (POST /v2/orders/{id}/transactions/{id}/capture with gatewayOrderId as custom_reference), set session status "complete"
  - On "requires_action": update actionData, return session (for 3DS escalation)
  - On "failed": reset session status to "open" for retry
  - **Deps:** A-1.1, A-2.1, A-3.1

- [x] **A-4.7** Create `src/api/endpoints/checkout-session/index.ts`
  - Export all 6 handler functions
  - **Deps:** A-4.1 through A-4.6

#### A-5: Address translation utility
- [x] **A-5.1** Create `src/checkout/session/address-utils.ts`
  - `toEPAddress(sessionAddress)` — camelCase to snake_case conversion for EP API
  - `fromEPAddress(epAddress)` — snake_case to camelCase for session
  - Used by pay.ts for EP checkout call
  - **Deps:** A-1.1

#### A-6: Client-side hook
- [x] **A-6.1** Create `src/checkout/session/payment-registration-context.ts`
  - React context (Symbol.for singleton pattern, matching existing BundleContext/CheckoutPaymentContext conventions)
  - `PaymentRegistrationContextValue`: `registerGateway(name, confirmHandler)`, `getRegisteredGateway()` → `{ name, confirm }`
  - `usePaymentRegistration()` hook
  - **Deps:** A-1.1

- [x] **A-6.2** Create `src/checkout/session/use-checkout-session.ts`
  - `useCheckoutSession(apiBaseUrl)` hook
  - SWR-cached fetch from `GET {apiBaseUrl}/checkout/sessions/current`
  - Mutation helpers: `createSession(cartId)`, `updateSession(data)`, `calculateShipping()`, `placeOrder(gatewayData)`, `confirmPayment(confirmData)`, `reset()`
  - Each mutation calls the corresponding API endpoint, then SWR mutate to refresh
  - Returns `{ session, isLoading, error, ...mutationHelpers }`
  - **Deps:** A-1.1, SWR (already peerDep)

#### A-7: Design-time data
- [x] **A-7.1** Create `src/checkout/session/design-time-data.ts`
  - Mock `CheckoutSession` objects for previewStates: auto, collecting, paying, complete
  - Realistic mock data matching the session interface
  - **Deps:** A-1.1

#### A-8: Plasmic provider component
- [x] **A-8.1** Create `src/checkout/session/EPCheckoutSessionProvider.tsx`
  - Props: `children`, `apiBaseUrl` (default "/api"), `previewState` ("auto" | "collecting" | "paying" | "complete")
  - Wraps `useCheckoutSession()` hook
  - DataProvider `"checkoutSession"` exposing session data
  - PaymentRegistrationContext.Provider wrapping children
  - refActions: `createSession()`, `updateSession(data)`, `calculateShipping()`, `placeOrder(shippingRateId?)`, `confirmPayment(gatewayData)`, `reset()`
  - Design-time: returns mock data based on previewState
  - On mount: check cookie → GET to hydrate or wait for `createSession()`
  - `epCheckoutSessionProviderMeta` ComponentMeta with refActions, props, DataProvider
  - `registerEPCheckoutSessionProvider(loader)` function
  - **Deps:** A-6.1, A-6.2, A-7.1

#### A-9: Package exports
- [x] **A-9.1** Create `src/checkout/session/index.ts`
  - Export: EPCheckoutSessionProvider (component, meta, register), useCheckoutSession hook, all types, PaymentRegistrationContext
  - **Deps:** A-8.1, A-6.2, A-6.1, A-1.1

#### A-10: Tests
- [x] **A-10.1** Create `src/checkout/session/__tests__/cookie-store.test.ts` — encrypt/decrypt, get/set/delete, expiry, malformed data
- [x] **A-10.2** Create `src/checkout/session/__tests__/adapter-registry.test.ts` — register/get, unknown adapter
- [x] **A-10.3** Create `src/api/endpoints/checkout-session/__tests__/create-session.test.ts`
- [x] **A-10.4** Create `src/api/endpoints/checkout-session/__tests__/get-session.test.ts`
- [x] **A-10.5** Create `src/api/endpoints/checkout-session/__tests__/update-session.test.ts`
- [x] **A-10.6** Create `src/api/endpoints/checkout-session/__tests__/calculate-shipping.test.ts`
- [x] **A-10.7** Create `src/api/endpoints/checkout-session/__tests__/pay.test.ts` — happy path, cart hash mismatch (409), double-submit, missing fields, unknown gateway, EP failure (502), adapter failure
- [x] **A-10.8** Create `src/api/endpoints/checkout-session/__tests__/confirm.test.ts` — happy path, requires_action escalation, failed → retry, status validation
- [x] **A-10.9** Create `src/checkout/session/__tests__/EPCheckoutSessionProvider.test.tsx` — mount, refActions, DataProvider, previewStates
- [x] **A-10.10** Create `src/checkout/session/__tests__/use-checkout-session.test.ts` — SWR caching, mutation helpers
- [x] **A-10.11** Create `src/checkout/session/__tests__/address-utils.test.ts` — camelCase ↔ snake_case

**Phase A total: 27 items** (16 implementation + 11 tests)

---

### Phase B: Clover Payment Components (checkout-session-clover.md)

#### B-1: Clover adapter (server-side)
- [x] **B-1.1** Create `src/checkout/session/adapters/clover-types.ts`
  - Clover API types: `CloverChargeRequest`, `CloverChargeResponse`, `CloverThreeDsData`, `CloverFinalizeRequest`
  - **No deps beyond A-1.1**

- [x] **B-1.2** Create `src/checkout/session/adapters/clover-api.ts`
  - `chargeClover(token, amount, currency, orderId, idempotencyKey, apiKey, apiBase)` — POST /v1/charges
  - `finalizeCloverPayment(chargeId, flowStatus, apiKey, apiBase)` — POST /v1/charges/finalize_payment
  - `deriveIdempotencyKey(orderId)` — returns `clover-charge-${orderId}`
  - Ported from storefront's `lib/clover-api.ts` but framework-agnostic (no Next.js deps)
  - **Reference implementation:** The storefront's `clover-api.ts` at `/Users/robert.field/Documents/Projects/EP/clover/worktree-alpha/apps/storefront/lib/clover-api.ts` is the exact code to port. Key differences for the package version: accept `apiBase` as an explicit param instead of reading from env var; accept `apiKey` as required (not optional with env fallback).
  - **Signature note:** The storefront version passes `orderId` as a separate parameter (used in the charge description `Online order #${orderId}`). The package version should preserve this: `chargeClover(token, amount, currency, orderId, idempotencyKey, apiKey, apiBase)`.
  - **Deps:** B-1.1

- [x] **B-1.3** Create `src/checkout/session/adapters/clover-adapter.ts`
  - `cloverAdapter` implementing `PaymentAdapter`
  - `initializePayment()`: calls `chargeClover()` with token from gatewayData, idempotency key `clover-charge-${orderId}`
    - Inspects `threeDsData.status`: null → "ready", METHOD_FLOW → "requires_action" with `actionData.type: "3ds_method"`, CHALLENGE → "requires_action" with `actionData.type: "3ds_challenge"`
    - Card declined (402) → "failed" with "Your card was declined"
    - Network error → one retry with same idempotency key
  - `confirmPayment()`: calls `finalizeCloverPayment(chargeId, flowStatus)`
    - Success → "succeeded" with gatewayOrderId = chargeId
    - CHALLENGE escalation → "requires_action" with challenge data
    - AUTHENTICATION_FAILED → "failed"
  - **Deps:** A-1.1 (PaymentAdapter), B-1.2

#### B-2: Clover client components
- [x] **B-2.1** Create `src/checkout/session/clover-context.ts`
  - React context for Clover SDK elements instance
  - `CloverElementsContext` — provides clover instance + elements to child field components
  - `useCloverElements()` hook
  - **Deps:** None (React only)

- [x] **B-2.2** Create `src/checkout/session/clover-singleton.ts`
  - Singleton lazy-loader for the main Clover SDK (card fields + tokenization)
  - `loadCloverSDK(pakmsKey)` → Promise<CloverInstance> — loads `https://checkout.clover.com/sdk.js` via script tag, initializes `new Clover(pakmsKey)`, caches instance
  - Module-level `let cloverSdkPromise: Promise<CloverInstance> | null = null` — resets on error for retry
  - No duplicate script tags (checks `document.querySelector` before injecting)
  - **Deps:** None (browser-only)

- [x] **B-2.2b** Create `src/checkout/session/clover-3ds-sdk.ts`
  - Singleton lazy-loader for `clover3DS-sdk.js` (separate from card SDK)
  - 3DS SDK URL: `https://checkout.clover.com/clover3DS/clover3DS-sdk.js` — loaded as a singleton promise (module-level `let threeDsSdkPromise: Promise<void> | null = null`)
  - `loadClover3DSSDK()` → Promise<void> (loads script tag once, checks `window.clover3DSUtil` existence, resets promise on load error for retry)
  - `waitForExecutePatch(timeout?)` → Promise<string> (listens for CustomEvent `"executePatch"` on window, resolves with `event.detail._3DSStatus`, 30s default timeout with reject on timeout — improvement over storefront reference which has no timeout)
  - Ported from storefront's `CartPayButton.tsx` inline 3DS loader (lines 36-84 of the reference file)
  - **Deps:** None

- [x] **B-2.3** Create `src/checkout/session/EPCloverPayment.tsx`
  - Props: `children` (slot), `pakmsKey`, `merchantId?`, `environment?` ("sandbox" | "production"), `className?`, `previewState?`
  - DataProvider `"cloverPaymentData"`: `{ isReady, isProcessing, error, isTokenizing, is3DSActive }`
  - Registers gateway "clover" with EPCheckoutSessionProvider via PaymentRegistrationContext
  - Registers `confirm` handler: tokenizes card via Clover SDK → returns `{ token }`
  - 3DS state machine: monitors `session.payment.status === "requires_action"` → reads `actionData` → lazy-loads 3DS SDK → handles method/challenge flows → calls `confirmPayment()`
  - Creates Clover SDK elements from `pakmsKey`, provides via CloverElementsContext
  - PreviewStates: auto, ready, processing, error
  - `epCloverPaymentMeta` ComponentMeta
  - `registerEPCloverPayment(loader)` function
  - **Deps:** A-8.1 (EPCheckoutSessionProvider), A-6.1 (PaymentRegistrationContext), B-2.1, B-2.2, B-2.2b

- [x] **B-2.4** Create `src/checkout/session/EPCloverCardNumber.tsx`
  - Reads Clover elements from CloverElementsContext
  - Mounts Clover iframe for CARD_NUMBER
  - Style props: className, placeholder, inputFontFamily, inputFontSize, inputColor, inputPadding, fieldHeight, fieldBorderColor, fieldBorderRadius, errorColor
  - Design-time: static div mimicking input
  - Warning if outside EPCloverPayment
  - **Deps:** B-2.1

- [x] **B-2.5** Create `src/checkout/session/EPCloverCardExpiry.tsx`
  - Same pattern as B-2.4 but CARD_DATE field
  - **Deps:** B-2.1

- [x] **B-2.6** Create `src/checkout/session/EPCloverCardCVV.tsx`
  - Same pattern as B-2.4 but CARD_CVV field
  - **Deps:** B-2.1

- [x] **B-2.7** Create `src/checkout/session/EPCloverCardPostalCode.tsx`
  - Same pattern as B-2.4 but CARD_POSTAL_CODE field
  - **Deps:** B-2.1

#### B-3: Integration
- [x] **B-3.1** Register Clover adapter in adapter registry (export from `src/checkout/session/adapters/index.ts`)
  - **Deps:** B-1.3, A-3.1

- [x] **B-3.2** Register EPCloverPayment + 4 field components in `src/registerCheckout.tsx`
  - **Deps:** B-2.3 through B-2.7

#### B-4: Tests
- [x] **B-4.1** Create `src/checkout/session/__tests__/clover-adapter.test.ts` — charge success, 3DS method, 3DS challenge, escalation, card declined, retry on network error, idempotency key
- [x] **B-4.2** Create `src/checkout/session/__tests__/EPCloverPayment.test.tsx` — SDK init, tokenization, 3DS flow, registration, previewStates, outside-provider warning
- [x] **B-4.3** Create `src/checkout/session/__tests__/EPCloverCardNumber.test.tsx` — mount, style props, outside-context warning

**Phase B total: 16 items** (13 implementation + 3 tests)

---

### Phase C: Stripe Payment Components (checkout-session-stripe.md)

#### C-1: Stripe adapter (server-side)
- [x] **C-1.1** Add `stripe` (server-side SDK) to package.json dependencies
  - **No code deps**

- [x] **C-1.2** Create `src/checkout/session/adapters/stripe-adapter.ts`
  - `stripeAdapter` implementing `PaymentAdapter`
  - `initializePayment()`: creates Stripe PaymentIntent with `automatic_payment_methods: { enabled: true }`, amount from session.totals.total, currency from session.totals.currency, metadata `{ epOrderId }`
    - Returns `status: "ready"`, `clientToken: paymentIntent.client_secret`, `gatewayMetadata: { paymentIntentId }`
  - `confirmPayment()`: retrieves PaymentIntent by ID, checks `status === "succeeded"`
    - Validates metadata `order_id` matches session `order.id`
    - Returns `status: "succeeded"` with `gatewayOrderId: paymentIntentId`
  - Stripe SDK from `STRIPE_SECRET_KEY` env var
  - Dynamic import to avoid client-side bundling
  - **Deps:** A-1.1, C-1.1

#### C-2: Stripe client component
- [x] **C-2.1** Create `src/checkout/session/EPStripePayment.tsx`
  - Props: `children?` (slot), `publishableKey`, `appearance?` (Stripe Elements theme), `layout?` ("tabs" | "accordion"), `className?`, `previewState?`
  - DataProvider `"stripePaymentData"`: `{ isReady, isProcessing, error, paymentMethodType }`
  - Registers gateway "stripe" with EPCheckoutSessionProvider via PaymentRegistrationContext
  - Registers `confirm` handler: calls `stripe.confirmPayment({ clientSecret })` → returns `{ paymentIntentId }`
  - Wraps children in `@stripe/react-stripe-js` Elements with `clientSecret` from `session.payment.clientToken` and `appearance`
  - Renders Stripe `PaymentElement` (3DS handled internally by Stripe)
  - Lazy-loads `@stripe/stripe-js` via `loadStripe()` singleton (already in codebase)
  - PreviewStates: auto, ready, processing, error (reuse mock pattern from existing EPPaymentElements)
  - `epStripePaymentMeta` ComponentMeta
  - `registerEPStripePayment(loader)` function
  - **Deps:** A-8.1, A-6.1, existing Stripe deps

#### C-3: Integration
- [x] **C-3.1** Register Stripe adapter in adapter registry (export from `src/checkout/session/adapters/index.ts`)
  - **Deps:** C-1.2, A-3.1

- [x] **C-3.2** Register EPStripePayment in `src/registerCheckout.tsx`
  - **Deps:** C-2.1

- [x] **C-3.3** Verify `@stripe/stripe-js` and `@stripe/react-stripe-js` in peerDependencies (they're currently in dependencies — may move to peerDependencies if Phase D removes the old EPPaymentElements that bundled them)
  - **Deps:** C-2.1

#### C-4: Tests
- [x] **C-4.1** Create `src/checkout/session/__tests__/stripe-adapter.test.ts` — PaymentIntent creation, confirmation, metadata validation, missing API key
- [x] **C-4.2** Create `src/checkout/session/__tests__/EPStripePayment.test.tsx` — SDK lazy-load, Elements mount, registration, confirm handler, previewStates

**Phase C total: 8 items** (6 implementation + 2 tests)

---

### Phase D: Production Hardening (checkout-session-hardening.md)

#### D-1: Cart hash utility
- [x] **D-1.1** Create `src/checkout/session/cart-hash.ts`
  - `hashCart(cart)` — deterministic hash from sorted item IDs + quantities + prices
  - Uses Node.js `crypto.createHash('sha256')`
  - Sort items by ID before hashing for determinism
  - **No deps beyond Node.js crypto**

#### D-2: Hardening in existing handlers
- [x] **D-2.1** Verified `pay.ts` handler: cart hash validation (re-fetch cart, compare hash, 409 on mismatch with refreshed session) — implemented in Phase A, dedicated test in pay.test.ts "cart hash mismatch" suite
  - **Deps:** D-1.1, A-4.5

- [x] **D-2.2** Verified `pay.ts` handler: double-submit protection (reject if `session.status !== "open"`) — implemented in Phase A, dedicated test in pay.test.ts "guard: double-submit protection" suite
  - **Deps:** A-4.5

- [x] **D-2.3** Verified `confirm.ts` handler: status validation (reject if `session.status !== "processing"`) — implemented in Phase A, dedicated test in confirm.test.ts
  - **Deps:** A-4.6

- [x] **D-2.4** Verified `cookie-store.ts`: enforce `expiresAt` field check server-side, return null for expired sessions — implemented in Phase A, dedicated test in cookie-store.test.ts
  - **Deps:** A-2.1

- [x] **D-2.5** Verified handlers: return 410 Gone for expired sessions on PATCH/pay/confirm — all handlers return SESSION_GONE for null session (from expired cookie)
  - **Deps:** A-4.3, A-4.5, A-4.6

- [x] **D-2.6** Verified `pay.ts` and adapter flow: payment retry — failed adapter result keeps session "open" (pay.test.ts), failed confirm resets to "open" (confirm.test.ts)
  - **Deps:** A-4.5, A-4.6

**Note:** All D-2.x safety measures were implemented in Phase A. D-2.x was verify-and-test-only — confirmed all safety checks have dedicated test coverage.

#### D-3: Old component cleanup
- [x] **D-3.1** Deleted `src/checkout/composable/EPCheckoutProvider.tsx` and `__tests__/EPCheckoutProvider.test.tsx`
- [x] **D-3.2** Deleted `src/checkout/composable/EPCheckoutButton.tsx` and `__tests__/EPCheckoutButton.test.tsx`
- [x] **D-3.3** Deleted `src/checkout/composable/EPCheckoutStepIndicator.tsx` and `__tests__/EPCheckoutStepIndicator.test.tsx`
- [x] **D-3.4** Deleted `src/checkout/composable/EPPaymentElements.tsx` and `__tests__/EPPaymentElements.test.tsx`
- [x] **D-3.5** Deleted `src/checkout/composable/CheckoutContext.tsx`

#### D-4: Component adaptations
- [x] **D-4.1** Modified `EPOrderTotalsBreakdown.tsx`: reads from `checkoutSession.session.totals` DataProvider, formats cents→currency via `Intl.NumberFormat`, takes priority over `checkoutCartData`
  - **Deps:** A-8.1

- [x] **D-4.2** Modified `EPShippingMethodSelector.tsx`: reads `availableShippingRates` from `checkoutSession` DataProvider when available (skips legacy fetch), `selectMethod(rateId)` calls `updateSession({ selectedShippingRateId })` in session mode
  - Also modified `EPCheckoutSessionProvider.tsx`: DataProvider now exposes `updateSession` and `calculateShipping` callbacks alongside session data
  - **Deps:** A-8.1

- [x] **D-4.3** Form field compatibility: adapted EPCustomerInfoFields (splits session `name` into firstName/lastName), EPShippingAddressFields, EPBillingAddressFields to read initial values from `checkoutSession.session.customerInfo` / `.shippingAddress` / `.billingAddress`
  - **Deps:** A-8.1, D-3.1

#### D-5: Registration cleanup
- [x] **D-5.1** Updated `src/checkout/composable/index.ts`: removed EPCheckoutProvider, EPCheckoutButton, EPCheckoutStepIndicator, EPPaymentElements, CheckoutContext exports
- [x] **D-5.2** Updated `src/registerCheckout.tsx`: removed registrations/exports for 5 deleted components
- [x] **D-5.3** Build verified (tsdx build passes)
- [x] **D-5.4** All 291 tests pass across 19 suites

#### D-6: Tests
- [x] **D-6.1** Create `src/checkout/session/__tests__/cart-hash.test.ts` — determinism (same items different order → same hash), different quantities → different hash, empty cart
- [x] **D-6.2** Updated EPOrderTotalsBreakdown.test.tsx and EPShippingMethodSelector.test.tsx with session-mode tests (mock useSelector pattern: controllable mock fakes for @plasmicapp/host)

**Phase D total: 21 items** (19 implementation + 2 tests)

---

### Phase Consumer: Consumer Route Files (checkout-session-consumer-routes.md)

All files in `/Users/robert.field/Documents/Projects/EP/clover/worktree-alpha/apps/storefront/` (Pages Router).

#### Consumer-1: Adapter config
- [ ] **Consumer-1.1** Create `lib/checkout-config.ts`
  - Import `createAdapterRegistry` from package
  - Import Clover adapter (and optionally Stripe adapter)
  - Register adapters with credentials from env vars
  - Export configured registry
  - EP credentials from `EP_CLIENT_ID`, `EP_CLIENT_SECRET`, `EP_API_BASE_URL`
  - Clover credentials from `CLOVER_ECOMMERCE_API_KEY`, `CLOVER_API_BASE_URL`
  - **Deps:** A-3.1, B-1.3

#### Consumer-2: Route files (Pages Router)
- [ ] **Consumer-2.1** Create `pages/api/checkout/sessions/index.ts`
  - POST → `handleCreateSession(req, ctx)` with configured registry + store
  - **Deps:** A-4.1, Consumer-1.1

- [ ] **Consumer-2.2** Create `pages/api/checkout/sessions/current.ts`
  - GET → `handleGetSession(req, ctx)`
  - PATCH → `handleUpdateSession(req, ctx)`
  - **Deps:** A-4.2, A-4.3, Consumer-1.1

- [ ] **Consumer-2.3** Create `pages/api/checkout/sessions/current/shipping.ts`
  - POST → `handleCalculateShipping(req, ctx)`
  - **Deps:** A-4.4, Consumer-1.1

- [ ] **Consumer-2.4** Create `pages/api/checkout/sessions/current/pay.ts`
  - POST → `handlePay(req, ctx)`
  - **Deps:** A-4.5, Consumer-1.1

- [ ] **Consumer-2.5** Create `pages/api/checkout/sessions/current/confirm.ts`
  - POST → `handleConfirm(req, ctx)`
  - **Deps:** A-4.6, Consumer-1.1

**Phase Consumer total: 6 items**

---

## Dependency Graph (Critical Path)

```
A-1.1 (types) ─────────────────────────────────┐
  ├─► A-2.1 (cookie-store)                      │
  ├─► A-3.1 (adapter-registry)                  │
  ├─► A-5.1 (address-utils)                     │
  ├─► A-6.1 (payment-registration-context)      │
  ├─► A-7.1 (design-time-data)                  │
  └─► A-4.1..A-4.7 (handlers) ─► A-4.7 (index) │
       │                                         │
       └─► A-6.2 (use-checkout-session) ──────┐ │
            └─► A-8.1 (EPCheckoutSessionProv) │ │
                 └─► A-9.1 (session/index)    │ │
                                               │ │
Phase B (all depend on A-8.1, A-6.1, A-3.1):  │ │
  B-1.1 (clover-types)                        │ │
    └─► B-1.2 (clover-api)                    │ │
         └─► B-1.3 (clover-adapter)           │ │
  B-2.1 (clover-context)                      │ │
  B-2.2 (clover-singleton)                    │ │
  B-2.2b (clover-3ds-sdk)                     │ │
    └─► B-2.3 (EPCloverPayment)               │ │
         └─► B-2.4..B-2.7 (card fields)       │ │
                                               │ │
Phase C (depends on A-8.1, A-6.1, A-3.1):     │ │
  C-1.1 (stripe dep)                          │ │
    └─► C-1.2 (stripe-adapter)                │ │
  C-2.1 (EPStripePayment)                     │ │
                                               │ │
Phase D (depends on A, B, C complete):         │ │
  D-1.1 (cart-hash)                           │ │
  D-2.x (handler hardening)                   │ │
  D-3.x (delete old components)               │ │
  D-4.x (adapt surviving components)          │ │
  D-5.x (registration cleanup)               │ │
                                               │ │
Consumer (depends on A handlers + B adapter):  │ │
  Consumer-1.1 (checkout-config)               │ │
  Consumer-2.x (route files)                   │ │
```

## Build Order Summary

| Step | Items | Can Parallelize With |
|------|-------|---------------------|
| 1 | A-1.1 | — |
| 2 | A-2.1, A-3.1, A-5.1, A-6.1, A-7.1 | All parallel |
| 3 | A-4.1 through A-4.7 | All parallel (share deps from step 2) |
| 4 | A-6.2 | — |
| 5 | A-8.1 | — |
| 6 | A-9.1, A-10.x (tests) | Parallel |
| 7 | B-1.1, B-2.1, B-2.2, B-2.2b | All parallel |
| 8 | B-1.2 | — |
| 9 | B-1.3, B-2.3 | Parallel |
| 10 | B-2.4..B-2.7, B-3.x, B-4.x | Parallel |
| 11 | C-1.1, C-1.2 | Parallel with B |
| 12 | C-2.1, C-3.x, C-4.x | Parallel |
| 13 | D-1.1, D-2.x, D-3.x, D-4.x, D-5.x, D-6.x | Sequential (deletions are sensitive) |
| 14 | Consumer-1.1, Consumer-2.x | After A + B |
