# Checkout Session — Clover Payment Components

> Phase B. Clover payment adapter (server-side) and 5 Plasmic components: EPCloverPayment + 4 individual card field components. Includes full 3DS2 support.

## Jobs to Be Done

- As a **Plasmic designer**, I want to drop individual Clover card field components (number, expiry, CVV, postal code) so I have full layout control over payment fields
- As a **storefront developer**, I want a Clover payment adapter that handles tokenization, charging, and 3DS flows through the session model
- As a **shopper**, I want 3D Secure authentication to work seamlessly without leaving the checkout page

## Acceptance Criteria

### Clover Payment Adapter (Server-Side)

- [ ] `cloverAdapter` implements `PaymentAdapter` interface
- [ ] `initializePayment()`: charges Clover with token + idempotency key, inspects `threeDsData.status`
  - No 3DS → returns `status: "ready"` with `chargeId`
  - `METHOD_FLOW` → returns `status: "requires_action"` with `actionData.type: "3ds_method"` + method data
  - `CHALLENGE` → returns `status: "requires_action"` with `actionData.type: "3ds_challenge"` + challenge data
- [ ] `confirmPayment()`: calls `finalizeCloverPayment(chargeId, flowStatus)`
  - Success → returns `status: "succeeded"` with `gatewayOrderId`
  - `CHALLENGE` escalation → returns `status: "requires_action"` with challenge data
  - `AUTHENTICATION_FAILED` → returns `status: "failed"` with error message
- [ ] Idempotency key derived from EP order ID: `clover-charge-${orderId}`
- [ ] Card declined (402 from Clover) surfaced as `status: "failed"` with "Your card was declined"
- [ ] Retry with same idempotency key on network/timeout errors (one retry)

### EPCloverPayment Component

- [ ] Props: `children` (slot), `pakmsKey`, `merchantId?`, `environment?` ("sandbox" | "production"), `className?`, `previewState?`
- [ ] DataProvider `"cloverPaymentData"`: `{ isReady, isProcessing, error, isTokenizing, is3DSActive }`
- [ ] Registers gateway name `"clover"` with EPCheckoutSessionProvider via payment registration context
- [ ] Registers `confirm` handler that tokenizes card and returns `{ token }` for `/pay`
- [ ] Internal 3DS state machine:
  - On `session.payment.status === "requires_action"`, reads `actionData`
  - Lazy-loads `clover3DS-sdk.js` via singleton promise
  - `3ds_method`: calls `perform3DSFingerPrinting()`, waits for `executePatch` CustomEvent, calls `confirmPayment({ stage: "method", flowStatus })`
  - `3ds_challenge`: calls `perform3DSChallenge()`, waits for `executePatch` CustomEvent, calls `confirmPayment({ stage: "challenge", flowStatus })`
- [ ] Creates Clover SDK elements instance from `pakmsKey`
- [ ] Provides Clover elements context to child field components
- [ ] PreviewStates: auto, ready, processing, error — with static mock field rendering
- [ ] Registration metadata with props, DataProvider, slot

### EPCloverCardNumber, EPCloverCardExpiry, EPCloverCardCVV, EPCloverCardPostalCode

- [ ] Each component renders a Clover iframe field via the Clover SDK elements instance
- [ ] Props (shared across all 4): `className?`, `placeholder?`, `inputFontFamily?`, `inputFontSize?`, `inputColor?`, `inputPadding?`, `fieldHeight?`, `fieldBorderColor?`, `fieldBorderRadius?`, `errorColor?`
- [ ] Each reads the Clover elements instance from the parent EPCloverPayment context
- [ ] Style props passed to the iframe at mount time
- [ ] In-editor preview: static div mimicking an input field (not a real iframe)
- [ ] Registration metadata for each with style props exposed

### Integration

- [ ] `EPCloverPayment` + 4 field components registered in `src/index.tsx` via `registerAll()`
- [ ] Clover adapter registered in the adapter registry
- [ ] `clover-singleton.ts` pattern for SDK lazy-loading (no duplicate script tags)
- [ ] 3DS SDK loaded only when `requires_action` is received (not at mount time)

## Happy Path

1. Designer drops `EPCloverPayment` inside `EPCheckoutSessionProvider`, adds 4 card field components as children
2. Clover SDK initializes from `pakmsKey`, card field iframes render
3. Shopper fills in card fields (data stays in Clover iframes — PCI SAQ-A)
4. Shopper clicks "Place Order" → `placeOrder()` fires
5. EPCloverPayment tokenizes card via Clover SDK → receives `cloverToken`
6. Provider sends `{ gateway: "clover", token: cloverToken }` to `/pay`
7. Server: EP checkout → EP authorize → Clover charge with token
8. If no 3DS: charge succeeds, `/pay` returns `status: "processing"`, provider calls `/confirm`, server captures EP transaction
9. If 3DS method: session returns `requires_action`, EPCloverPayment runs fingerprinting, calls `/confirm` with flow status
10. If 3DS challenge (direct or escalated): EPCloverPayment shows challenge, calls `/confirm`
11. Server captures EP transaction, session → "complete"

## Edge Cases

| Scenario | Expected Behaviour |
|----------|-------------------|
| Clover SDK fails to load | `cloverPaymentData.error` set, field components show error state |
| Card tokenization fails | Error surfaced in `cloverPaymentData.error`, Place Order re-enabled |
| 3DS method → challenge escalation | EPCloverPayment handles both stages automatically |
| 3DS AUTHENTICATION_FAILED | Session payment status → "failed", error displayed |
| 3DS SDK fails to load | Error surfaced, payment fails gracefully |
| `executePatch` event never fires (timeout) | 30-second timeout, fail with "Authentication timed out" |
| EPCloverPayment placed outside EPCheckoutSessionProvider | Console warning, component renders children but registration no-ops |
| Clover card field placed outside EPCloverPayment | Console warning, renders placeholder |
| Network error during Clover charge | Retry once with same idempotency key, then fail |
| Card declined | "Your card was declined" error, session remains "open" for retry |

## File Targets

| File | Type | Purpose |
|------|------|---------|
| `src/checkout/session/adapters/clover-adapter.ts` | New | PaymentAdapter implementation for Clover |
| `src/checkout/session/EPCloverPayment.tsx` | New | Parent component — SDK init, tokenization, 3DS |
| `src/checkout/session/EPCloverCardNumber.tsx` | New | Card number iframe field |
| `src/checkout/session/EPCloverCardExpiry.tsx` | New | Expiry iframe field |
| `src/checkout/session/EPCloverCardCVV.tsx` | New | CVV iframe field |
| `src/checkout/session/EPCloverCardPostalCode.tsx` | New | Postal code iframe field |
| `src/checkout/session/clover-context.ts` | New | Internal React context for Clover elements instance |
| `src/checkout/session/clover-3ds-sdk.ts` | New | 3DS SDK lazy-loader (singleton) |
| `src/checkout/session/__tests__/clover-adapter.test.ts` | New | Adapter unit tests |
| `src/checkout/session/__tests__/EPCloverPayment.test.tsx` | New | Component tests |
| `src/checkout/session/__tests__/EPCloverCardNumber.test.tsx` | New | Field component tests |

## Out of Scope

- Clover webhook handling
- Clover refund/void flows
- Clover saved cards / customer vault
- Clover tip/gratuity support
- Multi-tender (split payment across gateways)
