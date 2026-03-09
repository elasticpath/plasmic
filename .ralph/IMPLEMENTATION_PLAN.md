# Implementation Plan

**Last updated:** 2026-03-09
**Last verified against codebase:** 2026-03-09
**Branch:** `feat/server-cart-shopper-context`
**Focus:** Server-only cart architecture with ShopperContext + composable checkout for Elastic Path commerce in Plasmic

## Status Summary

| Category | Count |
|----------|-------|
| Active specs | 6 (server-cart + composable-checkout) |
| Deferred specs | 0 |
| Completed specs | 8 (product discovery + MCP) |
| Total items to implement | 34 (25 server-cart + 9 composable checkout) |
| Completed items | 32 (25 server-cart + 7 composable checkout) |

## Active Spec Status

| Spec | Phase | Priority | Status |
|------|-------|----------|--------|
| `server-cart-architecture.md` | Overview | — | Reference doc (no items) |
| `phase-0-shopper-context.md` | Phase 0 | P0 | **DONE** (9/9 items) |
| `phase-1-cart-reads.md` | Phase 1 | P1 | **DONE** (5/5 items) |
| `phase-2-cart-mutations.md` | Phase 2 | P2 | **DONE** (4/4 items) |
| `phase-3-credential-removal.md` | Phase 3 | P3 | **DONE** (5/5 items) |
| `composable-checkout.md` | Phase 1 (P0) | CC-P0 | **DONE** (4/4 items) |
| `composable-checkout.md` | Phase 2 (P1) | CC-P1 | **DONE** (3/3 items) |

---

## Verified Codebase State (2026-03-09)

- `src/shopper-context/` directory does **NOT exist** — confirmed
- No ShopperContext, useShopperFetch, or server-cart code exists anywhere in the codebase
- `src/const.ts` has no `EP_CART_COOKIE_NAME` or `SHOPPER_CONTEXT_HEADER` constants yet
- `EPCheckoutCartSummary` has NO `cartData` prop — only: children, className, showImages, collapsible, isExpanded, onExpandedChange, previewState
- No `@deprecated` markers exist on any cart hooks or cookie utils
- `swr` IS in `package.json` peerDependencies (added in Phase 1)
- `src/shopper-context/use-cart.ts` exists (Phase 1)
- `src/shopper-context/use-checkout-cart.ts` exists (Phase 1)
- `src/shopper-context/design-time-data.ts` exists (Phase 1)
- Existing cart cookie constant is `ELASTICPATH_CART_COOKIE = 'elasticpath_cart'` (client-side, js-cookie)
- New server-side cookie will use `EP_CART_COOKIE_NAME = 'ep_cart'` (httpOnly, different name)
- `src/shopper-context/use-add-item.ts` exists (Phase 2)
- `src/shopper-context/use-remove-item.ts` exists (Phase 2)
- `src/shopper-context/use-update-item.ts` exists (Phase 2)
- No TODOs, FIXMEs, or placeholders in existing code (except EPPromoCodeInput hardcoded `-$10.00` discount)
- `src/registerCommerceProvider.test.tsx` exists (Phase 3)
- `src/checkout/composable/__tests__/EPPromoCodeInput.test.tsx` exists (Phase 3)
- EPPromoCodeInput refactored to two-component pattern (outer wrapper → EPPromoCodeInputClient | EPPromoCodeInputServer)
- `jest.mock()` confirmed not working for EPPromoCodeInput tests — used global.fetch mocking pattern
- `src/shopper-context/ServerCartActionsProvider.tsx` exists (Phase 3)
- `registerCommerceProvider.tsx` uses `ServerCartActionsProvider` when `serverCartMode=true` (Phase 3)
- All 1027 tests pass across 50 test suites (as of P3-5 completion)
- `src/checkout/composable/EPCheckoutProvider.tsx` exists (CC-P0-1)
- `src/checkout/composable/CheckoutContext.tsx` exists (CC-P0-1)
- `useCheckout()` cartId is optional — server resolves from cookie in server-cart mode
- All 1036 tests pass across 51 test suites (as of CC-P0-1 completion)
- `src/checkout/composable/EPCheckoutStepIndicator.tsx` exists (CC-P0-2)
- `src/checkout/composable/EPCheckoutButton.tsx` exists (CC-P0-3)
- `src/checkout/composable/EPOrderTotalsBreakdown.tsx` exists (CC-P0-4)
- All 1050 tests pass across 54 test suites (as of CC-P0-4 completion)
- `src/checkout/composable/EPCustomerInfoFields.tsx` exists (CC-P1-1)
- `src/checkout/composable/EPShippingAddressFields.tsx` exists (CC-P1-2)
- `src/checkout/composable/EPBillingAddressFields.tsx` exists (CC-P1-3)
- All 1073 tests pass across 57 test suites (as of CC-P1-3 completion)

