# Implementation Plan — EP Components Cart Work

> Auto-generated from analysis of `specs/*` vs `plasmicpkgs/commerce-providers/elastic-path/src/*`
> Last updated: 2026-02-24

---

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Complete

---

## P0 — Bundle Hooks Rework (Foundation for Composable Components)

**Spec:** `specs/bundle-hooks-rework.md`
**Why first:** The composable bundle configurator (P1) depends on clean, SWR-cached hooks. Currently all bundle data-fetching hooks use raw `useEffect`/`useState` instead of the `useMutablePlasmicQueryData` SWR pattern established in `inventory/use-stock.tsx` and `inventory/use-locations.tsx`.

- [x] **Migrate `use-bundle-option-products.tsx` to SWR caching** — Done. Uses `handleAPIError`.

- [x] **Migrate `use-parent-products.tsx` to SWR caching** — Done. Uses `handleAPIError`.

- [x] **Evaluate and clean up `useBundleState` vs `useBundleForm`** — `useBundleState.tsx` removed (unused legacy code).

- [x] **Ensure existing tests still pass** — 174 tests across 11 suites, all passing.

- [x] **Clean up `useBundleConfigurationOrchestration` state management** — Replaced redundant `lastConfigured` state + ref-sync effect with single `lastConfiguredRef`. Replaced JSON.stringify comparison with structural `areSelectionsEqual()`. Added `error` state with `handleAPIError()` for consumers. Fixed isConfiguring flash via early duplicate return. Removed unused `lastConfigured` from return type. Added 3 new tests (error clearing, cleanup on unmount, parent:child key handling). 174 tests passing.

- [x] **Ensure `useVariationSelection` is reusable for new `EPBundleVariationPicker`** — Verified: hook API already accepts `onSelectionChange`, `componentKey`, `optionId` as props. `findMatchingVariant()` and `parentId:childId` key format work unchanged. No code changes needed.

- [x] **Verify `useBundleFormSync` works for composable components** — Verified: `useFormContext()` gets the parent (product page) form because it runs at provider level before any child `<FormProvider>`. Dual-update pattern (internal form + parent form) works for EPBundleProvider. URL sync with `?bundle_config=` base64 parameter continues working. No code changes needed.

### Testing Discovery

esbuild jest transform hoists `import` to `require()` at file top, BEFORE `jest.mock()` calls. Fix: use `require()` for code-under-test so esbuild doesn't hoist it.

---

## P1 — Composable Bundle Configurator Components

**Spec:** `specs/composable-bundle-configurator.md`
**Status:** All 14 components implemented in `src/bundle/composable/`. Build passes, 174 tests pass (11 suites).

> **Build fix note:** `sortByOrder` expects `sort_order` (snake_case) while enriched objects used `sortOrder` (camelCase). Resolved by adding a `sort_order` property to enriched option/component objects so both naming conventions are available.

### P1a — Root Provider & Summary Components

- [x] **`EPBundleProvider`** — Root DataProvider for bundle state (`EPBundleProvider.tsx`)
  - Reads `currentProduct` from ancestor via `useSelector`
  - Validates product is a bundle, extracts components
  - Manages bundle form state (selections, quantities)
  - Orchestrates debounced `configureByContextProduct` API calls
  - Writes `BundleConfiguration` and `ConfiguredBundleId` to parent react-hook-form
  - Syncs state to/from URL when `updateUrlOnChange` is true
  - Restores defaults: URL > API config > auto-select (priority order)
  - Provides: `bundleData` DataProvider key
  - Register with `providesData: true`

- [x] **`EPBundlePriceField`** — Displays current bundle price (`EPBundlePriceField.tsx`)
  - Reads from `bundleData` context
  - Handles fixed vs cumulative pricing
  - Updates after `configureByContextProduct` success
  - Internal `BundlePrice.tsx` exists but is not registered

- [x] **`EPBundleValidationErrors`** — Renders validation errors (`EPBundleValidationErrors.tsx`)
  - Reads from `bundleData` context
  - Zod schema validation from component min/max and option constraints
  - Internal `ValidationErrors.tsx` exists but is not registered

### P1b — Component Iteration Layer

- [x] **`EPBundleComponentList`** — Iterator over bundle components (`EPBundleComponentList.tsx`)
  - Iterates sorted by `sort_order`
  - Provides per-iteration: `currentBundleComponent` and `currentBundleComponentIndex`
  - Data shape: `{ name, key, min, max, selectedCount, isValid, options[], sortOrder }`

- [x] **`EPBundleComponentField`** — Display field for component metadata (`EPBundleComponentField.tsx`)
  - Reads from `currentBundleComponent`
  - Fields: name, min, max, selectedCount, isValid, optionCount

### P1c — Option Iteration & Selection Layer

- [x] **`EPBundleOptionList`** — Iterator over options within a component (`EPBundleOptionList.tsx`)
  - Provides per-iteration: `currentBundleOption` and `currentBundleOptionIndex`
  - Data shape: `{ id, name, quantity, minQty, maxQty, isSelected, isParentProduct, price, imageUrl, sortOrder, isDefault }`

