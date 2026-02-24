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

- [x] **Implement URL param restoration on mount** — `useBundleForm` now reads `?bundle_config=` from the URL as the highest priority default configuration. The `getUrlBundleConfig()` helper reads the URL parameter (same base64 format as the `defaultConfiguration` prop). Priority chain: URL param > `defaultConfiguration` prop > API config > auto-select. Reset also respects URL param. 4 new tests in `useBundleForm.test.tsx`.

### Testing Discovery

esbuild jest transform hoists `import` to `require()` at file top, BEFORE `jest.mock()` calls. Fix: use `require()` for code-under-test so esbuild doesn't hoist it.

---

## P1 — Composable Bundle Configurator Components

**Spec:** `specs/composable-bundle-configurator.md`
**Status:** All 14 components implemented in `src/bundle/composable/`. 4 bugs fixed, 79 component tests added. Build passes, 451 tests pass (24 suites).

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
  - Include `parentComponentName` hints — Added to all 13 child components, mapping each to its logical parent's registration `name`. EPBundleProvider (root) has no parent.
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

### P1h — Known Issues (fixed)

- [x] **Variation selection uses label strings as keys** — `EPBundleVariationOptionList` and `EPBundleVariationPicker` matched variation options by `label` (name string) rather than option ID. Duplicate-named variation options would break selection. Fixed: all variation selection now uses option IDs throughout the pipeline. `EPBundleVariationPicker` passes `{ id, label }` value objects (not bare labels). `EPBundleVariationOptionList` compares `selectedForThisAxis === v.id` (not `v.label`). `EPBundleVariationOptionTrigger` dispatches `optionId` (not label) to `selectVariation`. `findMatchingVariant` does direct ID comparison against variation matrix option IDs. `BundleVariationContextValue.selectedValues` maps `variationId → optionId`. Design-time mock data updated with `id` fields. 3 test files updated to use option IDs in assertions.

- [x] **Option product metadata shows parent info, not selected child** — `EPBundleComponentList` looked up `optionProducts[optionId]` by parent ID only. Fixed: when a `parentId:childId` selection key is found, extracts the childId and uses `optionProducts[childId]` for metadata (name, price, image, sku), with fallback to parent product data for unselected options. 3 new tests verify child variant display, parent fallback, and mixed plain+parent selections. `useBundleOptionProducts` already fetches child product metadata — it was stored but never looked up.

---

## P2 — Code Quality & Consistency

These are lower priority but improve maintainability and align with established patterns.

### P2a — Type Safety

- [x] **Eliminate `(provider as any)` casts** — Done. Created `utils/getEPClient.ts` utility that centralizes the single type assertion (`provider` → `{ client: Client }`). Replaced 15 occurrences across 7 files. Typed `ElasticPathProvider.client` as `Client` (from `@epcc-sdk/sdks-shopper`) instead of `any`. Removed unused `auth: any` from `ElasticPathProvider` type.