### Singleton Context Pattern (from BundleContext.tsx)

```typescript
const KEY = Symbol.for("@elasticpath/ep-{name}-context");
function getSingletonContext<T>(key: symbol): React.Context<T | null> {
  const g = globalThis as any;
  if (!g[key]) { g[key] = React.createContext<T | null>(null); }
  return g[key];
}
```

**ShopperContext differs:** Default value is `{}` (not `null`) so hooks work without a provider.

### Test Infrastructure

- Framework: Jest with esbuild transform (root `jest.config.js`)
- Root config matches: `plasmicpkgs/**/*.test.{ts,tsx}` — shopper-context tests will auto-discover
- Client tests need `@jest-environment jsdom` pragma
- Server tests use default (node) environment
- Test locations: `src/shopper-context/__tests__/`, `src/shopper-context/server/__tests__/`

---

## Items To Implement (Prioritized)

### Phase 0: ShopperContext Foundation (P0) — 9 Items

- [x] **P0-1: ShopperContext component** — `src/shopper-context/ShopperContext.tsx`
  - GlobalContext providing override channel for cart identity
  - Symbol.for singleton pattern (matching BundleContext.tsx)
  - Default context value: `{}` (empty overrides = production mode, NOT null)
  - Exports: `ShopperOverrides` interface, `ShopperContextProps`, `getShopperContext()`, `ShopperContext` component
  - Props: cartId, accountId, locale, currency (all optional strings)
  - `useMemo` to avoid re-renders when prop values haven't changed
  - Coerce empty strings to undefined (`cartId || undefined`)
  - Test: `src/shopper-context/__tests__/ShopperContext.test.tsx` — renders children, provides overrides, empty when no props, singleton identity

- [x] **P0-2: useShopperContext hook** — `src/shopper-context/useShopperContext.ts`
  - `useContext(getShopperContext())` — reads current ShopperOverrides
  - Returns `{}` when no provider above (safe default)
  - 5 lines of code, no test file needed (tested via ShopperContext tests)

- [x] **P0-3: useShopperFetch hook** — `src/shopper-context/useShopperFetch.ts`
  - Returns memoized async fetch function via `useCallback`
  - Auto-sets `Content-Type: application/json` if not present
  - Attaches `X-Shopper-Context` header (JSON-encoded overrides) when any override value is non-null
  - Omits header entirely when no overrides (production browsing — cookie-only flow)
  - Uses `credentials: 'same-origin'` for cookie forwarding
  - Throws on non-ok response with response text as message
  - Generic return type: `<T = unknown>(path, init?) => Promise<T>`
  - Test: `src/shopper-context/__tests__/useShopperFetch.test.ts` — header attached when overrides, omitted when empty, error thrown on non-ok

- [x] **P0-4: Server resolve-cart-id** — `src/shopper-context/server/resolve-cart-id.ts`
  - `parseShopperHeader(headers)` — parse X-Shopper-Context JSON from request headers, returns `ShopperHeader` or `{}`
  - `resolveCartId(headers, cookies, cookieName?)` — priority: header.cartId > cookies[cookieName] > null
  - Default cookieName: `'ep_cart'`
  - Framework-agnostic: accepts `Record<string, string | string[] | undefined>` (works with Express, Next.js, etc.)
  - Handles malformed JSON gracefully (returns `{}`)
  - Test: `src/shopper-context/server/__tests__/resolve-cart-id.test.ts` — priority resolution, malformed header, missing header

- [x] **P0-5: Server cart-cookie** — `src/shopper-context/server/cart-cookie.ts`
  - `buildCartCookieHeader(cartId, opts?)` — builds `Set-Cookie` header string
  - `buildClearCartCookieHeader(opts?)` — builds clear cookie header (Max-Age=0)
  - Options: cookieName (default 'ep_cart'), secure (default: NODE_ENV=production), maxAge (default 30 days), path (default '/')
  - Always includes: HttpOnly, SameSite=Lax
  - No `cookie` package dependency — string concatenation
  - Test: `src/shopper-context/server/__tests__/cart-cookie.test.ts` — valid httpOnly string, Secure flag in production, clear cookie

