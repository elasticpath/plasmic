# Implementation Plan

**Last updated:** 2026-03-09
**Branch:** `feat/server-cart-shopper-context`
**Focus:** Server-only cart architecture with ShopperContext for Elastic Path commerce in Plasmic

## Status Summary

| Category | Count |
|----------|-------|
| Active specs (server-cart) | 5 |
| Deferred specs | 1 (`composable-checkout.md` — build after server-cart phases) |
| Completed specs | 8 (product discovery + MCP) |
| Total items to implement | 16 |
| Completed items | 0 |

## Active Spec Status

| Spec | Phase | Priority | Status |
|------|-------|----------|--------|
| `server-cart-architecture.md` | Overview | — | Reference doc (no items) |
| `phase-0-shopper-context.md` | Phase 0 | P0 | **TO DO** (0/9 items) |
| `phase-1-cart-reads.md` | Phase 1 | P1 | **TO DO** (0/5 items) |
| `phase-2-cart-mutations.md` | Phase 2 | P2 | **TO DO** (0/4 items) |
| `phase-3-credential-removal.md` | Phase 3 | P3 | **TO DO** (0/5 items) |

## Deferred Specs

| Spec | Reason |
|------|--------|
| `composable-checkout.md` | Checkout UI components — build after server-cart architecture is complete |

---

## Items To Implement (Prioritized)

### Phase 0: ShopperContext Foundation (P0) — 9 Items

- [ ] **P0-1: ShopperContext component** — `src/shopper-context/ShopperContext.tsx`
  - GlobalContext providing override channel for cart identity
  - Symbol.for singleton pattern (matching BundleContext.tsx, CartDrawerContext.tsx)
  - Props: cartId, accountId, locale, currency
  - Tests: renders children, provides overrides, empty when no props

- [ ] **P0-2: useShopperContext hook** — `src/shopper-context/useShopperContext.ts`
  - Hook to read current ShopperContext overrides
  - Returns {} when no provider above

- [ ] **P0-3: useShopperFetch hook** — `src/shopper-context/useShopperFetch.ts`
  - Fetch wrapper that attaches X-Shopper-Context header when overrides present
  - Omits header when no overrides (production browsing)
  - Tests: header attached/omitted correctly

- [ ] **P0-4: Server resolve-cart-id** — `src/shopper-context/server/resolve-cart-id.ts`
  - parseShopperHeader() + resolveCartId() — header > cookie > null
  - Framework-agnostic (works with any Node.js request)
  - Tests: priority resolution, malformed header handling

- [ ] **P0-5: Server cart-cookie** — `src/shopper-context/server/cart-cookie.ts`
  - buildCartCookieHeader() + buildClearCartCookieHeader()
  - No dependency on `cookie` package — builds string directly
  - Tests: valid httpOnly cookie string, clear cookie string

- [ ] **P0-6: Server barrel** — `src/shopper-context/server/index.ts`
  - Exports from resolve-cart-id.ts and cart-cookie.ts

- [ ] **P0-7: Client barrel** — `src/shopper-context/index.ts`
  - Exports ShopperContext, useShopperContext, useShopperFetch

- [ ] **P0-8: Registration** — `src/shopper-context/registerShopperContext.ts` + `src/index.tsx`
  - Create registerShopperContext.ts with shopperContextMeta and register function
  - Registration name: `plasmic-commerce-ep-shopper-context`
  - Props: cartId (string), accountId (string, advanced), locale (string, advanced), currency (string, advanced)
  - Add import/call in registerAll() in src/index.tsx, after registerCommerceProvider
  - Add `export * from './shopper-context'` to src/index.tsx

- [ ] **P0-9: Constants** — `src/const.ts`
  - Add EP_CART_COOKIE_NAME = 'ep_cart'
  - Add SHOPPER_CONTEXT_HEADER = 'x-shopper-context'

### Phase 1: Cart Read Hooks (P1) — 5 Items

