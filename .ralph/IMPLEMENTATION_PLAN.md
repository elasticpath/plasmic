# Implementation Plan

**Last updated:** 2026-03-09
**Last verified against codebase:** 2026-03-09 (re-verified)
**Branch:** `feat/server-cart-shopper-context`
**Focus:** Server-only cart architecture with ShopperContext for Elastic Path commerce in Plasmic

## Status Summary

| Category | Count |
|----------|-------|
| Active specs (server-cart) | 5 |
| Deferred specs | 1 (`composable-checkout.md` — build after server-cart phases) |
| Completed specs | 8 (product discovery + MCP) |
| Total items to implement | 23 (14 impl files + 11 test files = 25 new files) |
| Completed items | 9 |

## Active Spec Status

| Spec | Phase | Priority | Status |
|------|-------|----------|--------|
| `server-cart-architecture.md` | Overview | — | Reference doc (no items) |
| `phase-0-shopper-context.md` | Phase 0 | P0 | **DONE** (9/9 items) |
| `phase-1-cart-reads.md` | Phase 1 | P1 | **TO DO** (0/5 items) |
| `phase-2-cart-mutations.md` | Phase 2 | P2 | **TO DO** (0/4 items) |
| `phase-3-credential-removal.md` | Phase 3 | P3 | **TO DO** (0/5 items) |

## Deferred Specs

| Spec | Reason |
|------|--------|
| `composable-checkout.md` | Checkout UI components — build after server-cart architecture is complete |

---

## Verified Codebase State (2026-03-09)

- `src/shopper-context/` directory does **NOT exist** — confirmed
- No ShopperContext, useShopperFetch, or server-cart code exists anywhere in the codebase
- `src/const.ts` has no `EP_CART_COOKIE_NAME` or `SHOPPER_CONTEXT_HEADER` constants yet
- `EPCheckoutCartSummary` has NO `cartData` prop — only: children, className, showImages, collapsible, isExpanded, onExpandedChange, previewState
- No `@deprecated` markers exist on any cart hooks or cookie utils
- `swr` is NOT in `package.json` (needed in Phase 1 as peerDependency)
- Existing cart cookie constant is `ELASTICPATH_CART_COOKIE = 'elasticpath_cart'` (client-side, js-cookie)
- New server-side cookie will use `EP_CART_COOKIE_NAME = 'ep_cart'` (httpOnly, different name)
- No TODOs, FIXMEs, or placeholders in existing code (except EPPromoCodeInput hardcoded `-$10.00` discount)

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

- [ ] **P1-1: useCart hook** — `src/shopper-context/use-cart.ts`
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

- [ ] **P1-2: useCheckoutCart hook** — `src/shopper-context/use-checkout-cart.ts`
  - Wraps `useCart()`, normalizes raw EP cart data into checkout display format
  - `useMemo` for normalization (only recomputes when data changes)
  - Types:
    - `CheckoutCartItem` — id, productId, name, sku, quantity, unitPrice, linePrice, formattedUnitPrice, formattedLinePrice, imageUrl
    - `CheckoutCartData` — items, itemCount, subtotal, tax, shipping(=0), total, formatted*, currencyCode, showImages, hasPromo, promoCode, promoDiscount, formattedPromoDiscount
  - Returns `null` when no data or no meta
  - Shipping hardcoded to 0 (calculated during checkout, not in cart)
  - Test: `src/shopper-context/__tests__/use-checkout-cart.test.ts` — normalization, null handling, formatted prices

- [ ] **P1-3: Design-time mock data** — `src/shopper-context/design-time-data.ts`
  - `MOCK_SERVER_CART_DATA: CheckoutCartData` with 2 items:
    - "Ember Glow Soy Candle" (2x $38.00 = $76.00)
    - "Midnight Wick Reed Diffuser" (1x $24.00 = $24.00)
  - Total: $108.25 (subtotal $100.00 + tax $8.25)