- [x] **P0-6: Server barrel** — `src/shopper-context/server/index.ts`
  - Re-exports: `parseShopperHeader`, `resolveCartId`, `ShopperHeader` from resolve-cart-id
  - Re-exports: `buildCartCookieHeader`, `buildClearCartCookieHeader`, `CartCookieOptions` from cart-cookie

- [x] **P0-7: Client barrel** — `src/shopper-context/index.ts`
  - Exports: `ShopperContext`, `getShopperContext`, `ShopperOverrides`, `ShopperContextProps` from ShopperContext
  - Exports: `useShopperContext` from useShopperContext
  - Exports: `useShopperFetch` from useShopperFetch

- [x] **P0-8: Registration** — `src/shopper-context/registerShopperContext.ts` + `src/index.tsx`
  - Create `registerShopperContext.ts`:
    - `shopperContextMeta`: GlobalContextMeta with name `plasmic-commerce-ep-shopper-context`
    - displayName: "EP Shopper Context"
    - importPath: `@elasticpath/plasmic-ep-commerce-elastic-path`
    - importName: `ShopperContext`
    - Props: cartId (string), accountId (string, advanced), locale (string, advanced), currency (string, advanced)
    - `registerShopperContext(loader?)` function following existing pattern
  - Edit `src/index.tsx`:
    - Add import: `import { registerShopperContext } from './shopper-context/registerShopperContext'`
    - Add call in `registerAll()` right after `registerCommerceProvider(loader)`: `registerShopperContext(loader)`
    - Add export: `export * from './shopper-context'`
    - Add export: `export * from './shopper-context/server'` (so consumer API routes can import `resolveCartId`, `buildCartCookieHeader` from main package entry without needing `package.json` subpath exports)

- [x] **P0-9: Constants** — `src/const.ts`
  - Add: `export const EP_CART_COOKIE_NAME = 'ep_cart'`
  - Add: `export const SHOPPER_CONTEXT_HEADER = 'x-shopper-context'`
  - Note: These are for documentation/reference. The server utilities hardcode the values to avoid import coupling.

### Phase 1: Cart Read Hooks (P1) — 5 Items

**Prerequisite:** Add `"swr": ">=1.0.0"` to `peerDependencies` in `package.json` (first thing in Phase 1).

- [x] **P1-1: useCart hook** — `src/shopper-context/use-cart.ts`
  - SWR hook fetching `GET /api/cart` via `useShopperFetch()`
  - Cache key: `cartId ? ['cart', cartId] : 'cart'` — Studio preview triggers refetch on cartId change
  - SWR options: `revalidateOnFocus: false`
  - Types defined inline (NOT imported from EP SDK):
    - `CartItem` — id, type, product_id, name, description, sku, slug, quantity, image?, meta.display_price
    - `CartMeta` — display_price with with_tax, without_tax, tax, discount?
    - `CartData` — items: CartItem[], meta: CartMeta | null
    - `UseCartReturn` — data, error, isLoading, isEmpty, mutate
  - `mutate()` exposed for Phase 2 mutation hooks
  - Test: `src/shopper-context/__tests__/use-cart.test.ts` — fetch call to /api/cart, SWR key varies with cartId, error handling

- [x] **P1-2: useCheckoutCart hook** — `src/shopper-context/use-checkout-cart.ts`
  - Wraps `useCart()`, normalizes raw EP cart data into checkout display format
  - `useMemo` for normalization (only recomputes when data changes)
  - Types:
    - `CheckoutCartItem` — id, productId, name, sku, quantity, unitPrice, linePrice, formattedUnitPrice, formattedLinePrice, imageUrl
    - `CheckoutCartData` — items, itemCount, subtotal, tax, shipping(=0), total, formatted*, currencyCode, showImages, hasPromo, promoCode, promoDiscount, formattedPromoDiscount
  - Returns `null` when no data or no meta
  - Shipping hardcoded to 0 (calculated during checkout, not in cart)
  - Test: `src/shopper-context/__tests__/use-checkout-cart.test.ts` — normalization, null handling, formatted prices

