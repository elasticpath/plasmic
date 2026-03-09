# Phase 0: ShopperContext + Server Utilities

## Status: Ready to Build
## Date: 2026-03-09
## Depends on: Nothing (first phase)
## Unblocks: Phase 1 (cart reads via server routes)

---

## Goal

Create the ShopperContext GlobalContext component, useShopperFetch hook, and server-side utilities in the EP commerce provider package. After this phase:

1. `ShopperContext` is registered as a Plasmic GlobalContext — designers can paste a cart UUID in Studio
2. `useShopperFetch` attaches `X-Shopper-Context` header when overrides are present
3. Server utilities (`resolveCartId`, `setCartCookie`, etc.) are exported for consumer app API routes
4. No existing cart hooks are modified yet — that's Phase 1+

---

## Deliverables

### D1: `src/shopper-context/ShopperContext.tsx` (GlobalContext Component)

Provides an override channel for cart identity (and future shopper attributes).

```typescript
// src/shopper-context/ShopperContext.tsx
import React, { useMemo } from 'react';

export interface ShopperOverrides {
  cartId?: string;
  accountId?: string;
  locale?: string;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Use Symbol.for + globalThis to guarantee singleton context even if the
// bundle is loaded multiple times (e.g. CJS + ESM, HMR).
// Matches BundleContext.tsx / CartDrawerContext.tsx pattern.
//
// NOTE: Default value is {} (empty overrides = production mode),
// NOT null like BundleContext which requires a provider. ShopperContext
// should work without a provider (hooks return {} = no overrides).
// ---------------------------------------------------------------------------

const SHOPPER_CTX_KEY = Symbol.for('@elasticpath/ep-shopper-context');

function getSingletonContext(): React.Context<ShopperOverrides> {
  const g = globalThis as any;
  if (!g[SHOPPER_CTX_KEY]) {
    g[SHOPPER_CTX_KEY] = React.createContext<ShopperOverrides>({});
  }
  return g[SHOPPER_CTX_KEY];
}

export function getShopperContext() {
  return getSingletonContext();
}

export interface ShopperContextProps extends ShopperOverrides {
  children?: React.ReactNode;
}

/**
 * ShopperContext GlobalContext — provides override channel for cart identity.
 *
 * Priority: URL query param (injected by consumer) > Plasmic prop > empty (server uses cookie)
 *
 * In Plasmic Studio: designer fills cartId in GlobalContext settings.
 * In production checkout: consumer wraps in ShopperContext with cartId from URL.
 * In production browsing: no overrides — server resolves from httpOnly cookie.
 */
export function ShopperContext({
  cartId,
  accountId,
  locale,
  currency,
  children,
}: ShopperContextProps) {
  const ShopperCtx = getSingletonContext();

  const effective = useMemo<ShopperOverrides>(() => ({
    cartId: cartId || undefined,
    accountId: accountId || undefined,
    locale: locale || undefined,
    currency: currency || undefined,
  }), [cartId, accountId, locale, currency]);

  return (
    <ShopperCtx.Provider value={effective}>{children}</ShopperCtx.Provider>
  );
}
```

**Key design decisions:**
- Uses `Symbol.for + globalThis` singleton pattern matching existing `BundleContext.tsx` and `CartDrawerContext.tsx` — prevents duplicate contexts across module instances
- Does NOT use `useRouter()` — the package is framework-agnostic. URL param reading is the consumer's responsibility (pass `cartId` prop from `router.query.cartId`)
- Props are simple strings — the consumer maps URL params, env vars, or Plasmic state to these

---

### D2: `src/shopper-context/useShopperContext.ts` (Hook)

```typescript
// src/shopper-context/useShopperContext.ts
import { useContext } from 'react';
import { getShopperContext, type ShopperOverrides } from './ShopperContext';

/**
 * Read the current ShopperContext overrides.
 * Returns {} when no ShopperContext provider is above this component.
 */
export function useShopperContext(): ShopperOverrides {
  return useContext(getShopperContext());
}
```

---

### D3: `src/shopper-context/useShopperFetch.ts` (Fetch Wrapper)