- [x] **Eliminate other `as any` casts** — Done. Reduced production `as any` from 53 to 0 (1 remains only in a code comment). Changes across 13 files:
  - Created `utils/getLocationSlug.ts` utility (see P2c below)
  - `normalize.ts`: Imported `CartItemObject`, `Variation`, `VariationOption` from SDK; created `VariationMatrixEntry` recursive type; narrowed cart item union type
  - `use-product.tsx`: Created `ProductWithInitialVariant` interface; accessed `base_product_id` from typed `ProductAttributes`
  - `EPVariationPicker.tsx`: Used `Product & { __initialVariantId?: string }` instead of `as any`
  - `use-update-item.tsx`: Typed location access via `{ quantity?: number; location?: string }`, typed mutate return, used `Partial<CartItemBody>` for fetcher item
  - `EPCartItemQuantityControl.tsx`: Used `{ id: string; quantity: number; location?: string }` instead of `as any`
  - `use-parent-products.tsx`: Imported `Variation`, `VariationOption`, `ProductAttributes` from SDK; typed variationMatrix as `Record<string, unknown>`; typed `bundle_excluded` access via `Record<string, unknown>`
  - `StockContext.tsx`: Created `SymbolRecord` type alias for `globalThis` cast
  - `use-bundle-configuration.tsx`: Used `unknown as Record<string, Record<string, BigInt>>` (SDK expects BigInt but JSON requires number)
  - `EPCartDrawer.tsx`: Used `type: "eventHandler" as const` (matching pattern from other components); typed reduce callback
  - **Bug fix:** `EPBundleProvider.tsx` and `registerEPBundleConfigurator.tsx` — Fixed `configuredBundle as any` by extracting `.data` from `ProductData`. Previously passed `ProductData` wrapper where `ElasticPathBundleProduct` was expected, causing configured bundle price to silently fall back to unconfigured price.
  - **Bug fix:** `use-add-item.tsx` — Fixed missing `provider!.locale` parameter in `normalizeCart()` call. All other cart hooks (`useCart`, `useUpdateItem`, `useRemoveItem`) already passed locale; `useAddItem` was the only one missing it. Without locale, cart normalization could produce incorrect currency/price formatting for non-default locales.

### P2b — Error Handling Standardization

- [x] **Standardize error handling across all hooks** — Done. All 7 hook files now use `handleAPIError(error, context)` from `utils/errorHandling.ts`. Added missing error handling to `use-categories.tsx` (had no try/catch at all). Replaced manual `error instanceof Error ? error.message : String(error)` patterns with standardized `handleAPIError()`. Cart hooks' 404 status check preserved (uses `Record<string, unknown>` instead of `as any`).

- [x] **`extractErrorMessage()` pattern eliminated** — All hooks now use `handleAPIError()` which handles the `error instanceof Error` check internally. No more manual error message extraction in hook files.

### P2c — Utility Consolidation

- [x] **Create `getLocationSlug(location)` utility** — Done. Created `utils/getLocationSlug.ts` that extracts `location.attributes?.slug || location.id || ""`. Fixed 10 `as any` casts across 5 files:
  - `stockCalculations.ts` (4 casts): Fixed synthetic location shape to match SDK `Location` type with `type: "inventory_location"` and `attributes: { name, slug }`
  - `displayHelpers.ts` (1 cast): Typed `location` parameter as `Location`, replaced `(loc.attributes as any)?.slug`
  - `EPStockProvider.tsx` (1 cast): Replaced `(ls.location as any).slug`
  - `EPCartItemList.tsx` (2 casts): Replaced `(item as any).locationSlug` and `(ls.location as any).slug`
  - `MultiLocationStock.tsx` (2 casts): Replaced `(location?.attributes as any)?.slug`