- [x] **P1-3: Design-time mock data** — `src/shopper-context/design-time-data.ts`
  - `MOCK_SERVER_CART_DATA: CheckoutCartData` with 2 items:
    - "Ember Glow Soy Candle" (2x $38.00 = $76.00)
    - "Midnight Wick Reed Diffuser" (1x $24.00 = $24.00)
  - Total: $108.25 (subtotal $100.00 + tax $8.25)

- [x] **P1-4: EPCheckoutCartSummary enhancement** — `src/checkout/composable/EPCheckoutCartSummary.tsx`
  - Add optional `cartData?: CheckoutCartData` prop to interface
  - When `cartData` provided: wrap children in DataProvider with external data, skip internal useCart() fetch
  - When `cartData` not provided: existing internal behavior unchanged (backward compatible)
  - Minimal change to existing file — add prop, use two-component pattern (outer wrapper + inner component)
  - NOTE: The spec originally said "early return guard" but that would violate React hooks rules since useCart() etc. are called after the guard. Instead, the implementation uses a thin outer wrapper that checks for `cartData` and either renders a DataProvider directly or delegates to the inner component that calls hooks.
  - NOTE: Do NOT add to Plasmic meta props (this is a code-only integration prop, not designer-facing)
  - **Shape difference note:** New `CheckoutCartData` item fields (`unitPrice`, `linePrice`, `formattedUnitPrice`, `formattedLinePrice`) differ from existing internal normalization (`price`, `formattedPrice`). Consumers using the new `cartData` prop opt into the new shape; existing Plasmic bindings remain on the old internal shape when `cartData` is not provided.

- [x] **P1-5: Update barrel exports** — `src/shopper-context/index.ts`
  - Add: `useCart`, `CartItem`, `CartMeta`, `CartData`, `UseCartReturn` from use-cart
  - Add: `useCheckoutCart`, `CheckoutCartItem`, `CheckoutCartData` from use-checkout-cart
  - Add: `MOCK_SERVER_CART_DATA` from design-time-data

### Phase 2: Cart Mutation Hooks (P2) — 4 Items

- [x] **P2-1: useAddItem hook** — `src/shopper-context/use-add-item.ts`
  - Returns memoized async function via `useCallback`
  - `POST /api/cart/items` with JSON body via `useShopperFetch()`
  - `AddItemInput` type: productId (required), variantId?, quantity?, bundleConfiguration?, locationId?, selectedOptions?
  - Calls `mutate()` from `useCart()` after successful add
  - Returns server response
  - Test: `src/shopper-context/__tests__/use-add-item.test.ts` — POST call, body shape, mutate called

- [x] **P2-2: useRemoveItem hook** — `src/shopper-context/use-remove-item.ts`
  - Returns memoized async function via `useCallback`
  - `DELETE /api/cart/items/${encodeURIComponent(itemId)}` via `useShopperFetch()`
  - URL-encodes itemId to prevent path injection
  - Calls `mutate()` after successful removal
  - Test: `src/shopper-context/__tests__/use-remove-item.test.ts` — DELETE call, URL encoding, mutate called

- [x] **P2-3: useUpdateItem hook** — `src/shopper-context/use-update-item.ts`
  - Returns memoized function via `useCallback` (NOT async — fires debounced)
  - `PUT /api/cart/items/${encodeURIComponent(itemId)}` with `{ quantity }` body
  - Debounced at `DEFAULT_DEBOUNCE_MS` (500ms) from `src/const.ts` using `useRef<setTimeout>`
  - Calls `mutate()` after debounce completes
  - Quantity 0 = remove (server handles this)
  - Test: `src/shopper-context/__tests__/use-update-item.test.ts` — PUT call, debounce behavior, mutate called

- [x] **P2-4: Update barrel exports** — `src/shopper-context/index.ts`
  - Add: `useAddItem`, `AddItemInput` from use-add-item
  - Add: `useRemoveItem` from use-remove-item
  - Add: `useUpdateItem` from use-update-item

### Phase 3: Credential Removal (P3) — 5 Items