```typescript
// src/shopper-context/useShopperFetch.ts
import { useCallback } from 'react';
import { useShopperContext } from './useShopperContext';

/**
 * Returns a fetch function that auto-attaches X-Shopper-Context header
 * when ShopperContext has overrides (Studio preview or checkout URL).
 *
 * Consumer's API routes parse this header via resolveCartId() to resolve identity.
 */
export function useShopperFetch() {
  const overrides = useShopperContext();

  return useCallback(
    async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      // Only send header when there ARE active overrides
      const active = Object.fromEntries(
        Object.entries(overrides).filter(([, v]) => v != null)
      );
      if (Object.keys(active).length > 0) {
        headers.set('X-Shopper-Context', JSON.stringify(active));
      }

      const res = await fetch(path, {
        ...init,
        headers,
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }

      return res.json() as Promise<T>;
    },
    [overrides]
  );
}
```

---

### D4: `src/shopper-context/server/resolve-cart-id.ts` (Server Utility)

Exported for consumer API routes to resolve cart identity from header or cookie.

```typescript
// src/shopper-context/server/resolve-cart-id.ts

export interface ShopperHeader {
  cartId?: string;
  accountId?: string;
  locale?: string;
  currency?: string;
}

/**
 * Parse X-Shopper-Context header from incoming request.
 * Returns {} if absent or malformed.
 *
 * Works with any request-like object that has headers.
 */
export function parseShopperHeader(headers: Record<string, string | string[] | undefined>): ShopperHeader {
  const raw = headers['x-shopper-context'];
  if (!raw || typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Resolve cart ID from request.
 * Priority: X-Shopper-Context header > httpOnly cookie > null.
 *
 * @param headers - Request headers object
 * @param cookies - Parsed cookies object
 * @param cookieName - Name of the httpOnly cart cookie (default: 'ep_cart')
 */
export function resolveCartId(
  headers: Record<string, string | string[] | undefined>,
  cookies: Record<string, string | undefined>,
  cookieName = 'ep_cart'
): string | null {
  const header = parseShopperHeader(headers);
  if (header.cartId) return header.cartId;
  return cookies[cookieName] || null;
}
```

**Note:** This uses generic types (not Next.js-specific) so it works with any Node.js framework.

---

### D5: `src/shopper-context/server/cart-cookie.ts` (Server Utility)

