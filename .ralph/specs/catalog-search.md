# Catalog Search — InstantSearch.js Integration (Phase 2)

## Jobs to Be Done
- As a **designer**, I want to build a full search experience (search box, faceted filters, results grid) using the same headless approach as basic listing, with the power of EP Catalog Search
- As a **developer**, I want the catalog search components to wrap react-instantsearch so that I get URL routing, facets, and full-text search without building it from scratch
- As a **merchant with Catalog Search enabled**, I want faceted filtering (by category, price range, attributes) so that shoppers can narrow results efficiently

## Phase
**Phase 2** of 3. Depends on Phase 1 (shared EPProductGrid + data shape). Only available when EP Catalog Search is enabled.

## Architecture

### Strategy: Wrap react-instantsearch + EP adapter

The `@elasticpath/catalog-search-instantsearch-adapter` package is mature and production-ready. It implements the full `SearchClient` protocol, translating InstantSearch.js requests into EP Catalog Search API calls (Typesense-powered).

Instead of reimplementing search, we wrap `react-instantsearch` widgets as headless Plasmic components. This gives us:
- Full-text search with relevance ranking
- Faceted filtering (refinement lists, hierarchical menus, range sliders)
- URL state sync (query, filters, page all in URL)
- Autocomplete/suggestions
- Sort by multiple indices
- All maintained by InstantSearch.js community

### Dependency
Bundle `@elasticpath/catalog-search-instantsearch-adapter` and `react-instantsearch` as dependencies of the elastic-path plasmicpkg. Designer doesn't need to install anything extra.

### Component Hierarchy

```
EPCatalogSearchProvider (code component — wraps <InstantSearchNext>)
  ├── EPSearchBox (code component — search input with autocomplete)
  ├── EPSearchHits (code component — repeatedElement() per hit)
  │   └── [ANY Plasmic elements — same data shape as EPProductGrid]
  │       ├── <img> bound to currentProduct.images[0].url
  │       ├── <span> bound to currentProduct.name
  │       └── <span> bound to currentProduct.price.formatted
  ├── EPRefinementList (code component — facet filter list)
  │   └── [ANY Plasmic elements — designer binds to refinement data]
  ├── EPHierarchicalMenu (code component — category tree nav)
  │   └── [ANY Plasmic elements — designer binds to category data]
  ├── EPRangeFilter (code component — min/max numeric filter)
  │   └── [ANY Plasmic elements — designer binds to range data]
  ├── EPSearchPagination (code component — wraps useSearchPagination)
  │   └── [ANY Plasmic elements with actions]
  ├── EPSearchStats (code component — exposes stats data)
  │   └── [ANY Plasmic elements]
  └── EPSearchSortBy (code component — sort index selector)
      └── [ANY Plasmic elements]
```

### Unified Data Shape
EPSearchHits exposes `currentProduct` with the **same shape** as EPProductGrid from Phase 1. The adapter normalizes EP Catalog Search hits into the same Product interface. Designers can reuse the same card layouts across basic listing and catalog search.

## Component Specifications

### 1. EPCatalogSearchProvider

**Purpose:** Root provider wrapping `<InstantSearchNext>` with the EP adapter. Handles client initialization, URL routing, and global search configuration.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Search UI content |
| `className` | string? | — | |
| `indexName` | string | "search" | InstantSearch index name |
| `queryBy` | string | "name,description" | Fields to search (comma-separated) |
| `hitsPerPage` | number | 12 | Results per page |
| `enableUrlSync` | boolean | true | Sync search state to URL |
| `currencyCode` | string | "USD" | For price facet field name |
| `previewState` | choice | "auto" | auto, withData, loading, empty |

**Provides via DataProvider (`catalogSearchData`):**
```typescript
{
  isSearchActive: boolean      // whether a query or filter is applied
  query: string                // current search query
  currencyCode: string         // for price display
}
```

**Implementation:**
- Creates `CatalogSearchInstantSearchAdapter` with the EP shopper client from ElasticPathProvider context
- Wraps children in `<InstantSearchNext>` with URL routing
- Passes `additionalSearchParameters: { query_by: queryBy }`
- Design-time: renders children with mock data (no real search calls)

**Registration:**
- `providesData: true`
- **Auto-wired defaults:** Default slot pre-builds a working search page:
  - EPSearchBox at top
  - hbox with EPRefinementList sidebar + EPSearchHits main area
  - EPSearchPagination at bottom
  - All pre-configured and ready to preview

