# Phase 1: Replace Cart Read Hooks

## Status: Ready to Build
## Date: 2026-03-09
## Depends on: Phase 0 (ShopperContext, useShopperFetch)
## Unblocks: Cart display on checkout page with real data via server route

---

## Goal

Add server-route-based cart read hooks to the package. After this phase:
- `useCart()` fetches from `/api/cart` via `useShopperFetch` (not EP SDK directly)
- `useCheckoutCart()` normalizes raw cart data for checkout display
- EPCheckoutCartSummary can accept external cart data (optional prop)
- SWR cache key includes cartId when present — Studio preview triggers refetch
- Design-time mock data available for Studio styling

---

## Deliverables

### D1: `src/shopper-context/use-cart.ts` (New SWR Hook)

```typescript
// src/shopper-context/use-cart.ts
import useSWR from 'swr';
import { useShopperFetch } from './useShopperFetch';
import { useShopperContext } from './useShopperContext';

export interface CartItem {
  id: string;
  type: string;
  product_id: string;
  name: string;
  description: string;
  sku: string;
  slug: string;
  quantity: number;
  image?: { href: string; mime_type?: string };
  meta: {
    display_price: {
      with_tax: {
        unit: { amount: number; formatted: string; currency: string };
        value: { amount: number; formatted: string; currency: string };
      };
      without_tax: {
        unit: { amount: number; formatted: string; currency: string };
        value: { amount: number; formatted: string; currency: string };
      };
    };
  };
}

export interface CartMeta {
  display_price: {
    with_tax: { amount: number; formatted: string; currency: string };
    without_tax: { amount: number; formatted: string; currency: string };
    tax: { amount: number; formatted: string; currency: string };
    discount?: { amount: number; formatted: string; currency: string };
  };
}

export interface CartData {
  items: CartItem[];
  meta: CartMeta | null;
}

export interface UseCartReturn {
  data: CartData | null;
  error: Error | null;
  isLoading: boolean;
  isEmpty: boolean;
  mutate: () => Promise<CartData | undefined>;
}

/**
 * Fetch cart data from consumer's GET /api/cart server route.
 * Uses useShopperFetch to attach X-Shopper-Context header when overrides present.
 *
 * The consumer app must implement GET /api/cart using the server utilities
 * from this package (resolveCartId, buildCartCookieHeader).
 */
export function useCart(): UseCartReturn {
  const shopperFetch = useShopperFetch();
  const { cartId } = useShopperContext();

  // Include cartId in cache key so SWR refetches when designer changes it in Studio
  const cacheKey = cartId ? ['cart', cartId] : 'cart';

  const { data, error, mutate } = useSWR<CartData>(
    cacheKey,
    () => shopperFetch<CartData>('/api/cart'),
    { revalidateOnFocus: false }
  );

  return {
    data: data ?? null,
    error: error ?? null,
    isLoading: !data && !error,
    isEmpty: !data || data.items.length === 0,
    mutate: mutate as () => Promise<CartData | undefined>,
  };
}
```

**Key decisions:**
- Types are defined inline (not imported from EP SDK) to avoid coupling to SDK types
- SWR cache key includes `cartId` when present — changing cartId in Studio triggers refetch
- `mutate()` exposed for Phase 2 mutation hooks to trigger refetch

---

### D2: `src/shopper-context/use-checkout-cart.ts` (Normalized Checkout Data)

```typescript
// src/shopper-context/use-checkout-cart.ts
import { useMemo } from 'react';
import { useCart, type CartData } from './use-cart';

export interface CheckoutCartItem {
  id: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  linePrice: number;
  formattedUnitPrice: string;
  formattedLinePrice: string;
  imageUrl: string | null;
}

export interface CheckoutCartData {
  id?: string;
  items: CheckoutCartItem[];
  itemCount: number;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  formattedSubtotal: string;
  formattedTax: string;
  formattedShipping: string;
  formattedTotal: string;
  currencyCode: string;
  showImages: boolean;
  hasPromo: boolean;
  promoCode: string | null;
  promoDiscount: number;
  formattedPromoDiscount: string | null;
}

/**
 * Wraps useCart and normalizes raw EP cart data into checkout display format
 * with formatted prices, item count, and currency.
 */
export function useCheckoutCart() {
  const { data, error, isLoading, isEmpty, mutate } = useCart();

  const checkoutData = useMemo<CheckoutCartData | null>(() => {
    if (!data || !data.meta) return null;

    const meta = data.meta.display_price;
    const currency = meta.with_tax.currency || 'USD';

    const items: CheckoutCartItem[] = data.items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.meta.display_price.with_tax.unit.amount,
      linePrice: item.meta.display_price.with_tax.value.amount,
      formattedUnitPrice: item.meta.display_price.with_tax.unit.formatted,
      formattedLinePrice: item.meta.display_price.with_tax.value.formatted,
      imageUrl: item.image?.href ?? null,
    }));

    return {
      items,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      subtotal: meta.without_tax.amount,
      tax: meta.tax.amount,
      shipping: 0, // Shipping is calculated during checkout, not in cart
      total: meta.with_tax.amount,
      formattedSubtotal: meta.without_tax.formatted,
      formattedTax: meta.tax.formatted,
      formattedShipping: '$0.00',
      formattedTotal: meta.with_tax.formatted,
      currencyCode: currency,
      showImages: true,
      hasPromo: false,
      promoCode: null,
      promoDiscount: 0,
      formattedPromoDiscount: null,
    };
  }, [data]);

  return { data: checkoutData, error, isLoading, isEmpty, mutate };
}
```

