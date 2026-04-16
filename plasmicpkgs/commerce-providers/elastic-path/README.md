# @elasticpath/plasmic-ep-commerce-elastic-path

Elastic Path commerce components for Plasmic. Server-side auth, SSR product data, cart operations — all wired through a Better Auth-aligned session pattern.

## Quick Start (4 files)

### 1. Create the auth instance

```ts
// lib/ep-auth.ts
import { createEpAuth } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

export const epAuth = createEpAuth({
  // Same values configured on the EP Provider in Plasmic Studio
  clientId: "your-ep-client-id",
  host: "https://useast.api.elasticpath.com",

  // Optional: checkout session encryption
  checkout: { sessionSecret: process.env.CHECKOUT_SESSION_SECRET! },

  // Optional: payment adapters
  adapters: { stripe: { secretKey: process.env.STRIPE_SECRET_KEY! } },

  // Optional: custom API route prefix (default: /api/ep)
  // basePath: "/api/store",

  // Optional: cart merge strategy on login (default: "merge")
  // cartMergeStrategy: "replace",
});
```

### 2. Mount the catch-all API route

**App Router:**

```ts
// app/api/ep/[...path]/route.ts
import { toNextJsHandler } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

export const { GET, POST, PATCH, DELETE } = toNextJsHandler(epAuth);
```

**Pages Router:**

```ts
// pages/api/ep/[...path].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { toNextJsHandler } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

const handlers = toNextJsHandler(epAuth);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method?.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
  const fn = handlers[method];
  if (!fn) return res.status(405).end();

  const response = await fn({
    url: `http://localhost${req.url}`,
    cookies: req.cookies as Record<string, string>,
    headers: req.headers as Record<string, string>,
    json: () => Promise.resolve(req.body),
  });

  // Forward response headers (Set-Cookie for token refresh)
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.status(response.status).json(await response.json());
}
```

### 3. Wire the page with session

**App Router:**

```tsx
// app/[[...catchall]]/page.tsx
import { epAuth } from "@/lib/ep-auth";
import {
  PlasmicRootProvider,
  PlasmicComponent,
  extractPlasmicQueryData,
} from "@plasmicapp/loader-nextjs";
import { PLASMIC } from "@/plasmic-init";
import { cookies } from "next/headers";

export default async function Page({ params }: { params: { catchall?: string[] } }) {
  const pagePath = "/" + (params.catchall?.join("/") ?? "");
  const plasmicData = await PLASMIC.fetchComponentData(pagePath);
  if (!plasmicData) return <div>Not found</div>;

  // Resolve EP session from cookies (returning visitor) or OAuth (first visit)
  const cookieStore = await cookies();
  const session = await epAuth.api.getSession({
    cookies: Object.fromEntries(
      cookieStore.getAll().map((c) => [c.name, c.value])
    ),
  });

  // SSR: extract query data with server token injected
  const queryData = await extractPlasmicQueryData(
    <PlasmicRootProvider
      loader={PLASMIC}
      prefetchedData={plasmicData}
      globalContextsProps={{
        "plasmic-commerce-elastic-path-provider": session.providerProps(),
      }}
    >
      <PlasmicComponent component={pagePath} />
    </PlasmicRootProvider>
  );

  // Set ep_token cookie for subsequent visits (no-op if token came from cookie)
  session.commitCookies({
    appendHeader(name, value) {
      cookieStore.set(name, value);
    },
  });

  return (
    <PlasmicRootProvider
      loader={PLASMIC}
      prefetchedData={plasmicData}
      prefetchedQueryData={queryData}
      globalContextsProps={{
        "plasmic-commerce-elastic-path-provider": session.providerProps(),
      }}
    >
      <PlasmicComponent component={pagePath} />
    </PlasmicRootProvider>
  );
}
```

**Pages Router:**

```tsx
// pages/[[...catchall]].tsx
import type { GetServerSideProps } from "next";
import { epAuth } from "@/lib/ep-auth";
import {
  PlasmicRootProvider,
  PlasmicComponent,
  ComponentRenderData,
  extractPlasmicQueryData,
} from "@plasmicapp/loader-nextjs";
import { PLASMIC } from "@/plasmic-init";