- [x] **P3-1: Deprecate old cart hooks** — `src/cart/*.tsx` + `src/utils/cart-cookie.ts`
  - Add `@deprecated` JSDoc to:
    - `src/cart/use-cart.tsx` — "Use useCart from shopper-context/use-cart.ts"
    - `src/cart/use-add-item.tsx` — "Use useAddItem from shopper-context/use-add-item.ts"
    - `src/cart/use-remove-item.tsx` — "Use useRemoveItem from shopper-context/use-remove-item.ts"
    - `src/cart/use-update-item.tsx` — "Use useUpdateItem from shopper-context/use-update-item.ts"
    - `src/utils/cart-cookie.ts` — getCartId, setCartId, removeCartCookie — "Use server-side httpOnly cookie via shopper-context/server/cart-cookie.ts"

- [x] **P3-2: CommerceProvider serverCartMode** — `src/registerCommerceProvider.tsx`
  - Add `serverCartMode` boolean prop (advanced, default false)
  - When true + no clientId: skip EP SDK init, render children only
  - Existing behavior unchanged when false
  - Add to meta props: `serverCartMode: { type: 'boolean', displayName: 'Server Cart Mode', advanced: true, defaultValue: false }`
  - Test: `src/registerCommerceProvider.test.tsx` — serverCartMode renders children without EP client

- [x] **P3-3: EPPromoCodeInput server mode** — `src/checkout/composable/EPPromoCodeInput.tsx`
  - Add `useServerRoutes` boolean prop
  - When true: apply promo via `POST /api/cart/promo` with `{ code }`, remove via `DELETE /api/cart/promo` with `{ promoItemId }`
  - Uses `useShopperFetch()` internally (requires ShopperContext above in tree)
  - Existing behavior unchanged when false (default)
  - Test: `src/checkout/composable/__tests__/EPPromoCodeInput.test.tsx` — useServerRoutes mode calls /api/cart/promo

- [x] **P3-4: Audit and document** — Review all `getEPClient()` / `useCommerce()` usage for cart operations
  - All 4 deprecated cart hooks (`src/cart/use-cart.tsx`, `use-add-item.tsx`, `use-remove-item.tsx`, `use-update-item.tsx`) have server-route alternatives via `shopper-context/` hooks
  - EPPromoCodeInput has dual-mode (`useServerRoutes` prop) — client or server routes
  - Remaining client-side EP SDK usage (intentionally kept, public data only):
    - `src/product/use-product.tsx` — product detail fetch via `getByContextProduct`
    - `src/product/use-search.tsx` — product listing via `getByContextAllProducts`
    - `src/site/use-categories.tsx` — category hierarchy via `getByContextAllNodes`
    - `src/inventory/use-stock.tsx`, `use-locations.tsx` — stock/location reads
    - `src/bundle/use-bundle-configuration.tsx` — bundle config via `configureByContextProduct`
    - `src/catalog-search/EPCatalogSearchProvider.tsx` — Algolia adapter initialization
  - All above use `client_id` only (public key), no `client_secret` — acceptable risk
  - `client_secret` exists only server-side in `api/endpoints/checkout/` (calculate-shipping, setup-payment)

- [x] **P3-5: CartActionsProvider review** — ServerCartActionsProvider created
  - `CartActionsProvider` from `@plasmicpkgs/commerce` was NOT available in `serverCartMode` (no global actions)
  - Created `src/shopper-context/ServerCartActionsProvider.tsx` — bridges shopper-context hooks to Plasmic global actions
  - Updated `registerCommerceProvider.tsx`: uses `ServerCartActionsProvider` when `serverCartMode=true`, `CartActionsProvider` when false
  - Works both with and without `clientId` (no `clientId` = cart-only server mode; with `clientId` = products client-side + cart server-side)
  - Test: `src/shopper-context/__tests__/ServerCartActionsProvider.test.tsx` — renders children, hooks initialize
  - Exported via `src/shopper-context/index.ts` barrel

### Composable Checkout Phase 1: Core Checkout Provider (CC-P0) — 4 Items

- [x] **CC-P0-1: EPCheckoutProvider** — `src/checkout/composable/EPCheckoutProvider.tsx`
  - Root checkout orchestrator wrapping useCheckout() hook
  - Exposes complete checkoutData via DataProvider + 9 refActions via useImperativeHandle
  - Design-time preview with mock data for all 4 steps
  - Shared CheckoutPaymentContext for EPPaymentElements integration (Phase 3)
  - Made useCheckout() cartId optional for server-cart mode (server resolves from cookie)
  - Test: `src/checkout/composable/__tests__/EPCheckoutProvider.test.tsx` (9 tests)
  - Also added: CheckoutContext.tsx, design-time mock data, registration, barrel exports