- [x] **Centralize hardcoded configuration values** — Done. All magic numbers replaced with named constants from `const.ts`. Duplicate `formatCurrency` functions (5 copies) consolidated into shared `utils/formatCurrency.ts`. Changes across 20 files:
  - **`const.ts`**: Added `DEFAULT_DEBOUNCE_MS` (500), `FOCUS_TRAP_DELAY_MS` (50), `DEFAULT_LOW_STOCK_THRESHOLD` (5), `DEFAULT_MEDIUM_STOCK_THRESHOLD` (20), `SWR_DEDUPING_INTERVAL_SHORT` (60s), `SWR_DEDUPING_INTERVAL_LONG` (5min), `DEFAULT_CURRENCY_CODE` ("USD")
  - **`utils/formatCurrency.ts`**: Created shared utility with two entry points — `formatCurrency(amount, currencyCode)` for display-unit amounts (browser locale) and `formatCurrencyFromCents(amountInCents, currencyCode)` for cent-based amounts (en-US locale). 13 tests in `utils/__tests__/formatCurrency.test.ts`.
  - **Debounce** (4 files): `cart/use-update-item.tsx`, `bundle/hooks/useBundleConfigurationOrchestration.tsx`, `registerEPBundleConfigurator.tsx`, `bundle/composable/EPBundleProvider.tsx` — all use `DEFAULT_DEBOUNCE_MS`
  - **Stock thresholds** (7 files): `cart-drawer/EPCartItemList.tsx`, `inventory/utils/stockValidation.ts`, `inventory/utils/displayHelpers.ts`, `inventory/components/StockIndicator.tsx`, `inventory/components/MultiLocationStock.tsx`, `stock/EPStockProvider.tsx`, `registerEPMultiLocationStock.tsx` — all use `DEFAULT_LOW_STOCK_THRESHOLD` / `DEFAULT_MEDIUM_STOCK_THRESHOLD`
  - **SWR intervals** (4 files): `inventory/use-stock.tsx`, `inventory/use-locations.tsx`, `bundle/use-bundle-option-products.tsx`, `bundle/use-parent-products.tsx` — use `SWR_DEDUPING_INTERVAL_SHORT` / `SWR_DEDUPING_INTERVAL_LONG`
  - **Currency formatting** (5 files): `cart-drawer/EPCartDrawer.tsx`, `cart-drawer/EPCartItemList.tsx` — import shared `formatCurrency`; `api/endpoints/order/get-order.ts`, `checkout/components/EPOrderSummary.tsx`, `checkout/components/EPPaymentForm.tsx` — import shared `formatCurrencyFromCents`; `api/utils/api-helpers.ts` — re-exports `formatCurrencyFromCents` as `formatCurrency` for backwards compatibility
  - **Currency default** (2 files): `cart-drawer/EPCartDrawer.tsx`, `cart-drawer/EPCartItemList.tsx` — use `DEFAULT_CURRENCY_CODE` instead of hardcoded `"USD"`
  - **Focus trap** (1 file): `cart-drawer/EPCartDrawer.tsx` — uses `FOCUS_TRAP_DELAY_MS`

### P2d — Accessibility Gaps

- [x] **Add missing ARIA attributes**
  - `EPVariationOptionList` — already has `role="radiogroup"`, `aria-label`, and roving tab index (no changes needed)
  - `EPCartItemQuantityButton` — already has `aria-label` ("Increase/Decrease quantity"), `role="button"`, `aria-disabled` (no changes needed)
  - `MultiLocationStock` — Added `role="region"` with `aria-label="Stock availability"` to outer container, `role="list"` with `aria-label="Stock by location"` to locations container, `role="listitem"` to each location entry. Removed unused `calculateTotalStock` import.
  - `ParentProductOption` — Added `htmlFor`/`id` to associate `<label>` with `<input>`. Added `aria-expanded` and `aria-label` to the "Show/Hide Variations" toggle button.
  - `StockIndicator` — Added `role="status"` and `aria-live="polite"` for dynamic stock status announcements. Added `aria-hidden="true"` to decorative emoji icons.

---

## P3 — Test Coverage

### Current Coverage (35 test suites, 838 tests, all passing)