---

### D3: Design-Time Mock Data

Add to `src/shopper-context/design-time-data.ts`:

```typescript
// src/shopper-context/design-time-data.ts
import type { CheckoutCartData } from './use-checkout-cart';

export const MOCK_SERVER_CART_DATA: CheckoutCartData = {
  id: 'mock-cart-001',
  items: [
    {
      id: 'mock-item-1',
      productId: 'mock-product-1',
      name: 'Ember Glow Soy Candle',
      sku: 'EW-EMB-001',
      quantity: 2,
      unitPrice: 3800,
      linePrice: 7600,
      formattedUnitPrice: '$38.00',
      formattedLinePrice: '$76.00',
      imageUrl: null,
    },
    {
      id: 'mock-item-2',
      productId: 'mock-product-2',
      name: 'Midnight Wick Reed Diffuser',
      sku: 'EW-MID-002',
      quantity: 1,
      unitPrice: 2400,
      linePrice: 2400,
      formattedUnitPrice: '$24.00',
      formattedLinePrice: '$24.00',
      imageUrl: null,
    },
  ],
  itemCount: 3,
  subtotal: 10000,
  tax: 825,
  shipping: 0,
  total: 10825,
  formattedSubtotal: '$100.00',
  formattedTax: '$8.25',
  formattedShipping: '$0.00',
  formattedTotal: '$108.25',
  currencyCode: 'USD',
  showImages: true,
  hasPromo: false,
  promoCode: null,
  promoDiscount: 0,
  formattedPromoDiscount: null,
};
```

---

### D4: EPCheckoutCartSummary Enhancement (Optional External Data)

Modify the existing `src/checkout/composable/EPCheckoutCartSummary.tsx` to accept an optional `cartData` prop. When provided, skip internal `useCart()` and use the provided data instead.

This allows the consumer to pass data from the new `useCheckoutCart()` hook, or to use the component's internal EP SDK-based cart fetching (backward compatible).

**Minimal change to existing file:**

```typescript
// Add to EPCheckoutCartSummaryProps:
cartData?: CheckoutCartData;

// In the component body, early return if external data provided:
if (cartData) {
  return (
    <DataProvider name="checkoutCartData" data={cartData}>
      {children}
    </DataProvider>
  );
}

// ... existing internal cart fetching logic unchanged
```

This is a non-breaking additive change. The existing behavior is preserved when `cartData` is not provided.

---

### D5: Export from barrel

Update `src/shopper-context/index.ts`:

```typescript
// Add to existing exports:
export { useCart, type CartItem, type CartMeta, type CartData, type UseCartReturn } from './use-cart';
export { useCheckoutCart, type CheckoutCartItem, type CheckoutCartData } from './use-checkout-cart';
export { MOCK_SERVER_CART_DATA } from './design-time-data';
```

---

## SWR Dependency

**IMPORTANT:** `swr` is NOT in `package.json` as a direct or peer dependency. It comes through `@plasmicpkgs/commerce` internally but is not re-exported. Since the new hooks use SWR directly, add it:

```json
// In package.json peerDependencies:
"swr": ">=1.0.0"
```

The consumer app likely already has SWR via Next.js or the commerce provider.

---

## File Changes Summary

| File | Action |
|------|--------|
| `src/shopper-context/use-cart.ts` | **Create** |
| `src/shopper-context/use-checkout-cart.ts` | **Create** |
| `src/shopper-context/design-time-data.ts` | **Create** |
| `src/shopper-context/index.ts` | **Edit** — add new exports |
| `src/checkout/composable/EPCheckoutCartSummary.tsx` | **Edit** — add optional `cartData` prop |

---

## Acceptance Criteria

1. **useCart()** fetches from `/api/cart` via useShopperFetch, returns CartData
2. **SWR cache key** includes cartId when present — changing cartId triggers refetch
3. **useCheckoutCart()** normalizes raw data with formatted prices and totals
4. **EPCheckoutCartSummary** works with external `cartData` prop (new) AND internal fetch (existing, unchanged)
5. **Design-time mock data** available for Studio preview
6. **No breaking changes** to existing EPCheckoutCartSummary behavior
7. **Build passes** with no type errors
8. **Tests pass** for new hooks

---

## Tests

- `src/shopper-context/__tests__/use-cart.test.ts` — fetches /api/cart, SWR cache key varies with cartId, error handling
- `src/shopper-context/__tests__/use-checkout-cart.test.ts` — normalization, null handling, formatted prices
