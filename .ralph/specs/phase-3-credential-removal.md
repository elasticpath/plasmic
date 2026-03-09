# Phase 3: Remove Client-Side EP Credentials for Cart

## Status: Ready to Build
## Date: 2026-03-09
## Depends on: Phase 2 (all cart operations via server routes)
## Unblocks: Full server-only security posture for cart operations

---

## Goal

Update the package so that consumers using the server-cart architecture don't expose EP credentials in the browser for cart operations. After this phase:
- CommerceProvider is stubbed (Option B: thin shell, no credentials needed for cart)
- Old client-side cart hooks are deprecated in favor of `src/shopper-context/` hooks
- `js-cookie` usage for cart identity is deprecated (httpOnly cookie managed server-side)
- Product/search hooks remain client-side (public data, acceptable risk)

---

## Deliverables

### D1: Audit Client-Side EP API Usage for Cart

Search `src/` for these patterns and classify:

| Pattern | File(s) | After Phase 2 | Action |
|---------|---------|---------------|--------|
| `getCartId()` / `setCartId()` | `src/utils/cart-cookie.ts`, `src/cart/*` | Replaced by server hooks | Deprecate |
| `removeCartCookie()` | `src/utils/cart-cookie.ts` | Replaced by server clear | Deprecate |
| `getEPClient(provider)` in cart hooks | `src/cart/*` | Not needed for cart | No cart usage |
| `useCommerce()` in cart hooks | `src/cart/*` | Not needed for cart | No cart usage |
| `getEPClient(provider)` in product hooks | `src/product/*` | Still needed (public reads) | Keep |
| `getEPClient(provider)` in checkout composables | `src/checkout/composable/*` | Partially migrated | Review |

---

### D2: Deprecation Markers

Add `@deprecated` JSDoc to old cart hooks and cookie utilities:

```typescript
// src/utils/cart-cookie.ts
/** @deprecated Use server-side httpOnly cookie via shopper-context/server/cart-cookie.ts instead */
export const getCartId = () => ...

/** @deprecated Use server-side httpOnly cookie via shopper-context/server/cart-cookie.ts instead */
export const setCartId = (id: string) => ...
```

```typescript
// src/cart/use-cart.tsx
/** @deprecated Use useCart from shopper-context/use-cart.ts for server-route-based cart reads */
```

Similarly for `src/cart/use-add-item.tsx`, `use-remove-item.tsx`, `use-update-item.tsx`.

---

### D3: CommerceProvider — Option B (Thin Shell)

Don't remove the CommerceProvider GlobalContext (would break existing Plasmic pages). Instead, make it work without credentials when consumer uses server-cart architecture:

**Approach:** Add a `serverCartMode` boolean prop. When true, the provider skips EP SDK initialization and renders children only. Cart hooks from `src/shopper-context/` work independently of the provider.

```typescript
// In registerCommerceProvider.tsx, add prop:
serverCartMode: {
  type: 'boolean',
  displayName: 'Server Cart Mode',
  description: 'When enabled, cart operations use server routes instead of client-side EP SDK. Client ID is not required for cart operations.',
  advanced: true,
  defaultValue: false,
},
```

When `serverCartMode` is true and `clientId` is empty, the provider renders children without initializing the EP SDK client. Product hooks won't work in this mode (by design — they need the client). Cart hooks from `src/shopper-context/` work regardless.

---

### D4: Product/Search Hook Decision

**Recommendation: Leave as-is for Phase 3.**

Product and search hooks (`useProduct`, `useSearch`, `useCategories`) call EP API from the browser using the SDK client. This is acceptable because:
- Product data is public
- The EP implicit auth flow uses `client_id` only (no secret)
- Server-migrating product reads is a separate concern (future phase)

**Exception:** If the consumer's EP configuration uses `client_credentials` grant (with secret) for ALL operations, product hooks need migration too. Document this as a known limitation.

---

### D5: EPPromoCodeInput Migration

`src/checkout/composable/EPPromoCodeInput.tsx` currently calls EP API directly (via `manageCarts()` and `deleteAPromotionViaPromotionCode()`). Add an optional `useServerRoutes` prop:

When `useServerRoutes` is true:
- Apply promo: POST `/api/cart/promo` with `{ code }` via useShopperFetch
- Remove promo: DELETE `/api/cart/promo` with `{ promoItemId }` via useShopperFetch

When false (default): existing behavior unchanged.

---

## File Changes Summary

| File | Action |
|------|--------|
| `src/utils/cart-cookie.ts` | **Edit** — add @deprecated JSDoc |
| `src/cart/use-cart.tsx` | **Edit** — add @deprecated JSDoc |
| `src/cart/use-add-item.tsx` | **Edit** — add @deprecated JSDoc |
| `src/cart/use-remove-item.tsx` | **Edit** — add @deprecated JSDoc |
| `src/cart/use-update-item.tsx` | **Edit** — add @deprecated JSDoc |
| `src/registerCommerceProvider.tsx` | **Edit** — add `serverCartMode` prop |
| `src/checkout/composable/EPPromoCodeInput.tsx` | **Edit** — add `useServerRoutes` prop |

---

## Acceptance Criteria

1. **Old cart hooks have @deprecated markers** — IDE shows deprecation warnings
2. **CommerceProvider works with `serverCartMode: true`** — renders children without EP client
3. **CommerceProvider works without `serverCartMode`** — existing behavior unchanged (backward compat)
4. **EPPromoCodeInput with `useServerRoutes`** — promo code operations go through /api/cart/promo
5. **Product pages still work** — useProduct, useSearch, useCategories unaffected
6. **No breaking changes** — existing consumers see no regression
7. **Build passes** with no type errors
8. **Tests pass**

---

## Risks

1. **Breaking existing Plasmic pages** — Mitigated by Option B (thin shell, not removal)
2. **Product hooks dependency on CommerceProvider** — Product hooks still need the provider with `clientId` when not in `serverCartMode`. Document this clearly.
3. **CartActionsProvider** — If Plasmic global actions (addToCart) are used in interactions, they need to work with server-cart hooks. May need a parallel `ServerCartActionsProvider` or modification to existing one.
4. **EPPromoCodeInput server mode** — Needs useShopperFetch imported internally, which requires ShopperContext above it in the tree.

---

## Tests

- `src/registerCommerceProvider.test.tsx` — serverCartMode renders children without client
- `src/checkout/composable/__tests__/EPPromoCodeInput.test.tsx` — useServerRoutes mode calls /api/cart/promo