export const getServerSideProps: GetServerSideProps = async ({ req, res, params }) => {
  const pagePath = "/" + ((params?.catchall as string[])?.join("/") ?? "");
  const plasmicData = await PLASMIC.fetchComponentData(pagePath);
  if (!plasmicData) return { notFound: true };

  // Resolve EP session from cookies (returning visitor) or OAuth (first visit)
  const session = await epAuth.api.getSession({
    cookies: req.cookies as Record<string, string>,
  });

  // SSR: extract query data with server token injected
  const queryData = await extractPlasmicQueryData(
    <PlasmicRootProvider
      loader={PLASMIC}
      prefetchedData={plasmicData}
      globalContextsProps={{
        "plasmic-commerce-elastic-path-provider": session.providerProps(),
      }}
    >
      <PlasmicComponent component={pagePath} />
    </PlasmicRootProvider>
  );

  // Set ep_token cookie for subsequent visits (no-op if token came from cookie)
  session.commitCookies({
    appendHeader(name: string, value: string) {
      res.appendHeader(name, value);
    },
  });

  return {
    props: { plasmicData, queryData, pagePath },
  };
};

export default function Page({
  plasmicData,
  queryData,
  pagePath,
}: {
  plasmicData: ComponentRenderData;
  queryData: Record<string, any>;
  pagePath: string;
}) {
  return (
    <PlasmicRootProvider
      loader={PLASMIC}
      prefetchedData={plasmicData}
      prefetchedQueryData={queryData}
    >
      <PlasmicComponent component={pagePath} />
    </PlasmicRootProvider>
  );
}
```

### 4. Environment variables

```bash
# .env.local — only genuine secrets, no EP credentials
CHECKOUT_SESSION_SECRET=your-32-char-secret-key-here
STRIPE_SECRET_KEY=sk_test_...
```

## Architecture

### Token Lifecycle

```
First visit:
  page.tsx → epAuth.api.getSession() → OAuth with clientId → serverToken
  → EP Provider (prepass) → product data SSRs
  → commitCookies() → httpOnly ep_token cookie set

Returning visit:
  page.tsx → epAuth.api.getSession() → reads ep_token cookie → serverToken
  → EP Provider (prepass) → product data SSRs → zero OAuth calls