- [ ] **P1-4: EPCheckoutCartSummary enhancement** — `src/checkout/composable/EPCheckoutCartSummary.tsx`
  - Add optional `cartData?: CheckoutCartData` prop to interface
  - When `cartData` provided: wrap children in DataProvider with external data, skip internal useCart() fetch
  - When `cartData` not provided: existing internal behavior unchanged (backward compatible)
  - Minimal change to existing file — add prop, add early return guard
  - NOTE: Do NOT add to Plasmic meta props (this is a code-only integration prop, not designer-facing)
  - **Shape difference note:** New `CheckoutCartData` item fields (`unitPrice`, `linePrice`, `formattedUnitPrice`, `formattedLinePrice`) differ from existing internal normalization (`price`, `formattedPrice`). Consumers using the new `cartData` prop opt into the new shape; existing Plasmic bindings remain on the old internal shape when `cartData` is not provided.

- [ ] **P1-5: Update barrel exports** — `src/shopper-context/index.ts`
  - Add: `useCart`, `CartItem`, `CartMeta`, `CartData`, `UseCartReturn` from use-cart
  - Add: `useCheckoutCart`, `CheckoutCartItem`, `CheckoutCartData` from use-checkout-cart
  - Add: `MOCK_SERVER_CART_DATA` from design-time-data

### Phase 2: Cart Mutation Hooks (P2) — 4 Items

- [ ] **P2-1: useAddItem hook** — `src/shopper-context/use-add-item.ts`
  - Returns memoized async function via `useCallback`
  - `POST /api/cart/items` with JSON body via `useShopperFetch()`
  - `AddItemInput` type: productId (required), variantId?, quantity?, bundleConfiguration?, locationId?, selectedOptions?
  - Calls `mutate()` from `useCart()` after successful add
  - Returns server response
  - Test: `src/shopper-context/__tests__/use-add-item.test.ts` — POST call, body shape, mutate called

- [ ] **P2-2: useRemoveItem hook** — `src/shopper-context/use-remove-item.ts`
  - Returns memoized async function via `useCallback`
  - `DELETE /api/cart/items/${encodeURIComponent(itemId)}` via `useShopperFetch()`
  - URL-encodes itemId to prevent path injection
  - Calls `mutate()` after successful removal
  - Test: `src/shopper-context/__tests__/use-remove-item.test.ts` — DELETE call, URL encoding, mutate called

- [ ] **P2-3: useUpdateItem hook** — `src/shopper-context/use-update-item.ts`
  - Returns memoized function via `useCallback` (NOT async — fires debounced)
  - `PUT /api/cart/items/${encodeURIComponent(itemId)}` with `{ quantity }` body
  - Debounced at `DEFAULT_DEBOUNCE_MS` (500ms) from `src/const.ts` using `useRef<setTimeout>`
  - Calls `mutate()` after debounce completes
  - Quantity 0 = remove (server handles this)
  - Test: `src/shopper-context/__tests__/use-update-item.test.ts` — PUT call, debounce behavior, mutate called

- [ ] **P2-4: Update barrel exports** — `src/shopper-context/index.ts`
  - Add: `useAddItem`, `AddItemInput` from use-add-item
  - Add: `useRemoveItem` from use-remove-item
  - Add: `useUpdateItem` from use-update-item

### Phase 3: Credential Removal (P3) — 5 Items

- [ ] **P3-1: Deprecate old cart hooks** — `src/cart/*.tsx` + `src/utils/cart-cookie.ts`
  - Add `@deprecated` JSDoc to:
    - `src/cart/use-cart.tsx` — "Use useCart from shopper-context/use-cart.ts"
    - `src/cart/use-add-item.tsx` — "Use useAddItem from shopper-context/use-add-item.ts"
    - `src/cart/use-remove-item.tsx` — "Use useRemoveItem from shopper-context/use-remove-item.ts"
    - `src/cart/use-update-item.tsx` — "Use useUpdateItem from shopper-context/use-update-item.ts"
    - `src/utils/cart-cookie.ts` — getCartId, setCartId, removeCartCookie — "Use server-side httpOnly cookie via shopper-context/server/cart-cookie.ts"

