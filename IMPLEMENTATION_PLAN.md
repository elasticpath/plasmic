# Implementation Plan — EP Components Cart Work

> Auto-generated from analysis of `specs/*` vs `plasmicpkgs/commerce-providers/elastic-path/src/*`
> Last updated: 2026-02-25

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
**Status:** All 14 components implemented in `src/bundle/composable/`. 4 bugs fixed, 79 component tests added. Build passes, 253 tests pass (12 suites).

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

### P1g — Bug Fixes (discovered during test coverage work)

- [x] **Fix rules-of-hooks violation in `EPBundleProviderInner`** — The inner component returned early before hooks were called when `validateBundleProduct()` failed. All hooks (`useBundleFormHook`, `useApiFormattedSelections`, `useBundleConfiguration`, `useBundleConfigurationOrchestration`, `useBundleFormSync`, `useParentProducts`, `useBundleOptionProducts`, and 4 `useMemo` calls) were called conditionally. Fixed by moving the early return to AFTER all hooks, passing safe defaults (`enabled: false`, empty `components: {}`) when product is invalid.

- [x] **Fix `EPBundleOptionQuantityButton` min/max bounds bypass** — The button called `optionCtx.setQuantity(quantity + 1)` without checking maxQty, and `Math.max(0, quantity - 1)` ignoring minQty. Fixed: button now reads `currentBundleOption` via `useSelector` to get minQty/maxQty, clamps values with `Math.min(max, quantity + 1)` / `Math.max(min, quantity - 1)`, and disables at bounds via `aria-disabled`.

- [x] **Fix `EPBundleOptionTrigger` missing aria-label** — Real options (with an `id`) had `aria-label={undefined}` because the label was only set when no id was present. Fixed: now always sets `aria-label={`Select ${name || "option"}`}`, reading `name` from `currentBundleOption` selector.

### P1h — Known Issues (not yet fixed)

- [ ] **Variation selection uses label strings as keys** — `EPBundleVariationOptionList` and `EPBundleVariationPicker` match variation options by `label` (name string) rather than option ID. Duplicate-named variation options would break selection. Low priority: rare in practice.

- [x] **Option product metadata shows parent info, not selected child** — `EPBundleComponentList` looked up `optionProducts[optionId]` by parent ID only. Fixed: when a `parentId:childId` selection key is found, extracts the childId and uses `optionProducts[childId]` for metadata (name, price, image, sku), with fallback to parent product data for unselected options. 3 new tests verify child variant display, parent fallback, and mixed plain+parent selections. `useBundleOptionProducts` already fetches child product metadata — it was stored but never looked up.

---

## P2 — Code Quality & Consistency

These are lower priority but improve maintainability and align with established patterns.

### P2a — Type Safety

- [x] **Eliminate `(provider as any)` casts** — Done. Created `utils/getEPClient.ts` utility that centralizes the single type assertion (`provider` → `{ client: Client }`). Replaced 15 occurrences across 7 files. Typed `ElasticPathProvider.client` as `Client` (from `@epcc-sdk/sdks-shopper`) instead of `any`. Removed unused `auth: any` from `ElasticPathProvider` type.

- [ ] **Eliminate other `as any` casts**
  - `(item as any).location` in cart hooks
  - `(item as any).custom_inputs` in normalize.ts
  - `(product as any)?.__initialVariantId` in variant picker
  - `(child.meta as any)?.bundle_excluded` in parent products hook
  - `globalThis as any` in StockContext.tsx

### P2b — Error Handling Standardization

- [x] **Standardize error handling across all hooks** — Done. All 7 hook files now use `handleAPIError(error, context)` from `utils/errorHandling.ts`. Added missing error handling to `use-categories.tsx` (had no try/catch at all). Replaced manual `error instanceof Error ? error.message : String(error)` patterns with standardized `handleAPIError()`. Cart hooks' 404 status check preserved (uses `Record<string, unknown>` instead of `as any`).

- [x] **`extractErrorMessage()` pattern eliminated** — All hooks now use `handleAPIError()` which handles the `error instanceof Error` check internally. No more manual error message extraction in hook files.

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

