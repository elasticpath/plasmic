# Server-Only Cart Architecture with ShopperContext

## Status: Ready to Build
## Date: 2026-03-09

---

## Problem

The EP commerce provider package (`plasmicpkgs/commerce-providers/elastic-path/`) currently has:

1. **Client-side EP SDK** — Cart hooks (`src/cart/use-cart.tsx`, `use-add-item.tsx`, etc.) call EP API directly from the browser via `@epcc-sdk/sdks-shopper`
2. **JS-readable cart cookie** — `src/utils/cart-cookie.ts` uses `js-cookie` to read/write `elasticpath_cart` cookie, visible to client JS
3. **CommerceProvider exposes credentials** — `src/registerCommerceProvider.tsx` takes `clientId` as a Plasmic prop, initializing the EP SDK client in the browser
4. **No Studio cart preview** — In Plasmic Studio the dev host runs in a cross-origin iframe, so cookies don't work. Designers can't see real cart data.

Additionally, consumer apps (like the Ember & Wick storefront) have competing cart identity mechanisms: EP SDK cookie vs URL param on checkout pages.

## Solution

Server-only cart architecture with a ShopperContext override channel.

### Principles

1. **Cart cookie is httpOnly** — JS never reads it, XSS can't steal it
2. **EP credentials are server-only** — no client ID in the browser for cart operations
3. **All cart operations go through `/api/cart/*`** — consumer app's server reads cookie, calls EP API
4. **ShopperContext provides an explicit override channel** — for Studio preview and checkout URL params
5. **When no override exists, cookie is the implicit identity** — zero config for normal browsing

---

## Package vs Consumer Responsibilities

This architecture splits work between the **EP commerce provider package** (this repo) and the **consumer storefront app**.

### Package Provides (built in this repo)

| Component | Location | Purpose |
|-----------|----------|---------|
| ShopperContext | `src/shopper-context/ShopperContext.tsx` | GlobalContext with override channel |
| useShopperContext | `src/shopper-context/useShopperContext.ts` | Hook to read current overrides |
| useShopperFetch | `src/shopper-context/useShopperFetch.ts` | Fetch wrapper with X-Shopper-Context header |
| useCart | `src/shopper-context/use-cart.ts` | SWR cart hook via server routes |
| useCheckoutCart | `src/shopper-context/use-checkout-cart.ts` | Normalized cart for checkout display |
| useAddItem | `src/shopper-context/use-add-item.ts` | Add-to-cart mutation via server route |
| useRemoveItem | `src/shopper-context/use-remove-item.ts` | Remove item mutation via server route |
| useUpdateItem | `src/shopper-context/use-update-item.ts` | Update quantity mutation via server route |
| Server utilities | `src/shopper-context/server/` | resolveCartId, cart cookie helpers |

### Consumer App Implements (NOT built in this repo)

| Component | Purpose |
|-----------|---------|
| `pages/api/cart/index.ts` | GET cart (resolve cartId, call EP, return data) |
| `pages/api/cart/items/index.ts` | POST add item (auto-create cart if needed) |
| `pages/api/cart/items/[id].ts` | PUT update / DELETE remove item |
| `pages/api/cart/promo.ts` | POST/DELETE promo codes |
| `pages/_app.tsx` | Wrap app in ShopperContext |
| `CartPayButton.tsx` | Use ShopperContext instead of router.query |

The consumer app uses the package's server utilities to implement these routes. Reference implementation: `clover/worktree-alpha/apps/storefront/.ralph/specs/`.

---

## Architecture

### Data Flow (Normal Browsing)

```
Browser                          Next.js Server                 EP API
  |                                    |                            |
  | GET /api/cart ------------------>  |                            |
  | (httpOnly cookie auto-sent)        | resolveCartId(req)        |
  |                                    | header? no → cookie       |
  |                                    | GET /v2/carts/{id}?inc=items -> |
  |                                    | <-- cart data ------------ |
  | <-- { items, totals, ... } -----  |                            |
```

### Data Flow (Checkout / Studio Override)

```
Browser                          Next.js Server                 EP API
  |                                    |                            |
  | GET /api/cart                      |                            |
  |   Header: X-Shopper-Context:      |                            |
  |   {"cartId":"abc123"} ---------->  | resolveCartId(req)        |
  |                                    | header? yes → "abc123"    |
  |                                    | ALSO sets httpOnly cookie  |
  |                                    | GET /v2/carts/abc123 ----> |
  |                                    | <-- cart data ------------ |
  | <-- { items, totals, ... } -----  |                            |
```

### Resolution Priority (Server-Side)

```typescript
function resolveCartId(req: NextApiRequest): string | null {
  // 1. Explicit override (X-Shopper-Context header)
  const header = req.headers['x-shopper-context'];
  if (header) {
    const ctx = JSON.parse(header as string);
    if (ctx.cartId) return ctx.cartId;
  }

  // 2. httpOnly cookie
  return req.cookies.ep_cart || null;
}
```

---

## Migration Plan

| Phase | Spec | Goal | Depends On |
|-------|------|------|------------|
| 0 | `phase-0-shopper-context.md` | ShopperContext + useShopperFetch + server utilities | Nothing |
| 1 | `phase-1-cart-reads.md` | Replace cart read hooks with server-route SWR hooks | Phase 0 |
| 2 | `phase-2-cart-mutations.md` | Replace cart mutation hooks (add/remove/update) | Phase 1 |
| 3 | `phase-3-credential-removal.md` | Remove client-side EP credentials + cleanup | Phase 2 |

---

## What Stays the Same

- **EP API endpoints** — same REST calls, just from server instead of browser
- **Cart data shape** — normalization happens server-side, returns same structure
- **Plasmic component tree** — EPCheckoutCartSummary, cart drawer, etc. still exist
- **Existing composable components** — EPCheckoutCartField, EPCheckoutCartItemList, EPPromoCodeInput, etc.
- **Design-time mock data** — still used when no real cart data

## What Changes

| Before | After |
|--------|-------|
| EP SDK client in browser | EP SDK on server only (for cart ops) |
| `js-cookie` reads cart ID | httpOnly cookie, server reads |
| Cart hooks call EP API directly | Cart hooks call `/api/cart/*` |
| No Studio cart preview | ShopperContext → paste cart ID → real data |
| Cookie and URL disagree | Single resolution: header > cookie |
| `clientId` visible in browser | Credentials server-only (for cart ops) |

---

## New Package Directory Structure

```
src/shopper-context/
  index.ts                      — barrel exports (client + server)
  ShopperContext.tsx             — GlobalContext React component
  useShopperContext.ts           — React hook to read overrides
  useShopperFetch.ts            — Fetch wrapper with X-Shopper-Context header
  use-cart.ts                   — SWR cart hook via /api/cart (Phase 1)
  use-checkout-cart.ts          — Normalized checkout cart (Phase 1)
  use-add-item.ts               — Add item mutation (Phase 2)
  use-remove-item.ts            — Remove item mutation (Phase 2)
  use-update-item.ts            — Update quantity mutation (Phase 2)
  design-time-data.ts           — Mock data for Studio preview
  server/
    index.ts                    — Server barrel exports
    resolve-cart-id.ts          — Header > cookie resolution
    cart-cookie.ts              — httpOnly cookie management
```
