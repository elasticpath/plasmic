# Implementation Plan — EP Components Cart Work

> Auto-generated from analysis of `specs/*` vs `plasmicpkgs/commerce-providers/elastic-path/src/*`
> Last updated: 2025-02-24

---

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Complete

---

## P0 — Bundle Hooks Rework (Foundation for Composable Components)

**Spec:** `specs/bundle-hooks-rework.md`
**Why first:** The composable bundle configurator (P1) depends on clean, SWR-cached hooks. Currently all bundle data-fetching hooks use raw `useEffect`/`useState` instead of the `useMutablePlasmicQueryData` SWR pattern established in `inventory/use-stock.tsx` and `inventory/use-locations.tsx`.

- [ ] **Migrate `use-bundle-option-products.tsx` to SWR caching**
  - Currently: raw `useState` + `useEffect` with batch fetch and `useMemo` memoization
  - Target: `useMutablePlasmicQueryData` with stable query key based on bundle product ID and component option IDs
  - Key: `["ep-bundle-option-products", bundleProductId, sortedOptionIds]`
  - Options: `revalidateOnFocus: false`, `dedupingInterval: 60_000`

- [ ] **Migrate `use-parent-products.tsx` to SWR caching**
  - Currently: raw `useState` + `useEffect` with two-phase fetch (bulk products, then children)
  - Target: `useMutablePlasmicQueryData` with stable query key
  - Key: `["ep-parent-products", sortedComponentOptionIds]`
  - Preserve: parent detection via `relationships.children` / `attributes.base_product`, excluded variant handling

- [ ] **Evaluate and clean up `useBundleState` vs `useBundleForm`**
  - `useBundleState` (`bundle/hooks/useBundleState.tsx`) appears partially superseded by `useBundleForm`
  - Determine if `useBundleState` is still needed or can be consolidated into `useBundleForm`
  - If removed, update all consumers

- [ ] **Clean up `useBundleConfigurationOrchestration` state management**
  - Currently: raw `useState` + `useEffect` + `useRef` with debounce library
  - Target: cleaner state management while preserving debounce/deduplication behavior
  - `useBundleConfiguration` (imperative callback) does NOT need SWR — it's a mutation, not a query

- [ ] **Ensure `useVariationSelection` is reusable for new `EPBundleVariationPicker`**
  - Currently: `useState` + `useCallback` — suitable pattern for local state
  - Target: verify API is clean enough for the composable `EPBundleVariationPicker` component
  - Preserve: `findMatchingVariant` with `parentId:childId` key format

- [ ] **Verify `useBundleFormSync` works for composable components**
  - Currently: writes `BundleConfiguration` and `ConfiguredBundleId` to parent react-hook-form context
  - Target: confirm it works when form context comes from `EPBundleProvider` rather than monolithic configurator
  - URL sync with `?bundle=` base64 config must continue working

- [ ] **Ensure existing tests still pass**
  - `bundle/hooks/__tests__/useBundleConfigurationOrchestration.test.tsx` (11 tests)
  - `bundle/utils/__tests__/configurationComparison.test.ts` (11 tests)
  - `bundle/utils/__tests__/priceCalculation.test.ts` (9 tests)
  - `bundle/utils/__tests__/productValidation.test.ts` (9 tests)
  - Add new tests for refactored hook interfaces

---

## P1 — Composable Bundle Configurator Components

**Spec:** `specs/composable-bundle-configurator.md`
**Status:** 0 of 14 components implemented. Only the monolithic `EPBundleConfigurator` exists (registered in `index.tsx` with comment "to be reworked in future").

### P1a — Root Provider & Summary Components

- [ ] **`EPBundleProvider`** — Root DataProvider for bundle state
  - Reads `currentProduct` from ancestor via `useSelector`
  - Validates product is a bundle, extracts components
  - Manages bundle form state (selections, quantities)
  - Orchestrates debounced `configureByContextProduct` API calls
  - Writes `BundleConfiguration` and `ConfiguredBundleId` to parent react-hook-form
  - Syncs state to/from URL when `updateUrlOnChange` is true
  - Restores defaults: URL > API config > auto-select (priority order)
  - Provides: `bundleData` DataProvider key
  - Register with `providesData: true`

- [ ] **`EPBundlePriceField`** — Displays current bundle price
  - Reads from `bundleData` context
  - Handles fixed vs cumulative pricing
  - Updates after `configureByContextProduct` success
  - Internal `BundlePrice.tsx` exists but is not registered

- [ ] **`EPBundleValidationErrors`** — Renders validation errors
  - Reads from `bundleData` context
  - Zod schema validation from component min/max and option constraints
  - Internal `ValidationErrors.tsx` exists but is not registered

### P1b — Component Iteration Layer