- [x] **CC-P0-2: EPCheckoutStepIndicator** — `src/checkout/composable/EPCheckoutStepIndicator.tsx`
  - Repeater over 4 checkout steps with per-step DataProvider (currentStep, currentStepIndex)
  - Uses repeatedElement() pattern, reads stepIndex from checkoutData
  - Design-time mock with stepIndex=1 (Shipping active)
  - Test: `src/checkout/composable/__tests__/EPCheckoutStepIndicator.test.tsx` (4 tests)

- [x] **CC-P0-3: EPCheckoutButton** — `src/checkout/composable/EPCheckoutButton.tsx`
  - Step-aware button with label/disabled/processing data via checkoutButtonData DataProvider
  - data-step attribute for CSS targeting, onComplete event for confirmation step
  - Test: `src/checkout/composable/__tests__/EPCheckoutButton.test.tsx` (6 tests)

- [x] **CC-P0-4: EPOrderTotalsBreakdown** — `src/checkout/composable/EPOrderTotalsBreakdown.tsx`
  - Financial totals via orderTotalsData DataProvider
  - Reads from checkoutData.summary > checkoutCartData > mock fallback
  - Test: `src/checkout/composable/__tests__/EPOrderTotalsBreakdown.test.tsx` (4 tests)

### Composable Checkout Phase 2: Form Fields (CC-P1) — 3 Items

- [x] **CC-P1-1: EPCustomerInfoFields** — `src/checkout/composable/EPCustomerInfoFields.tsx`
  - Headless provider for firstName, lastName, email with validation
  - refActions: setField, validate (returns boolean), clear
  - Preview states: auto, empty, filled, withErrors
  - Two-component pattern: outer handles design-time, inner uses hooks
  - Test: `__tests__/EPCustomerInfoFields.test.tsx` (8 tests)

- [x] **CC-P1-2: EPShippingAddressFields** — `src/checkout/composable/EPShippingAddressFields.tsx`
  - Headless provider for shipping address with postcode validation by country (US, CA)
  - refActions: setField, validate (returns boolean), clear
  - Preview states: auto, empty, filled, withErrors, withSuggestions
  - showPhoneField prop controls phone validation
  - Test: `__tests__/EPShippingAddressFields.test.tsx` (9 tests)

- [x] **CC-P1-3: EPBillingAddressFields** — `src/checkout/composable/EPBillingAddressFields.tsx`
  - Headless provider that mirrors shipping when isSameAsShipping is active
  - Reads billingToggleData from EPBillingAddressToggle or checkoutData.sameAsShipping
  - Mirror mode: exposes shipping data as billing, refActions are no-ops
  - Independent mode: full field state + validation (same as shipping minus phone)
  - Preview states: auto, sameAsShipping, different, withErrors
  - Test: `__tests__/EPBillingAddressFields.test.tsx` (6 tests)

### Composable Checkout Phase 3: Shipping & Payment (CC-P2) — 2 Items

- [ ] **CC-P2-1: EPShippingMethodSelector** — `src/checkout/composable/EPShippingMethodSelector.tsx`
- [ ] **CC-P2-2: EPPaymentElements** — `src/checkout/composable/EPPaymentElements.tsx`

---

## Implementation Order

Build strictly in phase order. Within each phase, build in item order.

```
Phase 0 (P0-1 → P0-9) — ShopperContext foundation
  ↓
Phase 1 (P1-1 → P1-5) — Cart read hooks (+ add swr peerDep)
  ↓
Phase 2 (P2-1 → P2-4) — Cart mutation hooks
  ↓
Phase 3 (P3-1 → P3-5) — Credential removal + deprecation
  ↓
Composable Checkout Phase 1 (CC-P0-1 → CC-P0-4) — Core checkout provider
  ↓
Composable Checkout Phase 2 (CC-P1-1 → CC-P1-3) — Form fields
  ↓
Composable Checkout Phase 3 (CC-P2-1 → CC-P2-2) — Shipping & payment
```

**Server-cart phases COMPLETE** (P0 → P3). **CC-P0 COMPLETE**. **CC-P1 COMPLETE**. **Next: CC-P2-1.**

---

## New Files Summary

### Server-Cart Implementation Files (15)