- [ ] **P3-2: CommerceProvider serverCartMode** — `src/registerCommerceProvider.tsx`
  - Add `serverCartMode` boolean prop (advanced, default false)
  - When true + no clientId: skip EP SDK init, render children only
  - Existing behavior unchanged when false
  - Add to meta props: `serverCartMode: { type: 'boolean', displayName: 'Server Cart Mode', advanced: true, defaultValue: false }`
  - Test: `src/registerCommerceProvider.test.tsx` — serverCartMode renders children without EP client

- [ ] **P3-3: EPPromoCodeInput server mode** — `src/checkout/composable/EPPromoCodeInput.tsx`
  - Add `useServerRoutes` boolean prop
  - When true: apply promo via `POST /api/cart/promo` with `{ code }`, remove via `DELETE /api/cart/promo` with `{ promoItemId }`
  - Uses `useShopperFetch()` internally (requires ShopperContext above in tree)
  - Existing behavior unchanged when false (default)
  - Test: `src/checkout/composable/__tests__/EPPromoCodeInput.test.tsx` — useServerRoutes mode calls /api/cart/promo

- [ ] **P3-4: Audit and document** — Review all `getEPClient()` / `useCommerce()` usage for cart operations
  - Confirm all cart paths have server-route alternatives
  - Document remaining client-side EP usage (product/search hooks — intentionally kept, public data)
  - Known: product hooks use client_id only (no secret), acceptable risk

- [ ] **P3-5: CartActionsProvider review** — Check if global actions (addToCart) need updating
  - If used in Plasmic interactions, ensure they work with server-cart hooks
  - May need ServerCartActionsProvider or modification to existing one
  - Depends on how CartActionsProvider is wired in the consumer app

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
```

**Phase 0 complete.** Next up → P1-1 (useCart hook). Add `swr` peerDependency first.

---

## New Files Summary (14 implementation + 11 test = 25 new files)

### Implementation Files (14)

```
src/shopper-context/              ← Created in Phase 0
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

### Test Files (11)

```
src/shopper-context/__tests__/
  ShopperContext.test.tsx            — context component + singleton (Phase 0)
  useShopperFetch.test.ts           — header attach/omit (Phase 0)
  use-cart.test.ts                  — SWR hook, cache key (Phase 1)
  use-checkout-cart.test.ts         — normalization (Phase 1)
  use-add-item.test.ts              — POST mutation (Phase 2)
  use-remove-item.test.ts           — DELETE mutation (Phase 2)
  use-update-item.test.ts           — PUT + debounce (Phase 2)
src/shopper-context/server/__tests__/
  resolve-cart-id.test.ts           — priority resolution (Phase 0)
  cart-cookie.test.ts               — cookie string building (Phase 0)
src/registerCommerceProvider.test.tsx  — serverCartMode thin shell (Phase 3)
src/checkout/composable/__tests__/
  EPPromoCodeInput.test.tsx          — useServerRoutes promo via /api/cart/promo (Phase 3)
```

## Existing Files to Modify (11 files — minimal changes)

| File | Change | Phase |
|------|--------|-------|
| `src/const.ts` | Add 2 constants (EP_CART_COOKIE_NAME, SHOPPER_CONTEXT_HEADER) | 0 |
| `src/index.tsx` | Add import, registerShopperContext() call, export * | 0 |
| `package.json` | Add `"swr": ">=1.0.0"` to peerDependencies | 1 |
| `src/checkout/composable/EPCheckoutCartSummary.tsx` | Add optional `cartData` prop + early return | 1 |
| `src/cart/use-cart.tsx` | Add @deprecated JSDoc | 3 |
| `src/cart/use-add-item.tsx` | Add @deprecated JSDoc | 3 |
| `src/cart/use-remove-item.tsx` | Add @deprecated JSDoc | 3 |
| `src/cart/use-update-item.tsx` | Add @deprecated JSDoc | 3 |
| `src/utils/cart-cookie.ts` | Add @deprecated JSDoc to 3 exports | 3 |
| `src/registerCommerceProvider.tsx` | Add `serverCartMode` boolean prop | 3 |
| `src/checkout/composable/EPPromoCodeInput.tsx` | Add `useServerRoutes` boolean prop | 3 |

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