### 2. EPSearchBox

**Purpose:** Search input with optional autocomplete. Wraps `useSearchBox()` hook.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `className` | string? | — | |
| `placeholder` | string | "Search products..." | Input placeholder |
| `autoFocus` | boolean | false | Focus on mount |
| `debounceMs` | number | 300 | Debounce search input |
| `showClear` | boolean | true | Show clear button |
| `previewState` | choice | "auto" | auto, withData |

**Implementation:**
- Renders `<input>` with `useSearchBox()` hook from react-instantsearch
- Debounces input before triggering search
- Clear button resets query
- Designer styles via className

### 3. EPSearchHits

**Purpose:** Repeater for search results. Same role as EPProductGrid but sourced from InstantSearch.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Repeated per hit |
| `className` | string? | — | |
| `previewState` | choice | "auto" | auto, withData |

**Provides per iteration (via DataProvider) — SAME SHAPE as EPProductGrid:**
```typescript
currentProduct: {
  id: string
  name: string
  slug: string
  sku: string
  description: string
  path: string
  images: Array<{ url: string, alt: string }>
  price: {
    value: number
    currencyCode: string
    formatted: string
  }
  // Search-specific extras:
  _highlightedName?: string    // with <mark> tags for search highlighting
  _highlightedDescription?: string
  _score?: number              // relevance score
  rawHit: Hit                  // raw InstantSearch hit for advanced use
}
currentProductIndex: number
```

**Registration:**
- `parentComponentName: "plasmic-commerce-ep-catalog-search-provider"`
- Uses `repeatedElement()` + `useHits()` hook
- **Auto-wired defaults:** Same pre-bound card template as EPProductGrid

### 4. EPRefinementList

**Purpose:** Facet filter list (e.g., Brand, Color, Material). Headless — exposes refinement items for designer to render.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Repeated per refinement item |
| `attribute` | string | — | Facet attribute name (e.g., "brand", "color") |
| `label` | string? | — | Display label for the filter group |
| `limit` | number | 10 | Max items to show |
| `showMore` | boolean | false | Allow expanding beyond limit |
| `searchable` | boolean | false | Allow searching within facet values |
| `className` | string? | — | |
| `previewState` | choice | "auto" | auto, withData |

**Provides per iteration (via DataProvider):**
```typescript
currentRefinement: {
  value: string              // e.g., "Blue"
  label: string              // display label
  count: number              // number of matching products
  isRefined: boolean         // whether currently selected
}
currentRefinementIndex: number
```

**Element actions:**
```typescript
toggleRefinement(value: string)  // toggle a facet value on/off
```

**Registration:**
- `parentComponentName: "plasmic-commerce-ep-catalog-search-provider"`
- Uses `repeatedElement()` + `useRefinementList()` hook
- **Auto-wired defaults:** Each item shows label, count badge, and checkbox-style indicator. Pre-bound to `currentRefinement.label`, `currentRefinement.count`, `currentRefinement.isRefined`

### 5. EPHierarchicalMenu

**Purpose:** Category tree navigation for hierarchical facets. Headless repeater over category levels.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Repeated per category item |
| `attributes` | string | — | Comma-separated hierarchy levels (e.g., "meta.search.categories.lvl0,meta.search.categories.lvl1") |
| `className` | string? | — | |
| `previewState` | choice | "auto" | auto, withData |

**Provides per iteration:**
```typescript
currentCategory: {
  value: string              // category path value
  label: string              // display name
  count: number              // products in category
  isRefined: boolean         // currently selected
  depth: number              // nesting level (0, 1, 2...)
  hasChildren: boolean       // has sub-categories
}
```

**Element actions:**
```typescript
refineCategory(value: string)
```

### 6. EPRangeFilter

**Purpose:** Numeric range filter (price, rating, etc.). Exposes min/max for designer to render as slider, inputs, or preset buttons.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Custom range UI |
| `attribute` | string | — | Numeric attribute (e.g., "price.USD.float_price") |
| `className` | string? | — | |
| `previewState` | choice | "auto" | auto, withData |

**Provides via DataProvider:**
```typescript
rangeData: {
  min: number                // absolute min from data
  max: number                // absolute max from data
  currentMin: number         // user-selected min
  currentMax: number         // user-selected max
  canRefine: boolean         // whether range is narrowable
}
```