```typescript
// src/shopper-context/server/cart-cookie.ts

const DEFAULT_COOKIE_NAME = 'ep_cart';

export interface CartCookieOptions {
  cookieName?: string;
  secure?: boolean;
  maxAge?: number;
  path?: string;
}

const defaults: Required<CartCookieOptions> = {
  cookieName: DEFAULT_COOKIE_NAME,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60, // 30 days
  path: '/',
};

/**
 * Build Set-Cookie header value for cart ID.
 * Consumer calls res.setHeader('Set-Cookie', ...) with this value.
 */
export function buildCartCookieHeader(cartId: string, opts?: CartCookieOptions): string {
  const { cookieName, secure, maxAge, path } = { ...defaults, ...opts };
  const parts = [
    `${cookieName}=${encodeURIComponent(cartId)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Build Set-Cookie header value to clear the cart cookie.
 */
export function buildClearCartCookieHeader(opts?: CartCookieOptions): string {
  const { cookieName, path } = { ...defaults, ...opts };
  return `${cookieName}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`;
}
```

**Note:** No dependency on `cookie` package — builds the header string directly. The consumer sets it on the response.

---

### D6: `src/shopper-context/server/index.ts` (Server Barrel)

```typescript
// src/shopper-context/server/index.ts
export { parseShopperHeader, resolveCartId, type ShopperHeader } from './resolve-cart-id';
export { buildCartCookieHeader, buildClearCartCookieHeader, type CartCookieOptions } from './cart-cookie';
```

---

### D7: `src/shopper-context/index.ts` (Client Barrel)

```typescript
// src/shopper-context/index.ts
export { ShopperContext, getShopperContext, type ShopperOverrides, type ShopperContextProps } from './ShopperContext';
export { useShopperContext } from './useShopperContext';
export { useShopperFetch } from './useShopperFetch';
```

---

### D8: Registration

Create `src/shopper-context/registerShopperContext.ts` following the existing pattern (each component has a `register*` function).

```typescript
// src/shopper-context/registerShopperContext.ts
import registerGlobalContext from "@plasmicapp/host/registerGlobalContext";
import { ShopperContext, type ShopperContextProps } from './ShopperContext';
import type { Registerable } from '../registerable';
import type { GlobalContextMeta } from "@plasmicapp/host";

export const shopperContextMeta: GlobalContextMeta<ShopperContextProps> = {
  name: 'plasmic-commerce-ep-shopper-context',
  displayName: 'EP Shopper Context',
  description: 'Override channel for cart identity. Paste a cart UUID for Studio preview. In production, leave empty — the server uses an httpOnly cookie.',
  props: {
    cartId: {
      type: 'string',
      displayName: 'Cart ID',
      description: 'Override cart ID for preview. Leave empty for production cookie-based flow.',
    },
    accountId: {
      type: 'string',
      displayName: 'Account ID',
      description: 'Future: logged-in customer ID.',
      advanced: true,
    },
    locale: {
      type: 'string',
      displayName: 'Locale',
      description: 'Future: locale override (e.g., en-US).',
      advanced: true,
    },
    currency: {
      type: 'string',
      displayName: 'Currency',
      description: 'Future: currency override (e.g., USD, GBP).',
      advanced: true,
    },
  },
  importPath: '@elasticpath/plasmic-ep-commerce-elastic-path',
  importName: 'ShopperContext',
};

export function registerShopperContext(loader?: Registerable) {
  const doRegister: typeof registerGlobalContext = (...args) =>
    loader ? loader.registerGlobalContext(...args) : registerGlobalContext(...args);
  doRegister(ShopperContext, shopperContextMeta);
}
```

Then add to `src/index.tsx`:

```typescript
// Add import:
import { registerShopperContext } from './shopper-context/registerShopperContext';

// Add to registerAll(), right after registerCommerceProvider(loader):
registerShopperContext(loader);
```

Also export from `src/index.tsx`:
```typescript
export * from './shopper-context';
```

---

### D9: Package exports

Add shopper-context exports to `package.json` if using subpath exports, or ensure the barrel is importable.

The consumer app imports:
```typescript
// Client-side (hooks, components)
import { ShopperContext, useShopperContext, useShopperFetch } from '@elasticpath/plasmic-ep-commerce-elastic-path/shopper-context';

// Server-side (API route utilities)
import { resolveCartId, buildCartCookieHeader } from '@elasticpath/plasmic-ep-commerce-elastic-path/shopper-context/server';
```

---

## Constants

Add to `src/const.ts`:

```typescript
export const EP_CART_COOKIE_NAME = 'ep_cart';
export const SHOPPER_CONTEXT_HEADER = 'x-shopper-context';
```

---

## File Changes Summary

| File | Action |
|------|--------|
| `src/shopper-context/ShopperContext.tsx` | **Create** |
| `src/shopper-context/useShopperContext.ts` | **Create** |
| `src/shopper-context/useShopperFetch.ts` | **Create** |
| `src/shopper-context/server/resolve-cart-id.ts` | **Create** |
| `src/shopper-context/server/cart-cookie.ts` | **Create** |
| `src/shopper-context/server/index.ts` | **Create** |
| `src/shopper-context/index.ts` | **Create** |
| `src/shopper-context/registerShopperContext.ts` | **Create** |
| `src/index.tsx` | **Edit** — add import, register call, and export |
| `src/const.ts` | **Edit** — add 2 constants |

---

## Acceptance Criteria

1. **ShopperContext renders children** when props are empty (production mode)
2. **ShopperContext provides overrides** when `cartId` prop is set (Studio mode)
3. **useShopperFetch attaches header** when overrides exist — verify header content
4. **useShopperFetch omits header** when no overrides — no header on request
5. **resolveCartId** returns header cartId when present, cookie when not, null when neither
6. **buildCartCookieHeader** produces valid Set-Cookie string with httpOnly flag
7. **Singleton context** — two imports of `getShopperContext()` return the same React context
8. **Build passes** — `yarn build` in `plasmicpkgs/commerce-providers/elastic-path/` succeeds
9. **Tests pass** — unit tests for all new modules

---

## Tests

Create `src/shopper-context/__tests__/`:

- `ShopperContext.test.tsx` — renders children, provides overrides, empty when no props
- `useShopperFetch.test.ts` — attaches header when overrides present, omits when empty
- `server/resolve-cart-id.test.ts` — priority: header > cookie > null
- `server/cart-cookie.test.ts` — valid httpOnly cookie string, clear cookie string
