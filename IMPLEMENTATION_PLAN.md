# Implementation Plan — EP Components Cart Work

> Source: `specs/*` vs `plasmicpkgs/commerce-providers/elastic-path/src/*`
> Last updated: 2026-02-24

---

## Current Status: ALL WORK COMPLETE

**Build:** Passes (tsdx build)
**Tests:** 910 tests across 52 suites — all passing (1 unrelated failure in `packages/cli` due to Node.js v22 + prettier incompatibility)
**Verification:** All spec acceptance criteria verified against source code on 2026-02-24

---

## Completed Work Summary

### P0 — Bundle Hooks Rework

All bundle data-fetching hooks migrated from raw `useEffect`/`useState` to SWR-cached `useMutablePlasmicQueryData` pattern. Legacy `useBundleState.tsx` removed. Orchestration hook cleaned up (structural comparison, single ref, error state). URL param restoration implemented with priority chain: URL > prop > API > auto-select.

### P1 — Composable Bundle Configurator (14 Components)

All 14 components implemented in `src/bundle/composable/`:

| Layer | Components |
|-------|-----------|
| Root | EPBundleProvider, EPBundlePriceField, EPBundleValidationErrors |
| Component iteration | EPBundleComponentList, EPBundleComponentField |
| Option iteration | EPBundleOptionList, EPBundleOptionField, EPBundleOptionTrigger |
| Quantity controls | EPBundleOptionQuantityControl, EPBundleOptionQuantityButton |
| Variation layer | EPBundleVariationPicker, EPBundleVariationOptionList, EPBundleVariationField, EPBundleVariationOptionTrigger |

All registered in `registerAll()` with `parentComponentName` hints, `providesData` where applicable, and `previewState` on every component. Design-time mock data covers multi-component bundles, single/multi-select, parent products with variations, fixed and cumulative pricing.

**Bugs fixed during P1:**
- Rules-of-hooks violation in EPBundleProviderInner (conditional hooks)
- EPBundleOptionQuantityButton min/max bounds bypass
- EPBundleOptionTrigger missing aria-label
- Variation selection used label strings instead of option IDs
- Option product metadata showed parent info instead of selected child variant

### P2 — Code Quality & Consistency

- **Type safety:** 53 `as any` casts eliminated (0 remain in production code)
- **Error handling:** All hooks standardized on `handleAPIError()` from `utils/errorHandling.ts`
- **Utilities:** `getEPClient.ts`, `getLocationSlug.ts`, `formatCurrency.ts` created; hardcoded values moved to `const.ts`
- **Accessibility:** ARIA attributes added to MultiLocationStock, ParentProductOption, StockIndicator
- **Bug fixes discovered:** `configuredBundle as any` hiding wrong data type; `use-add-item.tsx` missing locale param

### P3 — Test Coverage (35 EP test suites, 838+ tests)

Full test coverage across: composable components (79), bundle hooks (56), bundle schemas (16), bundle utils (61), cart hooks (49), inventory hooks (44), checkout endpoints (127), cart drawer components (110), inventory components (33), utilities (117), normalization (10), cart data builder (34).

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

### Established Patterns

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

### Key Learnings

- esbuild jest transform hoists `import` to `require()` before `jest.mock()`. Use `require()` for code-under-test.
- `sortByOrder` expects `sort_order` (snake_case) — enriched objects need both `sortOrder` and `sort_order` properties.
- SDK expects `BigInt` for bundle quantities but JSON requires `number` — type assertion at the boundary is necessary.
