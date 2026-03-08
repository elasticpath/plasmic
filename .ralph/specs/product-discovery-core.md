# Product Discovery — Core Listing Components (Phase 1)

## Jobs to Be Done
- As a **designer in Plasmic Studio**, I want headless product listing components that expose data and actions so that I can build shop pages, collection pages, and featured sections using any elements I choose
- As a **developer**, I want the components to follow the same Provider → Repeater pattern as bundles/cart so that the architecture is consistent
- As a **merchant**, I want full design control over product cards so that my brand identity is preserved

## Phase
**Phase 1** of 3. Prerequisite for Phase 2 (Catalog Search) and Phase 3 (Related Products).

## Architecture: Headless UI

Only **two code components** are needed. Everything else is standard Plasmic elements with data binding.

```
EPProductListProvider (code component — data fetching, state, actions)
  ├── EPProductGrid (code component — repeatedElement() per product)
  │   └── [ANY Plasmic elements — designer binds data freely]
  │       ├── <img> bound to currentProduct.images[0].url
  │       ├── <span> bound to currentProduct.name
  │       ├── <span> bound to currentProduct.price.formatted
  │       └── <a> with href bound to /product/${currentProduct.slug}
  ├── <select> with onChange → setSort() action
  ├── <button> with onClick → nextPage() / prevPage() actions
  └── <span> bound to productListData.totalCount
```

> **Implementation note (D4):** The DataProvider key is `productGridData` (not `productListData`). Both EPProductListProvider and EPRelatedProductsProvider share the `productGridData` key so EPProductGrid works with either provider.

### Why Headless
- Designers use ANY elements — no forced card/field components
- Data binding via Plasmic's dynamic values ($ctx)
- Actions wired via Plasmic interactions (onClick, onChange)
- Fewer components to register, learn, maintain
- Matches the "headless commerce" philosophy of Elastic Path itself

## Component Specifications

### 1. EPProductListProvider

**Purpose:** Root context provider. Fetches products, manages pagination/sort state, exposes data and actions.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Main content |
| `loadingContent` | slot | — | Shown while fetching |
| `errorContent` | slot | — | Shown on fetch error |
| `emptyContent` | slot | — | Shown when no products match |
| `categoryId` | string? | — | Filter to category hierarchy node |
| `search` | string? | — | Filter by product name |
| `initialSort` | choice | "trending-desc" | price-asc, price-desc, latest-desc, trending-desc |
| `pageSize` | number | 12 | Products per page |
| `previewState` | choice | "auto" | auto, withData, loading, error, empty |
| `className` | string? | — | |

**Provides via DataProvider (`productListData`):**

> **Implementation note (D4):** The actual DataProvider key is `productGridData`, not `productListData`. This was an intentional architectural decision so that EPProductGrid works with both EPProductListProvider and EPRelatedProductsProvider.
```typescript
{
  products: Product[]          // current page results
  totalCount: number           // total matching products
  currentPage: number          // 0-based page index
  totalPages: number           // ceil(totalCount / pageSize)
  pageSize: number
  sort: string                 // current sort value
  isLoading: boolean
  hasNextPage: boolean
  hasPreviousPage: boolean
  isEmpty: boolean
  // Summary text helpers
  rangeStart: number           // e.g. 13 (for page 2)
  rangeEnd: number             // e.g. 24
  summary: string              // "Showing 13-24 of 48 products"
}
```

**Element actions (designer wires via interactions):**
```typescript
setSort(value: string)         // "price-asc" | "price-desc" | "latest-desc" | "trending-desc"
goToPage(page: number)         // 0-based page number
nextPage()                     // currentPage + 1
prevPage()                     // currentPage - 1
loadMore()                     // append next page to existing results
```

**Registration:**
- `providesData: true`
- `refActions` for setSort, goToPage, nextPage, prevPage, loadMore
- Design-time mock: 6 sample products with images, prices, names
- **Auto-wired defaults:** Default slot content pre-builds a working product listing:
  - EPProductGrid containing a vbox card template
  - Card template has: `<img>` pre-bound to `currentProduct.images[0].url`, `<div>` pre-bound to `currentProduct.name`, `<div>` pre-bound to `currentProduct.price.formatted`
  - Card wrapped in `<a>` pre-bound to `currentProduct.path`
  - Below grid: summary text pre-bound to `productListData.summary` (impl uses `productGridData.summary` per D4)
  - Designer sees a fully working product grid immediately on drop — customize from there

### 2. EPProductGrid

**Purpose:** Repeater that iterates over products from context. Uses `repeatedElement()` from @plasmicapp/host.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Repeated per product |
| `className` | string? | — | Designer controls grid layout via CSS |
| `previewState` | choice | "auto" | auto, withData |

**Provides per iteration (via DataProvider):**
```typescript
currentProduct: {
  id: string
  name: string
  slug: string
  sku: string
  description: string
  path: string                 // "/product/{slug}"
  images: Array<{
    url: string
    alt: string
  }>
  price: {
    value: number
    currencyCode: string
    formatted: string          // "$24.99"
  }
  options: Array<{             // variant options summary
    displayName: string
    values: string[]           // Note: implementation uses Array<{ label: string }> per the commerce base types
  }>
  rawData: ProductData         // EP SDK raw response for advanced use
}
currentProductIndex: number
```

**Registration:**
- `parentComponentName: "plasmic-commerce-ep-product-list-provider"`
- Uses `repeatedElement()` from @plasmicapp/host
- **Auto-wired defaults:** Default slot is a vbox card with pre-bound elements:
  - `<img>` → `currentProduct.images[0].url` (with alt → `currentProduct.name`)
  - `<div>` → `currentProduct.name` (styled as heading)
  - `<div>` → `currentProduct.price.formatted` (styled as price)
  - Wrapped in `<a>` → `currentProduct.path`
  - Designer sees real-looking cards immediately, modifies from there