- [ ] **P1-1: useCart hook** — `src/shopper-context/use-cart.ts`
  - SWR hook fetching GET /api/cart via useShopperFetch
  - Cache key includes cartId when present (Studio refetch)
  - Types: CartItem, CartMeta, CartData, UseCartReturn
  - Tests: fetch call, SWR key varies with cartId, error handling

- [ ] **P1-2: useCheckoutCart hook** — `src/shopper-context/use-checkout-cart.ts`
  - Wraps useCart, normalizes to CheckoutCartData (formatted prices, itemCount, currency)
  - Types: CheckoutCartItem, CheckoutCartData
  - Tests: normalization, null handling, formatted prices

- [ ] **P1-3: Design-time mock data** — `src/shopper-context/design-time-data.ts`
  - MOCK_SERVER_CART_DATA: CheckoutCartData with 2 items, realistic prices

- [ ] **P1-4: EPCheckoutCartSummary enhancement** — `src/checkout/composable/EPCheckoutCartSummary.tsx`
  - Add optional `cartData` prop — when provided, skip internal fetch, use external data
  - Non-breaking: existing behavior preserved when prop not provided
  - Tests: external data rendered, internal fetch still works

- [ ] **P1-5: Update barrel exports** — `src/shopper-context/index.ts`
  - Add useCart, useCheckoutCart, design-time data exports

### Phase 2: Cart Mutation Hooks (P2) — 4 Items

- [ ] **P2-1: useAddItem hook** — `src/shopper-context/use-add-item.ts`
  - POST /api/cart/items via useShopperFetch, mutate() after
  - AddItemInput type: productId, variantId?, quantity?, bundleConfiguration?, locationId?, selectedOptions?
  - Tests: POST call, body shape, mutate called

- [ ] **P2-2: useRemoveItem hook** — `src/shopper-context/use-remove-item.ts`
  - DELETE /api/cart/items/{id} via useShopperFetch, mutate() after
  - URL-encodes itemId
  - Tests: DELETE call, mutate called

- [ ] **P2-3: useUpdateItem hook** — `src/shopper-context/use-update-item.ts`
  - PUT /api/cart/items/{id} via useShopperFetch, debounced at DEFAULT_DEBOUNCE_MS (500ms)
  - Tests: PUT call, debounce behavior, mutate called after debounce

- [ ] **P2-4: Update barrel exports** — `src/shopper-context/index.ts`
  - Add useAddItem, useRemoveItem, useUpdateItem exports

### Phase 3: Credential Removal (P3) — 5 Items

- [ ] **P3-1: Deprecate old cart hooks** — `src/cart/*.tsx`
  - Add @deprecated JSDoc to use-cart.tsx, use-add-item.tsx, use-remove-item.tsx, use-update-item.tsx
  - Add @deprecated to src/utils/cart-cookie.ts (getCartId, setCartId, removeCartCookie)

- [ ] **P3-2: CommerceProvider serverCartMode** — `src/registerCommerceProvider.tsx`
  - Add `serverCartMode` boolean prop (advanced, default false)
  - When true + no clientId: skip EP SDK init, render children only
  - Existing behavior unchanged when false

- [ ] **P3-3: EPPromoCodeInput server mode** — `src/checkout/composable/EPPromoCodeInput.tsx`
  - Add `useServerRoutes` boolean prop
  - When true: apply promo via POST /api/cart/promo, remove via DELETE /api/cart/promo
  - Existing behavior unchanged when false

- [ ] **P3-4: Audit and document** — Review all getEPClient() / useCommerce() usage for cart operations
  - Confirm all cart paths have server-route alternatives
  - Document remaining client-side EP usage (product/search hooks — intentionally kept)

- [ ] **P3-5: CartActionsProvider review** — Check if global actions (addToCart) need updating
  - If used in Plasmic interactions, ensure they work with server-cart hooks
  - May need ServerCartActionsProvider or modification to existing one