### Current Coverage (18 test suites, 354 tests, all passing)

- [x] `bundle/composable/__tests__/composable-bundle-components.test.tsx` (79 tests) — Field rendering, option triggers (click/keyboard/ARIA), quantity button bounds enforcement, quantity control DataProvider shape, component/option/variation list iteration, child variant metadata display, design-time mock data validation
- [x] `bundle/hooks/__tests__/useBundleConfigurationOrchestration.test.tsx` (14 tests)
- [x] `bundle/hooks/__tests__/useBundleForm.test.tsx` (17 tests) — Form initialization, handleComponentSelection (set/clear/parent:child keys/single-select clearing/zero removal), handleSubmit, reset, error conversion, useApiFormattedSelections
- [x] `bundle/hooks/__tests__/useVariationSelection.test.tsx` (9 tests) — Variation state management, matching variant resolution, clear-old/select-new variant, no-match handling, direct setVariationSelections
- [x] `bundle/hooks/__tests__/useBundleFormSync.test.tsx` (12 tests) — ConfiguredBundle sync to internal/parent forms, BigInt conversion, selected options sync, URL update with base64 bundle_config, guard conditions (not initialized, no parent form, empty selections)
- [x] `bundle/schemas/__tests__/bundleSchema.test.ts` (16 tests) — createBundleSchema (required/optional components, min/max validation, option-level quantity constraints, null defaults, parent:child keys), createOptionQuantitySchema, createBundleDefaultValues (priority: defaultConfiguration > API config > auto-select, BigInt conversion, invalid base64 handling)
- [x] `bundle/utils/__tests__/bundleSelectionUtils.test.ts` (24 tests) — sortByOrder (ascending, null/undefined at end, immutability), convertSelectionsForAPI (simple/parent:child/mixed keys, excluded fields), areSelectionsEqual (equal/unequal/missing components/different quantities), getDefaultSelections (default option, first fallback, optional skip, preserve existing, quantity defaults)
- [x] `bundle/utils/__tests__/variationMatching.test.ts` (13 tests) — getOptionsFromSkuId (flat/nested/deeply nested matrix, non-matching, empty), findMatchingVariant (complete/partial/empty selections, no children/matrix/variations, non-matching combination)
- [x] `bundle/__tests__/use-parent-products.test.tsx` (12 tests)
- [x] `bundle/__tests__/use-bundle-option-products.test.tsx` (12 tests)
- [x] `bundle/utils/__tests__/configurationComparison.test.ts` (11 tests)
- [x] `bundle/utils/__tests__/priceCalculation.test.ts` (9 tests)
- [x] `bundle/utils/__tests__/productValidation.test.ts` (9 tests)
- [x] `cart/utils/__tests__/cartDataBuilder.test.ts` (34 tests)
- [x] `inventory/utils/__tests__/displayHelpers.test.ts` (24 tests)
- [x] `inventory/utils/__tests__/stockCalculations.test.ts` (23 tests)
- [x] `inventory/utils/__tests__/stockValidation.test.ts` (20 tests)
- [x] `test/normalize.spec.ts` (10 tests)

### Missing Test Coverage (by priority)

- [x] **Tests for new composable bundle components** (P1 deliverables) — 79 tests covering field components, interactive triggers, quantity controls, list iteration, child variant metadata, and design-time preview
- [x] **Tests for bundle form hooks** — `useBundleForm` (17 tests), `useBundleFormSync` (12 tests), `useVariationSelection` (9 tests) — form state, selection handling, parent form sync, URL sync, variation resolution
- [x] **Tests for bundle schemas** — `bundleSchema` (16 tests) — Zod schema creation, validation, default value computation with priority chain
- [x] **Tests for bundle utils** — `bundleSelectionUtils` (24 tests), `variationMatching` (13 tests) — sorting, API conversion, equality checks, default selections, variation matrix traversal
- [ ] **Tests for cart hooks** — `use-add-item`, `use-cart`, `use-remove-item`, `use-update-item`
- [ ] **Tests for inventory hooks** — `use-stock`, `use-locations`
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