```
src/shopper-context/              ← Created in Phase 0
  index.ts                          — barrel exports (Phase 0, updated in P1/P2/P3)
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
  ServerCartActionsProvider.tsx    — global actions via server routes (Phase 3)
  server/
    index.ts                        — server barrel (Phase 0)
    resolve-cart-id.ts             — header/cookie resolution (Phase 0)
    cart-cookie.ts                 — httpOnly cookie builder (Phase 0)
```

### Server-Cart Test Files (12)

```
src/shopper-context/__tests__/
  ShopperContext.test.tsx            — context component + singleton (Phase 0)
  useShopperFetch.test.ts           — header attach/omit (Phase 0)
  use-cart.test.ts                  — SWR hook, cache key (Phase 1)
  use-checkout-cart.test.ts         — normalization (Phase 1)
  use-add-item.test.ts              — POST mutation (Phase 2)
  use-remove-item.test.ts           — DELETE mutation (Phase 2)
  use-update-item.test.ts           — PUT + debounce (Phase 2)
  ServerCartActionsProvider.test.tsx — global actions provider (Phase 3)
src/shopper-context/server/__tests__/
  resolve-cart-id.test.ts           — priority resolution (Phase 0)
  cart-cookie.test.ts               — cookie string building (Phase 0)
src/registerCommerceProvider.test.tsx  — serverCartMode thin shell (Phase 3)
src/checkout/composable/__tests__/
  EPPromoCodeInput.test.tsx          — useServerRoutes promo via /api/cart/promo (Phase 3)
```

### Composable Checkout Files (CC-P0+)

```
src/checkout/composable/         ← Composable checkout (CC-P0+)
  CheckoutContext.tsx              — shared payment context (CC-P0-1)
  EPCheckoutProvider.tsx           — root checkout orchestrator (CC-P0-1)
  EPCheckoutStepIndicator.tsx      — step repeater (CC-P0-2)
  EPCheckoutButton.tsx             — step-aware button (CC-P0-3)
  EPOrderTotalsBreakdown.tsx       — financial totals (CC-P0-4)
  EPCustomerInfoFields.tsx         — customer name/email (CC-P1-1)
  EPShippingAddressFields.tsx      — shipping address (CC-P1-2)
  EPBillingAddressFields.tsx       — billing address (CC-P1-3)
  EPShippingMethodSelector.tsx     — shipping rates (CC-P2-1)
  EPPaymentElements.tsx            — Stripe Elements (CC-P2-2)
  __tests__/
    EPCheckoutProvider.test.tsx        — provider tests (CC-P0-1)
    EPCustomerInfoFields.test.tsx      — customer info validation tests (CC-P1-1)
    EPShippingAddressFields.test.tsx   — shipping address validation tests (CC-P1-2)
    EPBillingAddressFields.test.tsx    — billing address mirror tests (CC-P1-3)
    EPCheckoutStepIndicator.test.tsx   — step indicator tests (CC-P0-2)
    EPCheckoutButton.test.tsx          — step-aware button tests (CC-P0-3)
    EPOrderTotalsBreakdown.test.tsx    — financial totals tests (CC-P0-4)
```

## Existing Files to Modify