- [x] `bundle/composable/__tests__/composable-bundle-components.test.tsx` (79 tests) — Field rendering, option triggers (click/keyboard/ARIA), quantity button bounds enforcement, quantity control DataProvider shape, component/option/variation list iteration, child variant metadata display, design-time mock data validation
- [x] `bundle/hooks/__tests__/useBundleConfigurationOrchestration.test.tsx` (14 tests)
- [x] `bundle/hooks/__tests__/useBundleForm.test.tsx` (21 tests) — Form initialization, handleComponentSelection (set/clear/parent:child keys/single-select clearing/zero removal), handleSubmit, reset, error conversion, useApiFormattedSelections, URL param restoration (highest priority, override prop, fallback to prop, reset reads URL)
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
- [x] `cart/__tests__/use-cart.test.tsx` (9 tests) — Cart retrieval, creation, cookie management, locale passthrough, error recovery
- [x] `cart/__tests__/use-add-item.test.tsx` (12 tests) — Item validation, cart auto-creation, manageCarts API call, locale passthrough (bug fix verified), error handling
- [x] `cart/__tests__/use-update-item.test.tsx` (15 tests) — Quantity update, removal delegation (qty < 1), ValidationError for non-integers, location passthrough for multi-location inventory, 404 cookie cleanup
- [x] `cart/__tests__/use-remove-item.test.tsx` (12 tests) — deleteACartItem API call (not qty-to-zero), cart refresh after deletion, cookie cleanup on 404, guard conditions
- [x] `inventory/__tests__/use-stock.test.tsx` (25 tests) — SWR caching, stable sorted query keys, multi-product parallel fetching, per-product error degradation (returns zero-stock), locationIds passthrough, useProductStock wrapper, refetch, disabled state
- [x] `inventory/__tests__/use-locations.test.tsx` (19 tests) — SWR caching (5min deduping), type filter passthrough, "__all__" default key, empty/null response handling, refetch, disabled state, error propagation
- [x] `utils/__tests__/errorHandling.test.ts` (51 tests) — All 8 exported functions, EPErrorCode enum verification, ISO timestamp validation, details passthrough, error code categorization (network/API/unknown), user-friendly message mapping, recoverable error classification, logError integration, createFormContextError
- [x] `utils/__tests__/logger.test.ts` (35 tests) — Default silent behavior, "*" wildcard, level-only config, "level:modules" format, module filtering, console method mapping, data parameter passthrough, tag format, resetLogConfig cache clearing, SSR fallback, localStorage errors
- [x] `utils/__tests__/cookies.test.ts` (10 tests) — getCookies JSON parsing, undefined for missing cookies, setCookies with options (expires, sameSite, secure), removeCookies delegation
- [x] `utils/__tests__/cart-cookie.test.ts` (8 tests) — getCartId/setCartId/removeCartCookie delegation to cookies module with correct ELASTICPATH_CART_COOKIE constant
- [x] `utils/__tests__/formatCurrency.test.ts` (13 tests) — formatCurrency (6): USD/GBP/zero/default/invalid fallback/negative; formatCurrencyFromCents (7): division by 100, zero cents, sub-dollar, uppercase, default, invalid fallback, en-US comma grouping
- [x] `api/endpoints/checkout/__tests__/calculate-shipping.test.ts` (32 tests) — Environment validation, HTTP method validation, request body/address validation, successful rate calculation, EP response field mapping with defaults, EP API error handling, shipping address passthrough
- [x] `api/endpoints/checkout/__tests__/create-order.test.ts` (34 tests) — Method/body validation, checkout form validation, data sanitization, successful order creation with 201, EP order transformation (total/subtotal/tax/shipping/customer/relationships), status mapping (6 known + unknown fallback), EP error handling
- [x] `api/endpoints/checkout/__tests__/setup-payment.test.ts` (25 tests) — Method/body/amount validation, gateway validation, minimum amount ($0.50), Stripe PaymentIntent creation, EP paymentSetup call, success response with clientSecret/transactionId, EP failure rollback (cancels Stripe intent), missing client_secret handling
- [x] `api/endpoints/checkout/__tests__/confirm-payment.test.ts` (36 tests) — ID format validation (pi_ prefix), Stripe PaymentIntent retrieval/status check, metadata order_id matching, EP confirmPayment call, order transformation, payment status mapping (7 values), order status mapping (5 values), post-payment actions
- [x] `inventory/components/__tests__/inventory-components.test.tsx` (33 tests) — StockIndicator (14): stock levels/messages/colors/ARIA, LocationSelector (8): loading/empty/select/callback, MultiLocationStock (11): all states/ARIA roles/location list/summary
- [x] `cart-drawer/__tests__/cart-drawer-components.test.tsx` (110 tests) — CartDrawerContext singleton (8): state get/set/toggle/subscribe/unsubscribe/useDrawerOpen hook sync. EPCartDrawer (18): runtime open/close/portal, loading/error/empty content, Escape close, body scroll lock, backdrop click, side prop, editor inline render, previewState variants. EPCartDrawerTrigger (10): toggle/open/close actions, ARIA label singular/plural, aria-expanded, keyboard Enter/Space, editor no-op, mock count. EPCartField (9): all 5 field types, boolean stringify, null fallback, editor/previewState mock. EPCartItemField (13): all field types, options join formatting, null/editor fallback. EPCartItemImage (7): img render with attributes, placeholder SVG sizing, ARIA labels, loading prop. EPCartItemList (9): list/listitem structure, repeatedElement calls, maxItems, location/stock fetch gating, editor/previewState mock. EPCartItemQuantityControl (10): context provision, min/max bounds, optimistic increment/decrement, location passthrough, error revert, previewState variants. EPCartItemQuantityButton (12): increment/decrement calls, disabled states, previewState override, ARIA labels, keyboard events, null context safety. EPCartItemRemoveButton (9): remove call, null guard, error loading cleanup, ARIA label with/without name, keyboard events, previewState mock.

