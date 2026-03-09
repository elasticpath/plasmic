# Phase 2: Replace Cart Mutation Hooks

## Status: Ready to Build
## Date: 2026-03-09
## Depends on: Phase 1 (useCart with mutate() for refetch)
## Unblocks: Full cart lifecycle via server routes (add, remove, update)

---

## Goal

Add server-route-based cart mutation hooks to the package. After this phase:
- All cart operations go through `/api/cart/*` server routes
- No EP SDK calls from the browser for cart operations
- PDP "Add to Cart", cart page quantity controls, and remove buttons can use new hooks
- Consumer app implements the server routes; package provides the client hooks

---

## Deliverables

### D1: `src/shopper-context/use-add-item.ts`

```typescript
// src/shopper-context/use-add-item.ts
import { useCallback } from 'react';
import { useShopperFetch } from './useShopperFetch';
import { useCart } from './use-cart';

export interface AddItemInput {
  productId: string;
  variantId?: string;
  quantity?: number;
  bundleConfiguration?: unknown;
  locationId?: string;
  selectedOptions?: {
    variationId: string;
    optionId: string;
    optionName: string;
    variationName: string;
  }[];
}

/**
 * Returns a function to add an item to the cart via POST /api/cart/items.
 * Auto-refetches cart data after successful add.
 *
 * Consumer app must implement POST /api/cart/items that:
 * - Resolves cartId from header/cookie
 * - Auto-creates cart if none exists
 * - Adds item to EP cart
 * - Sets httpOnly cookie
 */
export function useAddItem() {
  const shopperFetch = useShopperFetch();
  const { mutate } = useCart();

  return useCallback(
    async (item: AddItemInput) => {
      const result = await shopperFetch('/api/cart/items', {
        method: 'POST',
        body: JSON.stringify(item),
      });
      await mutate(); // refetch cart
      return result;
    },
    [shopperFetch, mutate]
  );
}
```

---

### D2: `src/shopper-context/use-remove-item.ts`

```typescript
// src/shopper-context/use-remove-item.ts
import { useCallback } from 'react';
import { useShopperFetch } from './useShopperFetch';
import { useCart } from './use-cart';

/**
 * Returns a function to remove an item from the cart via DELETE /api/cart/items/{id}.
 * Auto-refetches cart data after successful removal.
 */
export function useRemoveItem() {
  const shopperFetch = useShopperFetch();
  const { mutate } = useCart();

  return useCallback(
    async (itemId: string) => {
      await shopperFetch(`/api/cart/items/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      });
      await mutate();
    },
    [shopperFetch, mutate]
  );
}
```

---

### D3: `src/shopper-context/use-update-item.ts`

```typescript
// src/shopper-context/use-update-item.ts
import { useCallback, useRef } from 'react';
import { useShopperFetch } from './useShopperFetch';
import { useCart } from './use-cart';
import { DEFAULT_DEBOUNCE_MS } from '../const';

/**
 * Returns a function to update item quantity via PUT /api/cart/items/{id}.
 * Debounced at DEFAULT_DEBOUNCE_MS (500ms) to handle rapid +/- clicks.
 *
 * Quantity 0 = remove (server handles this).
 */
export function useUpdateItem() {
  const shopperFetch = useShopperFetch();
  const { mutate } = useCart();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  return useCallback(
    (itemId: string, quantity: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(async () => {
        await shopperFetch(`/api/cart/items/${encodeURIComponent(itemId)}`, {
          method: 'PUT',
          body: JSON.stringify({ quantity }),
        });
        await mutate();
      }, DEFAULT_DEBOUNCE_MS);
    },
    [shopperFetch, mutate]
  );
}
```

Uses existing `DEFAULT_DEBOUNCE_MS` from `src/const.ts` (already 500ms).

---

### D4: Export from barrel

Update `src/shopper-context/index.ts`:

```typescript
// Add to existing exports:
export { useAddItem, type AddItemInput } from './use-add-item';
export { useRemoveItem } from './use-remove-item';
export { useUpdateItem } from './use-update-item';
```

---

## Consumer API Route Contract

The consumer app must implement these server routes. The package provides `resolveCartId` and `buildCartCookieHeader` utilities for the implementation.

| Route | Method | Purpose | Request Body |
|-------|--------|---------|--------------|
| `/api/cart/items` | POST | Add item | `AddItemInput` |
| `/api/cart/items/{id}` | PUT | Update quantity | `{ quantity: number }` |
| `/api/cart/items/{id}` | DELETE | Remove item | — |
| `/api/cart/promo` | POST | Apply promo code | `{ code: string }` |
| `/api/cart/promo` | DELETE | Remove promo | `{ promoItemId: string }` |

All routes should:
1. Call `resolveCartId(req.headers, req.cookies)` to get cart ID
2. Call EP API with server-only credentials
3. Call `buildCartCookieHeader(cartId)` and set on response
4. Return cart data or error

Reference implementation: `clover/worktree-alpha/apps/storefront/.ralph/specs/phase-2-cart-mutations.md`

---

## File Changes Summary

| File | Action |
|------|--------|
| `src/shopper-context/use-add-item.ts` | **Create** |
| `src/shopper-context/use-remove-item.ts` | **Create** |
| `src/shopper-context/use-update-item.ts` | **Create** |
| `src/shopper-context/index.ts` | **Edit** — add 3 new exports |

---

## Acceptance Criteria

1. **useAddItem** calls POST /api/cart/items with correct body, refetches cart
2. **useRemoveItem** calls DELETE /api/cart/items/{id}, refetches cart
3. **useUpdateItem** calls PUT /api/cart/items/{id}, debounced at 500ms, refetches cart
4. **All mutations attach X-Shopper-Context header** when overrides present
5. **URL-encode item IDs** in path to prevent injection
6. **Build passes** with no type errors
7. **Tests pass** for all new hooks

---

## Tests

- `src/shopper-context/__tests__/use-add-item.test.ts` — POST call, body shape, mutate called
- `src/shopper-context/__tests__/use-remove-item.test.ts` — DELETE call, mutate called
- `src/shopper-context/__tests__/use-update-item.test.ts` — PUT call, debounce behavior, mutate called after debounce