```

The access token never reaches the browser. It flows through:
1. Server-side `getSession()` → httpOnly cookie
2. `providerProps()` → `globalContextsProps` (server-only, not serialized to HTML)
3. EP Provider `getServerInfo` → `providedContexts` (server prepass only)
4. Product components `getServerInfo` → `ops.readContext("ep-server-token")`

### API Routes

The catch-all handler (`toNextJsHandler`) provides:

| Method | Path | Description |
|--------|------|-------------|
| GET | `{basePath}/cart` | Get cart contents |
| POST | `{basePath}/cart/items` | Add item to cart |
| PATCH | `{basePath}/cart/items/:id` | Update item quantity |
| DELETE | `{basePath}/cart/items/:id` | Remove item from cart |

Every response includes `accountStatus: "authenticated" | "expired" | "anonymous"`.

### Cookie Architecture

| Cookie | Contents | Max-Age | Purpose |
|--------|----------|---------|---------|
| `ep_token` | base64 JSON (token + credentials) | 30 days | Implicit token, self-refreshes |
| `ep_account` | base64 JSON (account info) | Until expiry | Account auth (logged-in shopper) |
| `ep_cart` | Cart UUID string | 30 days | Cart identity |

All cookies: `HttpOnly; SameSite=Lax; Path=/`. `Secure` in production.

### Server-Side Rendering

Product components implement `getServerInfo` for the Loader v2 RSC-native path:

- **EP Provider** → provides `ep-server-token` and `ep-host` contexts
- **EPProductProvider** → fetches single product via EP catalog API
- **EPProductListProvider** → fetches paginated product list
- **EPRelatedProductsProvider** → fetches related products

Data flows through `ops.fetchData()` → SWR cache → `prefetchedQueryData` → client hydration. Product data SSRs for SEO. Token never enters the cache.

### Better Auth Alignment

The API follows [Better Auth](https://better-auth.com/) conventions:

| EP Commerce | Better Auth |
|-------------|-------------|
| `createEpAuth()` | `betterAuth()` |
| `epAuth.api.getSession(req)` | `auth.api.getSession(req)` |
| `toNextJsHandler(epAuth)` | `toNextJsHandler(auth)` |
| `session.user` / `session.session` | `session.user` / `session.session` |

## Components

### Core
- **EP Provider** — Global context: `clientId`, `host`, `locale`, `serverCartMode`, `serverToken`
- **Shopper Context** — Global context: `cartId`, `accountId`, `basePath` overrides

### Product Display
- **EPProductProvider** — Single product data (with `getServerInfo` for SSR)
- **EPProductListProvider** — Paginated product listing (with `getServerInfo`)
- **EPRelatedProductsProvider** — Related products (with `getServerInfo`)
- **EPProductGrid** — Repeater for product list items

### Cart
- **EPCartDrawer** / **EPCartInline** — Cart display
- **EPCartDrawerTrigger** — Opens cart drawer
- **EPCartItemList** — Cart item repeater
- **EPCartItemField** / **EPCartItemImage** — Cart item display
- **EPCartItemQuantityControl** / **EPCartItemQuantityButton** — Quantity adjustment
- **EPCartItemRemoveButton** — Remove item
- **EPCartField** — Cart totals and metadata
- **EPAddToCartButton** — Add to cart action

### Checkout (Composable)
- **EPCheckoutProvider** — Checkout state management
- **EPCheckoutStepIndicator** — Multi-step progress
- **EPCustomerInfoFields** / **EPShippingAddressFields** / **EPBillingAddressFields** — Form fields
- **EPShippingMethodSelector** — Shipping options
- **EPPaymentElements** — Payment form
- **EPCheckoutButton** — Place order
- **EPOrderTotalsBreakdown** — Order summary
- **EPCheckoutCartSummary** / **EPCheckoutCartItemList** — Cart in checkout
- **EPPromoCodeInput** — Promo codes
- **EPCountrySelect** — Country picker

### Checkout (Session-based)
- **EPCheckoutSessionProvider** — Server-authoritative session
- **EPStripePayment** / **EPCloverPayment** — Payment adapters

### Variations
- **EPVariationPicker** / **EPVariationOptionList** / **EPVariationOptionTrigger** — Product variant selection
- **EPVariationField** / **EPVariationOptionField** — Variant display

### Bundles
- **EPBundleProvider** — Bundle configuration
- **EPBundleComponentList** / **EPBundleOptionList** — Bundle structure
- **EPBundleOptionTrigger** / **EPBundleOptionField** — Option selection
- **EPBundleVariationPicker** — Bundle variant selection
- **EPBundlePriceField** / **EPBundleValidationErrors** — Bundle metadata

### Stock / Inventory
- **EPStockProvider** — Multi-location inventory
- **EPLocationPicker** / **EPLocationList** / **EPLocationField** — Location selection
- **EPStockField** — Stock level display

### Catalog Search
- **EPCatalogSearchProvider** — Algolia InstantSearch wrapper
- **EPSearchBox** / **EPSearchHits** / **EPSearchPagination** — Search UI
- **EPRefinementList** / **EPHierarchicalMenu** / **EPRangeFilter** — Faceted filtering
- **EPSearchStats** / **EPSearchSortBy** — Search metadata