- [x] **`EPBundleOptionField`** — Display field for option details (`EPBundleOptionField.tsx`)
  - Reads from `currentBundleOption`
  - Fields: name, price, imageUrl, quantity, etc.

- [x] **`EPBundleOptionTrigger`** — Interactive selection trigger (`EPBundleOptionTrigger.tsx`)
  - Checkbox-like (multi-select) or radio-like (single-select) based on min/max
  - Provides `BundleOptionContext` for quantity buttons
  - Exposes `data-selected` attribute for CSS styling
  - Uses `role="checkbox"` or `role="radio"` with `aria-checked`

### P1d — Quantity Controls

- [x] **`EPBundleOptionQuantityControl`** — Quantity state container (`EPBundleOptionQuantityControl.tsx`)
  - Manages quantity for current option
  - Respects option-level min/max constraints
  - Provides: `bundleOptionQuantity` DataProvider key
  - Provides: context for `EPBundleOptionQuantityButton`
  - Triggers debounced reconfiguration

- [x] **`EPBundleOptionQuantityButton`** — Increment/decrement button (`EPBundleOptionQuantityButton.tsx`)
  - Reads from `BundleOptionContext`
  - `action: "increment" | "decrement"` prop
  - Disables at min/max bounds

### P1e — Parent Product Variation Layer

- [x] **`EPBundleVariationPicker`** — Variation axes iterator for parent options (`EPBundleVariationPicker.tsx`)
  - Detects parent products, fetches children
  - Provides: `currentBundleVariation` and `currentBundleVariationIndex`
  - Data shape: `{ id, name, values: { label }[] }`

- [x] **`EPBundleVariationOptionList`** — Values iterator per variation axis (`EPBundleVariationOptionList.tsx`)
  - Provides: `currentBundleVariationOption` and `currentBundleVariationOptionIndex`
  - Data shape: `{ label, isSelected }`

- [x] **`EPBundleVariationField`** — Display field for variation axis info (`EPBundleVariationField.tsx`)
  - Reads from `currentBundleVariation`

- [x] **`EPBundleVariationOptionTrigger`** — Interactive variation value selector (`EPBundleVariationOptionTrigger.tsx`)
  - Selects variation value via `BundleVariationContext`
  - Resolves matching child variant
  - Replaces parent ID with `parentId:childId` key

### P1f — Registration & Integration

- [x] **Create `register*` functions for all 14 components**
  - Include `parentComponentName` hints
  - Include `providesData: true` where applicable
  - Include `previewState` props for design-time preview on every component

- [x] **Add all components to `registerAll()` in `index.tsx`**
  - Register field components before parent components (existing convention)
  - Keep monolithic `EPBundleConfigurator` for backwards compatibility

- [x] **Design-time preview mock data** (`bundle/composable/design-time-data.ts`)
  - Covers: multi-component bundle, single-select, multi-select, parent products with variations, fixed pricing, cumulative pricing

### P1 Supporting Files

- [x] **`BundleContext.tsx`** — React contexts (`BundleFormContext`, `BundleOptionContext`, `BundleVariationContext`)
- [x] **`index.ts`** — Barrel export for `bundle/composable/`
- [x] **Updated `src/index.tsx`** — `registerAll()` registrations for all 14 components
- [x] **All components follow Plasmic composable pattern** — `ComponentMeta` registration, `DataProvider`/`useSelector` data flow, `repeatedElement` for iteration, `usePlasmicCanvasContext` for editor detection, `previewState` for design-time preview

---

## P2 — Code Quality & Consistency

These are lower priority but improve maintainability and align with established patterns.

### P2a — Type Safety

- [ ] **Eliminate `(provider as any)` casts (44+ occurrences)**
  - Files: `use-cart.tsx`, `use-add-item.tsx`, `use-remove-item.tsx`, `use-update-item.tsx`, `use-product.tsx`, `use-search.tsx`, `use-categories.tsx`
  - Standard: `inventory/use-stock.tsx` uses `commerce.providerRef.current?.client` with proper typing
  - Create a typed helper or extend the commerce provider type

- [ ] **Eliminate other `as any` casts**
  - `(item as any).location` in cart hooks
  - `(item as any).custom_inputs` in normalize.ts
  - `(product as any)?.__initialVariantId` in variant picker
  - `(child.meta as any)?.bundle_excluded` in parent products hook
  - `globalThis as any` in StockContext.tsx

### P2b — Error Handling Standardization

- [ ] **Standardize error handling across all hooks**
  - Gold standard: `inventory/use-stock.tsx` using `handleAPIError()` from utils
  - Non-compliant: `use-remove-item.tsx`, `use-update-item.tsx`, `use-product.tsx`, `use-categories.tsx`
  - All should use `handleAPIError(error, context)` from `utils/errorHandling.ts`

- [ ] **Extract `extractErrorMessage()` utility**
  - Pattern `error instanceof Error ? error.message : String(error)` appears in 20+ files
  - Already partially addressed by `handleAPIError()` but not used everywhere

### P2c — Utility Consolidation