### Missing Test Coverage (by priority)

- [x] **Tests for new composable bundle components** (P1 deliverables) — 79 tests covering field components, interactive triggers, quantity controls, list iteration, child variant metadata, and design-time preview
- [x] **Tests for bundle form hooks** — `useBundleForm` (17 tests), `useBundleFormSync` (12 tests), `useVariationSelection` (9 tests) — form state, selection handling, parent form sync, URL sync, variation resolution
- [x] **Tests for bundle schemas** — `bundleSchema` (16 tests) — Zod schema creation, validation, default value computation with priority chain
- [x] **Tests for bundle utils** — `bundleSelectionUtils` (24 tests), `variationMatching` (13 tests) — sorting, API conversion, equality checks, default selections, variation matrix traversal
- [x] **Tests for cart hooks** — 49 tests across 4 hooks: `use-cart` (9), `use-add-item` (12), `use-update-item` (15), `use-remove-item` (12). Covers cart lifecycle, error handling, cookie management, locale passthrough, removal delegation, and multi-location inventory support.
- [x] **Tests for inventory hooks** — `use-stock` (25 tests), `use-locations` (19 tests). Covers SWR caching, query key stability, multi-product fetching, per-product error graceful degradation, type filtering, useProductStock convenience wrapper, refetch/mutate, disabled state.
- [x] **Tests for checkout API endpoints** — `calculate-shipping` (32 tests), `create-order` (34 tests), `setup-payment` (25 tests), `confirm-payment` (36 tests). Covers all 4 handlers end-to-end: validation, SDK calls, Stripe integration, error handling, response transformation.
- [x] **Tests for cart drawer components** — 110 tests across 10 components: CartDrawerContext (8), EPCartDrawer (18), EPCartDrawerTrigger (10), EPCartField (9), EPCartItemField (13), EPCartItemImage (7), EPCartItemList (9), EPCartItemQuantityControl (10), EPCartItemQuantityButton (12), EPCartItemRemoveButton (9). Covers singleton state management, portal rendering, optimistic quantity updates, error recovery, ARIA accessibility, keyboard navigation, focus trap, body scroll lock, previewState design-time variants, and location/stock data enrichment.
- [x] **Tests for inventory components** — `LocationSelector` (8 tests), `MultiLocationStock` (11 tests), `StockIndicator` (14 tests). Covers rendering states, ARIA roles, hook mocking, user interaction.
- [x] **Tests for utils** — `errorHandling.ts` (51 tests), `logger.ts` (35 tests), `cookies.ts` (10 tests), `cart-cookie.ts` (8 tests), `formatCurrency.ts` (13 tests). Covers all exported functions, config parsing, localStorage mocking, SSR fallback, cache lifecycle, cookie options passthrough, currency formatting with display-unit and cent-based entry points.

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