**Element actions:**
```typescript
setRange(min: number, max: number)
```

### 7. EPSearchPagination

**Purpose:** Exposes pagination state and actions from InstantSearch.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Custom pagination UI |
| `className` | string? | — | |
| `previewState` | choice | "auto" | auto, withData |

**Provides via DataProvider:**
```typescript
searchPaginationData: {
  currentPage: number        // 0-based
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
  pages: number[]            // array of page numbers to display
}
```

**Element actions:**
```typescript
goToPage(page: number)
nextPage()
prevPage()
```

### 8. EPSearchStats

**Purpose:** Exposes search statistics (total results, query, processing time).

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `className` | string? | — | |
| `previewState` | choice | "auto" | auto, withData |

**Provides via DataProvider:**
```typescript
searchStatsData: {
  nbHits: number             // total results
  query: string              // current query
  processingTimeMS: number
  summary: string            // "48 results for 'candle' in 12ms"
}
```

### 9. EPSearchSortBy

**Purpose:** Sort order selector that switches InstantSearch index/sort.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Custom sort UI |
| `items` | json | — | Array of `{ value: "price:asc", label: "Price: Low to High" }` |
| `className` | string? | — | |
| `previewState` | choice | "auto" | auto, withData |

**Provides via DataProvider:**
```typescript
sortByData: {
  currentValue: string
  options: Array<{ value: string, label: string }>
}
```

**Element actions:**
```typescript
setSort(value: string)
```

## New Dependencies

Add to `plasmicpkgs/commerce-providers/elastic-path/package.json`:
```json
{
  "@elasticpath/catalog-search-instantsearch-adapter": "^0.0.5",
  "react-instantsearch": "^7.x",
  "react-instantsearch-nextjs": "^0.x",
  "instantsearch.js": "^4.x"
}
```

## Acceptance Criteria
- [ ] EPCatalogSearchProvider wraps InstantSearchNext with EP adapter
- [ ] EPCatalogSearchProvider initializes adapter from ElasticPathProvider context (no extra config)
- [ ] EPSearchBox provides debounced full-text search input
- [ ] EPSearchHits exposes `currentProduct` with same shape as EPProductGrid (unified data)
- [ ] EPRefinementList iterates facet values with toggleRefinement action
- [ ] EPHierarchicalMenu navigates category tree with refineCategory action
- [ ] EPRangeFilter exposes min/max range with setRange action
- [ ] EPSearchPagination exposes page state with goToPage/next/prev actions
- [ ] EPSearchStats exposes result count, query, processing time
- [ ] EPSearchSortBy exposes sort options with setSort action
- [ ] URL sync works: search state persisted in URL params
- [ ] All components headless — designer uses ANY elements with data binding
- [ ] All components have auto-wired defaults that work immediately on drop
- [ ] Design-time mock data for all components (no real search calls in editor)
- [ ] Graceful degradation when Catalog Search not enabled (show error in provider)

## Happy Path
1. Designer drags EPCatalogSearchProvider onto search page
2. Default slot shows working search UI: search box, refinement sidebar, product grid, pagination
3. Designer customizes card layout (reuses same bindings as basic listing cards)
4. Designer configures EPRefinementList `attribute="brand"` for brand filter
5. Designer adds EPRangeFilter with `attribute="price.USD.float_price"` for price range
6. Designer adds EPHierarchicalMenu for category navigation
7. Preview shows mock data. At runtime, real search results appear with faceted filtering

## Edge Cases
| Scenario | Expected Behaviour |
|----------|-------------------|
| Catalog Search not enabled for store | EPCatalogSearchProvider shows error message in editor + `errorContent` slot at runtime |
| No results for query | EPSearchHits renders nothing, designer uses conditional visibility on emptyContent |
| Facet attribute not indexed | EPRefinementList renders empty, no error |
| Network error during search | InstantSearch handles retry; adapter surfaces error |
| Designer uses EPSearchHits outside provider | Clear error: "Must be inside EPCatalogSearchProvider" |
| URL has stale filter params | InstantSearch handles gracefully (ignores unknown params) |

## Out of Scope (Phase 2)
- Autocomplete with dropdown suggestions (stretch goal — add if time permits)
- Federated/union search across multiple indices
- Conversational/AI search
- Geo-location based search
- Custom merchandising rules UI
- Related products (Phase 3)