- [ ] **Create `getLocationSlug(location)` utility**
  - Duplicated pattern: `(ls.location as any).slug ?? ls.location.id` in 5+ files
  - Files: `EPCartItemList.tsx`, `EPStockProvider.tsx`, `stockCalculations.ts`, `displayHelpers.ts`, `MultiLocationStock.tsx`
  - Place in `inventory/utils/displayHelpers.ts` or `utils/`

- [ ] **Centralize hardcoded configuration values**
  - Debounce timeout: `500` ms in cart update, bundle orchestration
  - Stock thresholds: `5` (low) in `EPCartItemList.tsx` — should match configurable `lowStockThreshold`
  - SWR deduping intervals: 60s (stock), 300s (locations) — document/centralize
  - Currency fallback: `$${amount.toFixed(2)}` hardcoded in cart drawer — should use locale

### P2d — Accessibility Gaps

- [ ] **Add missing ARIA attributes**
  - `EPVariationOptionList` — needs `role="listbox"`, `aria-label`
  - `EPCartItemQuantityButton` — needs `aria-label` for +/- buttons
  - `MultiLocationStock` — interactive selection without proper ARIA
  - `ParentProductOption` — component selection without labels
  - Add `aria-live` regions for stock status changes

---

## P3 — Test Coverage

### Current Coverage (11 test suites, 174 tests, all passing)

- [x] `bundle/hooks/__tests__/useBundleConfigurationOrchestration.test.tsx` (14 tests)
- [x] `bundle/hooks/__tests__/use-parent-products.test.tsx` (12 tests)
- [x] `bundle/hooks/__tests__/use-bundle-option-products.test.tsx` (12 tests)
- [x] `bundle/utils/__tests__/configurationComparison.test.ts` (11 tests)
- [x] `bundle/utils/__tests__/priceCalculation.test.ts` (9 tests)
- [x] `bundle/utils/__tests__/productValidation.test.ts` (9 tests)
- [x] `cart/utils/__tests__/cartDataBuilder.test.ts` (34 tests)
- [x] `inventory/utils/__tests__/displayHelpers.test.ts` (24 tests)
- [x] `inventory/utils/__tests__/stockCalculations.test.ts` (23 tests)
- [x] `inventory/utils/__tests__/stockValidation.test.ts` (20 tests)
- [x] `test/normalize.spec.ts` (10 tests)

### Missing Test Coverage (by priority)

- [ ] **Tests for new composable bundle components** (P1 deliverables)
- [ ] **Tests for cart hooks** — `use-add-item`, `use-cart`, `use-remove-item`, `use-update-item`
- [ ] **Tests for inventory hooks** — `use-stock`, `use-locations`
- [ ] **Tests for bundle form hooks** — `useBundleForm`, `useBundleFormSync`, `useVariationSelection`
- [ ] **Tests for checkout API endpoints** — `calculate-shipping`, `create-order`, `setup-payment`, `confirm-payment`
- [ ] **Tests for cart drawer components** — 10 components with no test coverage
- [ ] **Tests for inventory components** — `LocationSelector`, `MultiLocationStock`, `StockIndicator`
- [ ] **Tests for utils** — `errorHandling.ts`, `logger.ts`, `cookies.ts`, `cart-cookie.ts`

---

## Out of Scope

Per specs, the following are explicitly out of scope:

- Removing/deprecating the monolithic `EPBundleConfigurator` (keep for backwards compatibility)
- Bundle item display in cart drawer (separate feature)
- Nested bundles
- Bundle inventory/stock checking at option level
- Changing the EP API contract (SDK calls remain the same)
- Modifying `cartDataBuilder.ts` bundle integration (already works)
- Changes to `normalize.ts` for bundle product display

---

## Architecture Notes

### Established Patterns to Follow

| Pattern | Reference Implementation |
|---------|------------------------|
| DataProvider/useSelector | `cart-drawer/EPCartItemList.tsx`, `stock/EPStockProvider.tsx` |
| SWR caching | `inventory/use-stock.tsx`, `inventory/use-locations.tsx` |
| Error handling | `inventory/use-stock.tsx` with `handleAPIError()` |
| Design-time preview | `cart-drawer/EPCartDrawer.tsx` with `previewState` prop |
| Component registration | `cart-drawer/` — field components registered before parents |
| Accessibility | `registerEPAddToCartButton.tsx`, `cart-drawer/EPCartItemRemoveButton.tsx` |
| Module-level state | `cart-drawer/CartDrawerContext.tsx` — listener pattern |
| Optimistic UI | `cart-drawer/EPCartItemQuantityControl.tsx` |
| Keyboard navigation | `utils/useRovingTabIndex.ts` |

### Key Shared Libraries

| Library | Location | Purpose |
|---------|----------|---------|
| Cart hooks | `cart/` | Add, remove, update cart items |
| Cart drawer | `cart-drawer/` | Composable cart UI components |
| Inventory hooks | `inventory/` | Stock and location data with SWR |
| Utils | `utils/` | Normalization, errors, logging, cookies, mock data |
| Bundle utils | `bundle/utils/` | Selection, validation, pricing, schema, comparison |
