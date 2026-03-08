# Implementation Plan

**Last updated:** 2026-03-08
**Branch:** `feat/ep-commerce-components`
**Focus:** Product Discovery — composable headless components for Elastic Path commerce in Plasmic Studio

## Status Summary

| Category | Count |
|----------|-------|
| Specs (EP Commerce) | 3 |
| Specs (MCP Server — out of scope) | 5 |
| Phases | 3 |
| Items to implement | 22 |
| Completed | 22 |

## Relevant Specs

| Spec | Phase | Priority | Status |
|------|-------|----------|--------|
| `product-discovery-core.md` | Phase 1 | P0 | COMPLETE |
| `catalog-search.md` | Phase 2 | P1 | COMPLETE |
| `related-products.md` | Phase 3 | P2 | COMPLETE |

## Out-of-Scope Specs (MCP Server, not EP Commerce)

These specs live in `.ralph/specs/` but target `packages/plasmic-mcp/`, not the EP commerce components:
- `batch-architecture-research.md`
- `element-styling-dx.md`
- `interaction-improvements.md`
- `toggle-variant-state-linking.md`
- `visibility-api-polish.md`

---

## Confirmed Findings (2026-03-08)

### Implementation Notes (2026-03-08)

#### Phase 1 Complete
- All 8 items implemented and tested (879 tests pass, 36 suites)
- Build succeeds via `yarn build` (tsdx)
- `ComponentMeta` type inference requires `as any` on the `props` field for EPProductGrid (TypeScript union narrowing issue with slot defaultValue content)
- Product type has optional `slug`, `path`, `currencyCode` fields — handled with `?? ""` fallbacks in `buildCurrentProduct()`
- `useSelector` mock in tests must use delegation pattern `(...args) => mockUseSelector(...args)` not direct `jest.fn()` — esbuild import hoisting requires this
- Test file must use `/** @jest-environment jsdom */` docblock (not `//` single-line comment) for jsdom environment

#### Phase 2 Complete
- All 10 items implemented and tested (958 tests pass, 38 suites)
- Build succeeds via `yarn build` (tsdx) in ~10 minutes
- Dependencies installed: `@elasticpath/catalog-search-instantsearch-adapter@0.0.5` (exact-pinned), `react-instantsearch@^7.26`, `react-instantsearch-nextjs@^0.3`, `instantsearch.js@^4.90`
- Adapter uses default export pattern: `require("...").default` — creates `new CatalogSearchInstantSearchAdapter({ client })` which exposes `.searchClient`
- All components use dynamic `require()` for react-instantsearch hooks to avoid hard dependency at build time when in design mode
- `import { type X }` inline syntax NOT supported by tsdx's TypeScript — must use separate `import type { X }` statements
- Zod 3.25.x has breaking type changes vs @hookform/resolvers — fixed with `as any` cast on `zodResolver(bundleSchema)` call
- Mock data uses "sample-cs-" prefix IDs, distinct from Phase 1 "sample-pd-" and Phase 3 "sample-rp-" prefixes
- `EPSearchHits` normalizes hits via `normalizeHitToCurrentProduct()` with fallback field patterns for EP catalog search adapter output