| File | Change | Phase |
|------|--------|-------|
| `src/const.ts` | Add 2 constants (EP_CART_COOKIE_NAME, SHOPPER_CONTEXT_HEADER) | P0 |
| `src/index.tsx` | Add import, registerShopperContext() call, export * | P0 |
| `package.json` | Add `"swr": ">=1.0.0"` to peerDependencies | P1 |
| `src/checkout/composable/EPCheckoutCartSummary.tsx` | Add optional `cartData` prop + early return | P1 |
| `src/cart/use-cart.tsx` | Add @deprecated JSDoc | P3 |
| `src/cart/use-add-item.tsx` | Add @deprecated JSDoc | P3 |
| `src/cart/use-remove-item.tsx` | Add @deprecated JSDoc | P3 |
| `src/cart/use-update-item.tsx` | Add @deprecated JSDoc | P3 |
| `src/utils/cart-cookie.ts` | Add @deprecated JSDoc to 3 exports | P3 |
| `src/registerCommerceProvider.tsx` | Add `serverCartMode` boolean prop + ServerCartActionsProvider | P3 |
| `src/checkout/composable/EPPromoCodeInput.tsx` | Add `useServerRoutes` boolean prop | P3 |
| `src/checkout/hooks/use-checkout.tsx` | Make cartId optional in calculateShipping/createOrder | CC-P0-1 |
| `src/registerCheckout.tsx` | Register EPCheckoutProvider | CC-P0-1 |
| `src/registerCheckout.tsx` | Register EPCheckoutStepIndicator, EPCheckoutButton, EPOrderTotalsBreakdown | CC-P0-2..4 |
| `src/checkout/composable/index.ts` | Add EPCheckoutProvider + CheckoutContext exports | CC-P0-1 |
| `src/checkout/composable/index.ts` | Add EPCheckoutStepIndicator, EPCheckoutButton, EPOrderTotalsBreakdown exports | CC-P0-2..4 |
| `src/checkout/composable/index.ts` | Add EPCustomerInfoFields, EPShippingAddressFields, EPBillingAddressFields exports | CC-P1-1..3 |
| `src/registerCheckout.tsx` | Register EPCustomerInfoFields, EPShippingAddressFields, EPBillingAddressFields | CC-P1-1..3 |
| `src/utils/design-time-data.ts` | Add composable checkout mock data | CC-P0-1 |
| `src/utils/design-time-data.ts` | Add form field mock data (empty, withErrors, suggestions, billing) | CC-P1-1..3 |

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

### Cookie Name Distinction
- **Existing:** `ELASTICPATH_CART_COOKIE = 'elasticpath_cart'` — client-side, js-cookie readable
- **New:** `EP_CART_COOKIE_NAME = 'ep_cart'` — server-side, httpOnly, not JS-readable
- Different cookie names prevent conflicts during migration. Old cookie continues working for existing cart hooks; new cookie used only by server-cart architecture.

### Export Strategy
- **Barrel exports from `src/index.tsx`** (not package.json subpath exports)
- `export * from './shopper-context'` — client hooks + context
- `export * from './shopper-context/server'` — server utilities (resolveCartId, buildCartCookieHeader)
- Consumer imports everything from `@elasticpath/plasmic-ep-commerce-elastic-path` root
- Server utilities are pure functions (string building) safe to include in client bundles — tree-shakeable
- `cart-cookie.ts` references `process.env.NODE_ENV` at module init — bundlers replace this at build time

### CheckoutCartData Shape Compatibility
- **Existing EPCheckoutCartSummary** internal normalization uses: `price`, `formattedPrice`, `imageUrl` (string), `options`
- **New CheckoutCartData** type uses: `unitPrice`, `linePrice`, `formattedUnitPrice`, `formattedLinePrice`, `imageUrl` (string | null)
- These shapes intentionally differ — the new `cartData` prop is code-only (not Plasmic meta)
- Consumers opting into server-cart architecture bind Plasmic children to new field names
- Existing pages continue using the internal normalization when `cartData` is not provided

### Test Infrastructure
- Root `jest.config.js` auto-discovers `plasmicpkgs/**/*.test.{ts,tsx}` with esbuild transform
- Client tests (`__tests__/*.test.tsx`) need `/** @jest-environment jsdom */` pragma
- Server tests (`server/__tests__/*.test.ts`) use default node environment
- Run: `cd plasmicpkgs/commerce-providers/elastic-path && yarn test`

### Learning Notes

- `@testing-library/react-hooks` is NOT available in this repo — use `@testing-library/react` which includes `renderHook`.
- `jest.mock()` does NOT hoist with this project's esbuild transform (`jest-transform-esbuild.js`). Tests must mock at the `global.fetch` level instead of using `jest.mock()` factories. The existing passing tests (ShopperContext.test.tsx, useShopperFetch.test.ts) confirm this pattern.
- For SWR tests: wrap in `<SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>` to isolate cache between tests.
- `useCart` `isEmpty` check must be defensive (`!data || !data.items || data.items.length === 0`) because mutation hook tests may mock fetch with responses that lack `items` field. Fixed in Phase 2.
- EPCheckoutProvider uses a two-component pattern (outer mock check → inner runtime with hooks) to avoid conditional hook calls. The outer component handles design-time preview with static mock data; the inner component uses useCheckout(), useShopperContext(), and useState.
- useCheckout() cartId is optional — in server-cart mode the API routes resolve cart identity from the httpOnly cookie / X-Shopper-Context header.