---

## Implementation Order

Build strictly in phase order. Within each phase, build in item order.

```
Phase 0 (P0-1 → P0-9) — ShopperContext foundation
  ↓
Phase 1 (P1-1 → P1-5) — Cart read hooks
  ↓
Phase 2 (P2-1 → P2-4) — Cart mutation hooks
  ↓
Phase 3 (P3-1 → P3-5) — Credential removal + deprecation
```

**Start here → P0-1** (ShopperContext component). The `src/shopper-context/` directory does not exist yet.

---

## New Files Summary (12 new files)

```
src/shopper-context/              ← DOES NOT EXIST YET
  index.ts                          — barrel exports (Phase 0, updated in P1/P2)
  ShopperContext.tsx                 — GlobalContext component (Phase 0)
  useShopperContext.ts              — context hook (Phase 0)
  useShopperFetch.ts               — fetch wrapper (Phase 0)
  registerShopperContext.ts        — Plasmic registration (Phase 0)
  use-cart.ts                       — SWR cart hook (Phase 1)
  use-checkout-cart.ts             — normalized checkout cart (Phase 1)
  design-time-data.ts              — mock data (Phase 1)
  use-add-item.ts                  — add mutation (Phase 2)
  use-remove-item.ts               — remove mutation (Phase 2)
  use-update-item.ts               — update mutation (Phase 2)
  server/
    index.ts                        — server barrel (Phase 0)
    resolve-cart-id.ts             — header/cookie resolution (Phase 0)
    cart-cookie.ts                 — httpOnly cookie builder (Phase 0)
```

## Existing Files to Modify (7 files — minimal changes)

| File | Change | Phase |
|------|--------|-------|
| `src/const.ts` | Add 2 constants | 0 |
| `src/index.tsx` | Register ShopperContext GlobalContext | 0 |
| `src/checkout/composable/EPCheckoutCartSummary.tsx` | Add optional `cartData` prop | 1 |
| `src/cart/use-cart.tsx` | Add @deprecated JSDoc | 3 |
| `src/cart/use-add-item.tsx` | Add @deprecated JSDoc | 3 |
| `src/cart/use-remove-item.tsx` | Add @deprecated JSDoc | 3 |
| `src/cart/use-update-item.tsx` | Add @deprecated JSDoc | 3 |
| `src/utils/cart-cookie.ts` | Add @deprecated JSDoc | 3 |
| `src/registerCommerceProvider.tsx` | Add `serverCartMode` prop | 3 |
| `src/checkout/composable/EPPromoCodeInput.tsx` | Add `useServerRoutes` prop | 3 |

---

## Completed Specs (Reference)

### Product Discovery (Phases 1-3) — 22 Items — ALL COMPLETE
- See git history for implementation details
- Components: EPProductListProvider, EPProductGrid, EPCatalogSearchProvider, EPSearchBox, EPSearchHits, etc.

### MCP Server (Gaps #33-39) — 5 Specs — ALL COMPLETE
- Batch architecture, element styling, interaction improvements, toggle variant state, visibility API

---

## Cross-Cutting Concerns

### Upstream Merge Strategy
- All new code in `src/shopper-context/` (new directory) — zero merge conflict risk
- Phase 3 modifications to existing files are minimal (@deprecated JSDoc, additive props)

### Dependencies
- **Phase 0:** Zero new npm dependencies — React context only
- **Phase 1-2:** Add `swr` as peerDependency (>=1.0.0) — NOT currently in package.json, comes indirectly via @plasmicpkgs/commerce
- **Phase 3:** Zero new dependencies

### Test Infrastructure
- Framework: Jest 29.7.0 with esbuild, jsdom environment
- Test locations: `src/shopper-context/__tests__/`, `src/shopper-context/server/__tests__/`
- Pattern: `@jest-environment jsdom` pragma for client tests, default for server tests