## Data Source: useSearch Hook Enhancements

**File:** `plasmicpkgs/commerce-providers/elastic-path/src/product/use-search.tsx`

Current capabilities:
- Filter by name: `eq(name,${search})`
- Filter by categoryId
- Sort: price-asc, price-desc, latest-desc, trending-desc
- Limit: `page[limit]`

**Changes needed:**
- [ ] Add `page[offset]` parameter for page-based pagination
- [ ] Return total count from EP API response meta (`meta.results.total`)
- [ ] Return pagination metadata: `{ total, page, pageSize, hasMore }`
- [ ] Support `loadMore` mode: append results to existing array instead of replacing

## Design-Time Mock Data

**Add to** `plasmicpkgs/commerce-providers/elastic-path/src/utils/design-time-data.ts`:

```typescript
export const MOCK_PRODUCT_LIST = {
  products: [
    { id: "1", name: "Sample Amber Candle", price: { formatted: "$24.99", ... }, ... },
    { id: "2", name: "Sample Cedar Diffuser", price: { formatted: "$34.99", ... }, ... },
    { id: "3", name: "Sample Rose Bath Oil", price: { formatted: "$19.99", ... }, ... },
    { id: "4", name: "Sample Vanilla Reed Set", price: { formatted: "$44.99", ... }, ... },
    { id: "5", name: "Sample Lavender Mist", price: { formatted: "$14.99", ... }, ... },
    { id: "6", name: "Sample Oud Wood Candle", price: { formatted: "$29.99", ... }, ... },
  ],
  totalCount: 48,
  currentPage: 0,
  totalPages: 4,
  pageSize: 12,
  sort: "trending-desc",
  isLoading: false,
  hasNextPage: true,
  hasPreviousPage: false,
  isEmpty: false,
  rangeStart: 1,
  rangeEnd: 12,
  summary: "Showing 1-12 of 48 products",
};
```

## Scenarios

### Shop All Page
- Designer drops EPProductListProvider with no `categoryId` → shows all products
- Adds EPProductGrid inside with custom card layout
- Binds elements to `currentProduct.name`, `currentProduct.price.formatted`, etc.
- Adds a `<select>` below and wires onChange → `setSort`
- Adds prev/next `<button>`s wired to `prevPage()` / `nextPage()`

### Collection Page
- Same as above but `categoryId` prop set (from URL param or hardcoded)
- Optionally binds `productListData.summary` to show "Showing X of Y" (impl uses `productGridData.summary` per D4)

### Featured/Curated Section (Homepage)
- EPProductListProvider with `categoryId` + `pageSize={4}`
- No pagination or sort — just a row of 4 cards
- EPProductGrid styled as horizontal scroll or flex-row

## Acceptance Criteria
- [ ] EPProductListProvider fetches products and exposes `productListData` via DataProvider (impl uses `productGridData` key per D4)
- [ ] EPProductListProvider exposes `setSort`, `goToPage`, `nextPage`, `prevPage`, `loadMore` as element actions
- [ ] EPProductGrid repeats children per product using `repeatedElement()`
- [ ] EPProductGrid exposes `currentProduct` and `currentProductIndex` per iteration
- [ ] `currentProduct` includes `images`, `price.formatted`, `name`, `slug`, `description`, `sku`, `path`
- [ ] Designer can bind ANY element to product data (no forced card components)
- [ ] Designer can wire ANY interactive element to pagination/sort actions
- [ ] `loadMore` mode appends results instead of replacing
- [ ] All states handled: loading, error, empty, data
- [ ] Design-time preview with mock data via `previewState`
- [ ] Both components have `className` for designer styling
- [ ] `useSearch` enhanced with offset pagination and total count
- [ ] Components registered following existing pattern (see EPBundleProvider for reference)
- [ ] Zero new dependencies added (uses existing EP SDK + Plasmic host APIs)

## Happy Path
1. Designer drags EPProductListProvider onto a collection page
2. Default slot shows a grid with placeholder card template
3. Designer customizes the card: repositions image, changes font, adds hover effect
4. Designer binds `<img>` src to `currentProduct.images[0].url`
5. Designer binds `<h3>` text to `currentProduct.name`
6. Designer binds price text to `currentProduct.price.formatted`
7. Designer wraps card in `<a>` bound to `currentProduct.path`
8. Designer adds `<select>` element, wires onChange → `setSort`
9. Designer adds `<button>` "Next", wires onClick → `nextPage()`
10. Preview shows mock products with working layout

## Edge Cases
| Scenario | Expected Behaviour |
|----------|-------------------|
| No products match filters | Show `emptyContent` slot |
| API error (network, auth) | Show `errorContent` slot |
| Single product returned | Grid renders 1 card, hasNextPage=false |
| Product has no image | `images` array empty — designer handles via conditional visibility |
| Product has no price | `price.formatted` returns "" — designer handles |
| Page beyond total | Clamp to last valid page |
| CategoryId invalid/empty | Empty results, not an error |
| `loadMore` at end | `hasNextPage: false`, loadMore is no-op |
| Provider unmounts during fetch | Cancel in-flight request, no state update |

## Out of Scope (Phase 1)
- Catalog search / faceted filtering (Phase 2)
- Autocomplete / search box (Phase 2)
- InstantSearch.js integration (Phase 2)
- Related products / custom relationships (Phase 3)
- Infinite scroll trigger (only button-based load-more)
- Product quick-view modal
- Wishlist/save functionality
