# Checkout Session — Production Hardening

> Phase D. Cart hash validation, double-submit protection, session expiry, and cleanup of old orchestration components.

## Jobs to Be Done

- As a **storefront developer**, I want checkout to be resilient against cart drift, double submissions, and expired sessions
- As a **codebase maintainer**, I want the old orchestration components removed so there's one clear checkout path

## Acceptance Criteria

### Production Safety

- [ ] Cart hash validation: `/pay` handler re-fetches cart, compares hash, returns 409 with refreshed session if changed
- [ ] `hashCart()` utility: deterministic hash from sorted item IDs + quantities + prices
- [ ] Double-submit protection: `/pay` rejects if `session.status !== "open"`, `/confirm` rejects if `session.status !== "processing"`
- [ ] Session expiry: cookie `maxAge` set to 30 minutes, `expiresAt` field checked server-side
- [ ] Expired session handling: GET returns null, PATCH/pay/confirm return 410 Gone
- [ ] Payment retry: if gateway charge fails, session status resets to "open" so `placeOrder()` can be called again
- [ ] EP order retry: re-authorize on the same EP order (don't create a duplicate order)
- [ ] Idempotency: Clover charges use `clover-charge-${orderId}` key, Stripe PaymentIntents are naturally idempotent

### Old Component Cleanup

- [ ] Delete `src/checkout/composable/EPCheckoutProvider.tsx` and test
- [ ] Delete `src/checkout/composable/EPCheckoutButton.tsx` and test
- [ ] Delete `src/checkout/composable/EPCheckoutStepIndicator.tsx` and test
- [ ] Delete `src/checkout/composable/EPPaymentElements.tsx` and test
- [ ] Delete `src/checkout/composable/CheckoutContext.tsx` (useCheckout hook)
- [ ] Remove registrations for deleted components from `src/registerCheckout.tsx`
- [ ] Remove deleted component exports from `src/checkout/composable/index.ts`
- [ ] Verify remaining components (EPCustomerInfoFields, EPShippingAddressFields, EPBillingAddressFields, EPBillingAddressToggle, EPCountrySelect, EPCheckoutCartSummary, EPCheckoutCartItemList, EPCheckoutCartField, EPOrderTotalsBreakdown, EPPromoCodeInput, EPShippingMethodSelector) still build and pass tests

### Component Adaptations

- [ ] EPOrderTotalsBreakdown: read from `checkoutSession.totals` DataProvider (was `checkoutData.summary`)
- [ ] EPShippingMethodSelector: read `availableShippingRates` from `checkoutSession` DataProvider (was self-fetching)
- [ ] EPShippingMethodSelector refAction `selectMethod(rateId)` calls `updateSession({ selectedShippingRateId })`

## Happy Path

1. All safety checks are transparent — shopper never sees them unless something goes wrong
2. Cart hash validates silently on every `/pay` call
3. Double-clicks on "Place Order" are silently rejected after the first
4. Session expires after 30 minutes of inactivity — shopper prompted to restart
5. Payment retry works seamlessly — same EP order, new charge attempt

## Edge Cases

| Scenario | Expected Behaviour |
|----------|-------------------|
| Cart item removed in another tab during checkout | `/pay` returns 409, client shows "Your cart was updated" with refreshed totals |
| Cart item price changed (sale ended) during checkout | Same as above — hash mismatch detected |
| Session cookie expires while filling form | Next server call returns 410, provider resets and prompts new session |
| Network disconnect during `/pay` | Client retries — idempotency keys prevent double-charge |
| Gateway charge fails, user clicks "Try Again" | Session status reset to "open", new charge attempt on same EP order |
| Second charge attempt also fails | Same flow — unlimited retries allowed (gateway handles velocity limits) |
| Old component referenced in existing Plasmic project | Component not found in registry — Plasmic shows "unknown component" placeholder |

## File Targets

| File | Type | Purpose |
|------|------|---------|
| `src/checkout/session/cart-hash.ts` | New | hashCart() utility |
| `src/checkout/session/__tests__/cart-hash.test.ts` | New | Hash determinism tests |
| `src/checkout/composable/EPCheckoutProvider.tsx` | Delete | Old orchestration |
| `src/checkout/composable/EPCheckoutButton.tsx` | Delete | Old orchestration |
| `src/checkout/composable/EPCheckoutStepIndicator.tsx` | Delete | Old orchestration |
| `src/checkout/composable/EPPaymentElements.tsx` | Delete | Old orchestration |
| `src/checkout/composable/CheckoutContext.tsx` | Delete | Old useCheckout hook |
| `src/checkout/composable/__tests__/EPCheckoutProvider.test.tsx` | Delete | |
| `src/checkout/composable/__tests__/EPCheckoutButton.test.tsx` | Delete | |
| `src/checkout/composable/__tests__/EPCheckoutStepIndicator.test.tsx` | Delete | |
| `src/checkout/composable/__tests__/EPPaymentElements.test.tsx` | Delete | |
| `src/checkout/composable/EPOrderTotalsBreakdown.tsx` | Modify | Read from checkoutSession.totals |
| `src/checkout/composable/EPShippingMethodSelector.tsx` | Modify | Read rates from session, selectMethod calls updateSession |
| `src/checkout/composable/index.ts` | Modify | Remove deleted exports |
| `src/registerCheckout.tsx` | Modify | Remove deleted registrations, add session component registrations |

## Out of Scope

- Vercel KV session store upgrade
- EP Custom API background sync for abandoned checkout analytics
- Debounced session sync for single-page UX optimization
- Webhook-based payment confirmation (Stripe/Clover webhooks)
- Order confirmation page components
- Email receipt integration