#### Phase 3 Complete
- All 4 items implemented and tested (918 tests pass, 37 suites)
- Build succeeds via `yarn build` (tsdx)
- `useRelatedProducts` hook calls `getByContextAllRelatedProducts` from `@epcc-sdk/sdks-shopper` — SDK function confirmed available
- Hook lives at `src/product-discovery/use-related-products.tsx` (not `src/product/` as originally planned — collocated with the provider for module coherence)
- `SWR_DEDUPING_INTERVAL_LONG` imported from `../const` (root `src/const.ts`), NOT `../utils/const.ts` (which doesn't exist)
- EPRelatedProductsProvider uses inner component pattern (`EPRelatedProductsProviderInner`) to avoid conditional hook calls in preview branches
- Provider exposes both `productGridData` (shared D4 key for EPProductGrid reuse) and `relatedProductsData` (relationship-specific metadata)
- Mock data: 4 distinct products with `sample-rp-*` IDs, separate from Phase 1 `sample-pd-*` listing mocks
- Auto-reads product ID from parent `currentProduct` DataProvider context; overridable via `productId` prop

### No Skipped/Flaky Tests, No Relevant TODOs

- Searched all test files — no `.skip()`, `xit()`, `xdescribe()`, `xtest()` patterns
- Only TODOs found are in checkout (address validation) and site (use-brands stub) — both unrelated
- No `FIXME` patterns found

### Existing Utilities Available for Reuse

- `src/utils/normalize.ts` — `normalizeProduct()` and `normalizeProductFromList()` (convert EP SDK → commerce types)
  - `normalizeProductFromList()` accepts optional `included` object with `main_images` and `files` arrays
  - Price: reads `meta.display_price.without_tax`, divides by 100 (EP stores cents)
  - Images: resolved from `included.main_images[]` and `included.files[]`
- `src/utils/formatCurrency.ts` — `formatCurrency(amount, currencyCode)` using `Intl.NumberFormat`; also `formatCurrencyFromCents(amountInCents, currencyCode)`
- `src/utils/design-time-data.ts` — Mock data infrastructure (`MOCK_` prefix pattern)
- `src/utils/get-sort-variables.ts` — Sort string mapping (`price-asc` → `price asc`, etc.)
- `src/product/use-search.tsx` — Reference for `getByContextAllProducts` SDK call pattern (returns `{ products, found }`, no pagination)
- `src/utils/errorHandling.ts` — `EPErrorCode` enum, `createEPError()`, `handleAPIError()`, `formatUserErrorMessage()`
- `src/utils/getEPClient.ts` — Type-safe `getEPClient(provider)` extraction of EP SDK client
- `src/utils/const.ts` — `DEFAULT_CURRENCY_CODE = 'USD'`, SWR deduping intervals

### Data-Fetching Pattern (Confirmed)

All standalone data-fetching hooks use **`useMutablePlasmicQueryData`** from `@plasmicapp/query` (peer dependency). NOT raw SWR. Examples:
- `inventory/use-stock.tsx` — `useMutablePlasmicQueryData<Record<string, ProductStock>, Error>(queryKey, fetcher, { revalidateOnFocus: false, dedupingInterval })`
- `inventory/use-locations.tsx` — Same pattern with location-specific query key
- `bundle/use-bundle-option-products.tsx` — Batches 100-product chunks in single SWR call
- `bundle/use-parent-products.tsx` — Two-phase fetch within single SWR call

All return `{ data, loading, error, refetch: () => mutate() }` shape.

### EP SDK Pagination API (Confirmed)

`getByContextAllProducts` query params (typed as `BigInt`):
- `page[limit]` — max records per page (up to 100)
- `page[offset]` — zero-based offset by record count (max 10,000)

Response pagination metadata at `response.data?.meta`:
```typescript
meta: {
  results?: { total?: BigInt }           // total matching products
  page?: {
    limit?: BigInt,                       // records per page
    offset?: BigInt,                      // current offset
    current?: BigInt,                     // current page number
    total?: BigInt                        // total records
  }
}
```

**Note:** Must convert `number` → `BigInt` when passing to SDK: `BigInt(pageSize)`, `BigInt(page * pageSize)`.

### Reference Implementation Patterns

All new components follow the **headless Provider → Repeater** pattern:
- **Provider pattern:** `bundle/composable/EPBundleProvider.tsx` (DataProvider, refActions, previewState, slots, design-time mock with no-op actions)
- **Repeater pattern:** `bundle/composable/EPBundleComponentList.tsx` (repeatedElement(), nested DataProvider per item, `role="listitem"` wrapper)
- **Context singleton:** `bundle/composable/BundleContext.tsx` (Symbol.for + globalThis for multi-instance safety)
- **Cart drawer pattern:** `cart-drawer/EPCartDrawer.tsx` (DataProvider + module-level store, NO separate React Context needed when actions are via refActions)
- **Registration:** `index.tsx` (registerAll, import order: fields first → repeaters → providers)
- **Mock data:** `utils/design-time-data.ts` and `bundle/composable/design-time-data.ts` (MOCK_ prefix, covers all preview states, typed interfaces)
- **Registration function:** Each component exports `register*()` accepting optional `loader` + `customMeta` overrides
- **Design-time detection:** `usePlasmicCanvasContext()` + `previewState` prop (auto|withData|empty|loading|error)
- **State binding:** `states: { isOpen: { type: "writable", variableType: "boolean", valueProp, onChangeProp } }` for bidirectional Plasmic state

---

## Architectural Decisions

### D1: New hook instead of modifying `use-search.tsx`

The existing `use-search.tsx` returns `{ products, found }` via the base `SearchProductsHook` type from `@plasmicpkgs/commerce`. Extending that type would modify the upstream package. Per merge strategy, create a **new** `use-product-list.tsx` hook that calls `getByContextAllProducts` directly with pagination support. This follows the same pattern as `EPBundleProvider` calling `useBundleConfiguration` directly.

~~Item 1.1 (Enhance use-search.tsx)~~ → Replaced by Item 1.1 (Create use-product-list hook).

### D2: Compute `price.formatted` at DataProvider level

The base `ProductPrice` type has `value` and `currencyCode` but NOT `formatted`. Rather than modifying `normalize.ts` or the base commerce types, compute `formatted` when building the `currentProduct` object in EPProductGrid/EPSearchHits:

```typescript
const formatted = formatCurrency(product.price.value, product.price.currencyCode);
```

This avoids modifying any upstream files. ~~Item 1.2 (Add formatted to normalize.ts)~~ → Folded into EPProductGrid (Item 1.4).

### D3: No separate React Context needed for product list

The EPCartDrawer pattern demonstrates that DataProvider + refActions is sufficient when the repeater (grid) only needs to read data and actions are invoked via Plasmic interactions. A separate `ProductListContext.tsx` adds unnecessary complexity. The `useProductList` hook manages all state internally; EPProductListProvider exposes it via DataProvider + refActions.

~~Item 1.4 (ProductListContext.tsx)~~ → Removed. State lives in hook, exposed via DataProvider.

### D4: Shared DataProvider key for EPProductGrid parent flexibility

EPProductGrid needs to work inside both EPProductListProvider (Phase 1) and EPRelatedProductsProvider (Phase 3). Rather than try/fallback on multiple selector names, **both providers write products to a shared key `productGridData`** via DataProvider:

```typescript
<DataProvider name="productGridData" data={{ products, totalCount, ... }}>
```

EPProductGrid always reads `useSelector("productGridData")`. This is cleaner and extensible. Phase 2's EPSearchHits is a separate component (not EPProductGrid) that reads from InstantSearch hooks directly.

**Single key, no duplication.** EPProductListProvider exposes ONE DataProvider key (`productGridData`) containing both the products array AND pagination metadata (currentPage, totalPages, sort, hasNextPage, summary, etc.). Designers bind grid children to `productGridData.products` (via EPProductGrid) and pagination/summary UI to `productGridData.currentPage`, `productGridData.summary`, etc. No separate `productListData` key — that would duplicate data and confuse designers.

### D5: No `parentComponentName` restriction on EPProductGrid

Since EPProductGrid must work inside multiple parent providers (EPProductListProvider, EPRelatedProductsProvider), do NOT set `parentComponentName` in its registration metadata. Instead, document the expected parent relationship in the `description` field.

Note: The Phase 1 spec (`product-discovery-core.md`) lists `parentComponentName` on EPProductGrid — this is overridden by D5 for Phase 3 compatibility.

### D6: Use `useMutablePlasmicQueryData` for data fetching (not raw SWR)

All standalone data-fetching hooks in this codebase use `useMutablePlasmicQueryData` from `@plasmicapp/query` (a peer dependency that wraps SWR). This is the established pattern used by `useStock`, `useLocations`, `useBundleOptionProducts`, and `useParentProducts`.

- Provides `{ data, error, isLoading, mutate }` return shape
- Supports SWR options: `revalidateOnFocus`, `dedupingInterval`
- Returns `mutate()` for imperative refetch
- Requires stable query keys (sort/deduplicate params)
- No new dependencies needed — `@plasmicapp/query` is already a peer dep

~~"SWR-based"~~ references in items 1.1 and 3.1 → use `useMutablePlasmicQueryData`.

### D7: BigInt conversion for EP SDK pagination params

The EP SDK types `page[limit]` and `page[offset]` as `BigInt`. All numeric values must be converted: `BigInt(pageSize)`, `BigInt(page * pageSize)`. This matches the existing pattern in `use-bundle-option-products.tsx` line 95: `"page[limit]": BigInt(batchIds.length)`.

---

## Phase 1: Product Discovery Core (P0) — 8 Items

- [x] **1.1 — Create `useProductList` data-fetching hook**
- [x] **1.2 — Create `EPProductListProvider` component**
- [x] **1.3 — Create `EPProductGrid` component**
- [x] **1.4 — Add mock data `MOCK_PRODUCT_LIST` and `MOCK_PRODUCT_GRID_DATA`**
- [x] **1.5 — Create `product-discovery/index.ts` module exports**
- [x] **1.6 — Register Phase 1 components in `index.tsx`**
- [x] **1.7 — Unit tests for Phase 1 components**
- [x] **1.8 — Build verification**

---

## Phase 2: Catalog Search — InstantSearch.js Integration (P1) — 10 Items

- [x] **2.1 — Add catalog search dependencies to `package.json`**
- [x] **2.2 — Create `EPCatalogSearchProvider` component**
- [x] **2.3 — Create `EPSearchBox` component**
- [x] **2.4 — Create `EPSearchHits` component**
- [x] **2.5 — Create `EPRefinementList` + `EPHierarchicalMenu` components**
- [x] **2.6 — Create `EPRangeFilter` component**
- [x] **2.7 — Create `EPSearchPagination` + `EPSearchStats` + `EPSearchSortBy`**
- [x] **2.8 — Catalog search mock data + module exports**
- [x] **2.9 — Register Phase 2 components in `index.tsx`**
- [x] **2.10 — Unit tests + build verification for Phase 2**

---

## Phase 3: Related Products — Custom Relationships (P2) — 4 Items

- [x] **3.1 — Create `useRelatedProducts` hook**
- [x] **3.2 — Create `EPRelatedProductsProvider` component**
- [x] **3.3 — Register Phase 3 + mock data + module exports**
- [x] **3.4 — Unit tests + build verification for Phase 3**

---

## Cross-Cutting Concerns

### Upstream Merge Strategy
- All new code goes in new files/directories: `src/product-discovery/`, `src/catalog-search/`, `src/product/use-related-products.tsx`
- Only minimal changes to existing files: `src/index.tsx` (add imports + registration calls)
- No changes to upstream `plasmicpkgs/commerce-providers/commerce/` package
- No changes to `src/utils/normalize.ts` or `src/product/use-search.tsx`

### Dependencies
- **Phase 1:** Zero new dependencies — uses existing `@plasmicapp/query` (peer), `@epcc-sdk/sdks-shopper`, `@plasmicapp/host`
- **Phase 2:** 4 new dependencies — `@elasticpath/catalog-search-instantsearch-adapter`, `react-instantsearch`, `react-instantsearch-nextjs`, `instantsearch.js`
- **Phase 3:** Zero new dependencies

### Test Infrastructure
- Framework: Jest 29.7.0 with esbuild transpilation, jsdom environment
- React testing: `@testing-library/react` (renderHook, act) — available from root devDependencies
- Mocking: `jest.mock()` for SDK calls, `jest.fn()` for callbacks
- Pattern: `@jest-environment jsdom` pragma, `beforeEach` with `jest.clearAllMocks()`
- Test location: `src/<module>/__tests__/<name>.test.tsx` (colocated with source)

### Unified `currentProduct` Data Shape
All three phases expose `currentProduct` with the same shape, enabling card layout reuse:
```typescript
currentProduct: {
  id: string
  name: string
  slug: string
  sku: string
  description: string
  path: string         // "/product/{slug}"
  images: Array<{ url: string, alt: string }>
  price: {
    value: number
    currencyCode: string
    formatted: string  // Computed at DataProvider level via formatCurrency()
  }
  options: Array<{ displayName: string, values: string[] }>
  rawData: ProductData // EP SDK raw response
}
```

### Component Registration Names
| Component | Registration Name |
|-----------|------------------|
| EPProductListProvider | `plasmic-commerce-ep-product-list-provider` |
| EPProductGrid | `plasmic-commerce-ep-product-grid` |
| EPCatalogSearchProvider | `plasmic-commerce-ep-catalog-search-provider` |
| EPSearchBox | `plasmic-commerce-ep-search-box` |
| EPSearchHits | `plasmic-commerce-ep-search-hits` |
| EPRefinementList | `plasmic-commerce-ep-refinement-list` |
| EPHierarchicalMenu | `plasmic-commerce-ep-hierarchical-menu` |
| EPRangeFilter | `plasmic-commerce-ep-range-filter` |
| EPSearchPagination | `plasmic-commerce-ep-search-pagination` |
| EPSearchStats | `plasmic-commerce-ep-search-stats` |
| EPSearchSortBy | `plasmic-commerce-ep-search-sort-by` |
| EPRelatedProductsProvider | `plasmic-commerce-ep-related-products-provider` |

### New Files Summary (22 files across 3 phases)
**Phase 1 (8 files):** `use-product-list.tsx`, `EPProductListProvider.tsx`, `EPProductGrid.tsx`, `design-time-data.ts`, `index.ts`, test file + changes to `src/index.tsx`
**Phase 2 (12 files):** 9 component files, `design-time-data.ts`, `index.ts`, test file + changes to `src/index.tsx`, `package.json`
**Phase 3 (3 files):** `use-related-products.tsx`, `EPRelatedProductsProvider.tsx`, test file + changes to existing files
