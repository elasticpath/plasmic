# Related Products — Custom Relationships (Phase 3)

## Jobs to Be Done
- As a **designer**, I want to add a "Related Products" or "You May Also Like" section to the PDP that auto-populates from EP's product relationships, using any layout I choose
- As a **merchandiser**, I want to define relationship types (upsell, cross-sell, accessories) and associate products, then have them appear automatically in Plasmic-built pages
- As a **developer**, I want a headless provider that fetches related products by custom relationship slug and exposes them in the same data shape as product listings

## Phase
**Phase 3** of 3. Independent of Phase 2 (Catalog Search). Depends on Phase 1 for shared data shape.

## Architecture

### EP Custom Relationships API
EP PIM supports user-defined product relationships:
- **Custom relationship types**: created at store level with a slug (e.g., `CRP_related_products`, `CRP_upsell`, `CRP_accessories`)
- **Uni-directional or bi-directional**: configurable per relationship type
- **Up to 5 relationship types** per product, **2000 associations** per type
- **Endpoint**: `GET /pcm/products/{productID}/custom-relationships/{slug}/products` — returns paginated product list

### Component Hierarchy

```
EPRelatedProductsProvider (code component — fetches related products by slug)
  └── EPProductGrid (REUSED from Phase 1 — repeatedElement() per product)
      └── [ANY Plasmic elements — same currentProduct data shape]
```

Only **one new code component** needed. EPProductGrid from Phase 1 is reused.

## Component Specification

### EPRelatedProductsProvider

**Purpose:** Fetches products related to the current product via EP Custom Relationships API. Exposes the same `products` data shape as EPProductListProvider for grid reuse.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Main content (typically EPProductGrid) |
| `loadingContent` | slot | — | Shown while fetching |
| `errorContent` | slot | — | Shown on fetch error |
| `emptyContent` | slot | — | Shown when no related products |
| `relationshipSlug` | string | "CRP_related_products" | Custom relationship slug |
| `productId` | string? | — | Override product ID (defaults to current product from context) |
| `limit` | number | 4 | Max related products to show |
| `previewState` | choice | "auto" | auto, withData, loading, error, empty |
| `className` | string? | — | |

**Provides via DataProvider (`relatedProductsData`):**
```typescript
{
  products: Product[]          // same Product shape as Phase 1
  totalCount: number
  relationshipName: string     // human-readable name from relationship meta
  relationshipSlug: string
  isLoading: boolean
  isEmpty: boolean
}
```

**Implementation:**
1. Read current product ID from parent context (e.g., PDP page data) or `productId` prop
2. Fetch `GET /pcm/products/{productID}/custom-relationships/{slug}/products?page[limit]={limit}`
3. Normalize products through existing `normalizeProduct()` utility
4. Expose via DataProvider with same Product shape as Phase 1

**Registration:**
- `providesData: true`
- **Auto-wired defaults:** Contains EPProductGrid with pre-bound horizontal card layout (image + name + price). Designer sees 4 related products immediately on drop.
- Design-time mock: 4 sample products with different names/prices than listing mock

## New Hook: useRelatedProducts

**File:** `plasmicpkgs/commerce-providers/elastic-path/src/product/use-related-products.tsx`

```typescript
function useRelatedProducts(options: {
  productId: string
  relationshipSlug: string
  limit?: number
}): {
  products: Product[]
  totalCount: number
  relationshipName?: string
  isLoading: boolean
  error?: Error
}
```

**Implementation:**
1. Call EP API: `GET /pcm/products/{productId}/custom-relationships/{slug}/products`
2. Include `main_image` in response for product images
3. Normalize each product through `normalizeProduct()` / `normalizeProductFromList()`
4. Optionally fetch relationship metadata for display name

## Design-Time Mock Data

**Add to** `design-time-data.ts`:

```typescript
export const MOCK_RELATED_PRODUCTS = {
  products: [
    { id: "r1", name: "Sample Matching Diffuser", price: { formatted: "$32.99", ... }, ... },
    { id: "r2", name: "Sample Gift Set", price: { formatted: "$54.99", ... }, ... },
    { id: "r3", name: "Sample Travel Size", price: { formatted: "$12.99", ... }, ... },
    { id: "r4", name: "Sample Refill Pack", price: { formatted: "$18.99", ... }, ... },
  ],
  totalCount: 4,
  relationshipName: "Related Products",
  relationshipSlug: "CRP_related_products",
  isLoading: false,
  isEmpty: false,
};
```

## Scenarios

### PDP "You May Also Like" Section
- Designer adds EPRelatedProductsProvider inside PDP layout
- Sets `relationshipSlug="CRP_related_products"`
- Leaves `productId` empty (auto-reads from PDP context)
- Inside: EPProductGrid with horizontal scroll or 4-column row
- Cards show image, name, price — same bindings as listing cards

### PDP "Complete the Look" / Accessories
- Same as above but `relationshipSlug="CRP_accessories"`
- Different visual treatment (smaller cards, horizontal strip)

### PDP "Upsell" Section
- `relationshipSlug="CRP_upsell"`, `limit={2}`
- Prominent cards with "Upgrade to..." messaging

### Homepage "Staff Picks" (using tagged products)
- If no custom relationships, fall back to category-based listing
- Use EPProductListProvider with specific `categoryId` instead

## Acceptance Criteria
- [ ] EPRelatedProductsProvider fetches related products via EP Custom Relationships API
- [ ] EPRelatedProductsProvider reads product ID from parent context (PDP) by default
- [ ] EPRelatedProductsProvider exposes `relatedProductsData` with same Product shape as Phase 1
- [ ] EPProductGrid from Phase 1 works inside EPRelatedProductsProvider (reused, not duplicated)
- [ ] Designer card layouts from Phase 1 are reusable for related products (same data bindings)
- [ ] `useRelatedProducts` hook handles pagination (limit), loading, and error states
- [ ] All states handled: loading, error, empty (no relationships defined), data
- [ ] Design-time mock data for preview
- [ ] `relationshipSlug` prop allows any custom relationship type
- [ ] Product normalization reuses existing `normalizeProduct()` utility
- [ ] Auto-wired defaults show 4 horizontal product cards on drop

## Edge Cases
| Scenario | Expected Behaviour |
|----------|-------------------|
| Product has no relationships of this type | Show `emptyContent` slot |
| Relationship slug doesn't exist | API returns 404 → show `errorContent` |
| Product ID not available in context | Show `errorContent` with helpful message |
| Related product has been deleted/archived | Skip it, don't show in results |
| Circular relationship (A→B→A) | Not an issue — we only fetch one level deep |
| More than `limit` relationships | Only show first `limit` products |
| Bi-directional relationship | Works automatically — EP API returns both directions |

## Out of Scope (Phase 3)
- "Customers also bought" (requires order analytics, not just relationships)
- Same-category fallback (use EPProductListProvider with categoryId for this)
- Tag-based related products
- AI/ML recommendations
- Relationship management UI (managed in EP Commerce Manager)