- [ ] **`EPBundleComponentList`** — Iterator over bundle components
  - Iterates sorted by `sort_order`
  - Provides per-iteration: `currentBundleComponent` and `currentBundleComponentIndex`
  - Data shape: `{ name, key, min, max, selectedCount, isValid, options[], sortOrder }`

- [ ] **`EPBundleComponentField`** — Display field for component metadata
  - Reads from `currentBundleComponent`
  - Fields: name, min, max, selectedCount, isValid, optionCount

### P1c — Option Iteration & Selection Layer

- [ ] **`EPBundleOptionList`** — Iterator over options within a component
  - Provides per-iteration: `currentBundleOption` and `currentBundleOptionIndex`
  - Data shape: `{ id, name, quantity, minQty, maxQty, isSelected, isParentProduct, price, imageUrl, sortOrder, isDefault }`

- [ ] **`EPBundleOptionField`** — Display field for option details
  - Reads from `currentBundleOption`
  - Fields: name, price, imageUrl, quantity, etc.

- [ ] **`EPBundleOptionTrigger`** — Interactive selection trigger
  - Checkbox-like (multi-select) or radio-like (single-select) based on min/max
  - Provides `BundleOptionContext` for quantity buttons
  - Exposes `data-selected` attribute for CSS styling
  - Uses `role="checkbox"` or `role="radio"` with `aria-checked`

### P1d — Quantity Controls

- [ ] **`EPBundleOptionQuantityControl`** — Quantity state container
  - Manages quantity for current option
  - Respects option-level min/max constraints
  - Provides: `bundleOptionQuantity` DataProvider key
  - Provides: context for `EPBundleOptionQuantityButton`
  - Triggers debounced reconfiguration

- [ ] **`EPBundleOptionQuantityButton`** — Increment/decrement button
  - Reads from `BundleOptionContext`
  - `action: "increment" | "decrement"` prop
  - Disables at min/max bounds

### P1e — Parent Product Variation Layer

- [ ] **`EPBundleVariationPicker`** — Variation axes iterator for parent options
  - Detects parent products, fetches children
  - Provides: `currentBundleVariation` and `currentBundleVariationIndex`
  - Data shape: `{ id, name, values: { label }[] }`

- [ ] **`EPBundleVariationOptionList`** — Values iterator per variation axis
  - Provides: `currentBundleVariationOption` and `currentBundleVariationOptionIndex`
  - Data shape: `{ label, isSelected }`

- [ ] **`EPBundleVariationField`** — Display field for variation axis info
  - Reads from `currentBundleVariation`

- [ ] **`EPBundleVariationOptionTrigger`** — Interactive variation value selector
  - Selects variation value via `BundleVariationContext`
  - Resolves matching child variant
  - Replaces parent ID with `parentId:childId` key

### P1f — Registration & Integration

- [ ] **Create `register*` functions for all 14 components**
  - Include `parentComponentName` hints
  - Include `providesData: true` where applicable
  - Include `previewState` props for design-time preview on every component

- [ ] **Add all components to `registerAll()` in `index.tsx`**
  - Register field components before parent components (existing convention)
  - Keep monolithic `EPBundleConfigurator` for backwards compatibility

- [ ] **Design-time preview mock data**
  - Covers: multi-component bundle, single-select, multi-select, parent products with variations, fixed pricing, cumulative pricing
  - Add to `utils/design-time-data.ts`

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

### Current Coverage (9 test files, 200+ tests, all passing)

- [x] `bundle/utils/__tests__/configurationComparison.test.ts` (11 tests)
- [x] `bundle/utils/__tests__/priceCalculation.test.ts` (9 tests)
- [x] `bundle/utils/__tests__/productValidation.test.ts` (9 tests)
- [x] `bundle/hooks/__tests__/useBundleConfigurationOrchestration.test.tsx` (11 tests)
- [x] `cart/utils/__tests__/cartDataBuilder.test.ts` (34 tests)
- [x] `inventory/utils/__tests__/displayHelpers.test.ts` (24 tests)
- [x] `inventory/utils/__tests__/stockCalculations.test.ts` (23 tests)
- [x] `inventory/utils/__tests__/stockValidation.test.ts` (20 tests)
- [x] `test/normalize.spec.ts` (10 tests)

### Missing Test Coverage (by priority)

- [ ] **Tests for new composable bundle components** (P1 deliverables)
- [ ] **Tests for refactored bundle hooks** (P0 deliverables)
- [ ] **Tests for cart hooks** — `use-add-item`, `use-cart`, `use-remove-item`, `use-update-item`
- [ ] **Tests for inventory hooks** — `use-stock`, `use-locations`
- [ ] **Tests for bundle form hooks** — `useBundleForm`, `useBundleFormSync`, `useBundleState`, `useVariationSelection`
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
