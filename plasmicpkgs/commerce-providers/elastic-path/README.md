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

## Studio Server Queries (SSR)

For SSR'd product data — where the initial HTML payload contains real product names, prices, and images — wire up Plasmic's Server Queries against the EP custom functions exposed by this package. The EP test project's PDP renders end-to-end this way; see `examples/ep-commerce-app-router/` for a working reference.

### 1. Loader configuration

```ts
// plasmic-init.ts
import { initPlasmicLoader } from "@plasmicapp/loader-nextjs/react-server-conditional";

export const PLASMIC = initPlasmicLoader({
  projects: [{ id: "...", token: "..." }],
  preview: true,
  // REQUIRED: without this the loader fetches the Pages Router bundle, which
  // omits per-page `serverQueriesExecFuncFileName` metadata and Server Queries
  // never execute.
  platformOptions: { nextjs: { appDir: true } },
});
```

### 2. Register the EP custom functions

```ts
// plasmic-register.ts
import { PLASMIC } from "./plasmic-init";
import { registerEpCustomFunctions } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

registerEpCustomFunctions(PLASMIC);
```

This registers four functions in the `ep` namespace, callable from Studio's Server Query builder:

- `ep.getProduct({ id })` — single product by EP product UUID.
- `ep.getCart()` — current cart contents.
- `ep.getProductList({ limit?, search?, categoryId?, sort? })` — paginated product list.
- `ep.getRelatedProducts({ productId, relationshipSlug, limit? })` — products linked by an EP custom relationship.

Auth is **not** an argument. The session (`accessToken`, `clientId`, `host`, `cartId`, …) is propagated through `AsyncLocalStorage` — see step 3.

### 3. Wrap Server Queries in `withEpSession`

```ts
// app/[[...catchall]]/page.tsx
import { PLASMIC } from "@/plasmic-init";
import { PlasmicClientRootProvider } from "@/plasmic-init-client";
import { PlasmicComponent } from "@plasmicapp/loader-nextjs";
import {
  buildEpCtx,
  withEpSession,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth, epProviderHeaders } from "@/lib/ep-auth";
import { cookies } from "next/headers";

export default async function PlasmicLoaderPage({ params, searchParams }) {
  const resolvedParams = await params;
  const plasmicPath = resolvedParams.catchall ? `/${resolvedParams.catchall.join("/")}` : "/";
  const prefetchedData = await PLASMIC.maybeFetchComponentData(plasmicPath);
  if (!prefetchedData) return null;
  const pageMeta = prefetchedData.entryCompMetas[0];

  // Resolve session (anonymous OAuth on first visit, cookie on return).
  const cookieStore = await cookies();
  const session = await epAuth.api.getSession({
    cookies: Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value])),
    headers: await epProviderHeaders(prefetchedData),
  });

  // Compose the EP session — auth + cart context for server-side EP calls.
  const epCtx = buildEpCtx(prefetchedData, {
    session: {
      accessToken: session.session?.accessToken,
      cartId: session.cart?.id ?? undefined,
      accountId: session.user?.accountId ?? undefined,
    },
  });

  // Run Studio Server Queries inside an EP session scope. Each `ep.*`
  // function reads the active session via AsyncLocalStorage — no `auth`
  // binding required in Studio, no `<DataProvider name="ep">` wrap on
  // the client side.
  const prefetchedQueryData = await withEpSession(epCtx, () =>
    PLASMIC.unstable__getServerQueriesData(prefetchedData, {
      pageRoute: pageMeta.path,
      pagePath: plasmicPath,
      params: pageMeta.params ?? {},
      query: (await searchParams) ?? {},
    })
  );

  return (
    <PlasmicClientRootProvider
      prefetchedData={prefetchedData}
      prefetchedQueryData={prefetchedQueryData}
      pageParams={pageMeta.params}
    >
      <PlasmicComponent component={pageMeta.displayName} />
    </PlasmicClientRootProvider>
  );
}
```

### 4. Bind the queries in Studio

For each Server Query in the Plasmic UI, set the function and arguments. For a product detail page (`/product/[slug]`):

- **Function:** `ep.getProduct`
- **Arguments:** `{ id: $ctx.params.slug }`

Then bind the `EPProductProvider` component's advanced `product` prop to `$q.product.data`. Server Queries appear under `$q` (not `$queries`) in the binding panel.

### 5. Resolve EP credentials from Studio config

`buildEpCtx` reads `clientId` and `host` from the EP Provider global context (configured in Studio), not from `.env.local`. The helper that powers the lookup, `extractEpProviderConfig`, scans the loader bundle for the global-context module. For projects without a homepage route, `epProviderHeaders` resolves a real page path via `PLASMIC.fetchPages()` rather than hardcoding `/`.

### Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `$q.product.data` always `null` / queries return `null` despite valid input | `withEpSession` not wrapped around `unstable__getServerQueriesData` | Wrap the query call per step 3; functions fail-soft to `null` outside an EP session scope |
| `prefetchedQueryData: "$undefined"` in the SSR HTML | `appDir: true` not set in `plasmic-init.ts` | Add `platformOptions: { nextjs: { appDir: true } }` |
| `EP OAuth failed (401) Invalid credentials` | API route's `epProviderHeaders()` returned empty (project has no homepage at `/`) | Ensure the storefront resolves a real page path via `fetchPages()` (already done if you copied `lib/ep-auth.ts` from the example) |
| Studio binding still references `auth: $ctx.ep` | Project predates PRD #272 | Drop `auth` from each Server Query argument — the session now flows via ALS, not execParams |

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

## Styling contract (catalog-search components)

The catalog-search components ship behaviour, not appearance. Every visual
choice — typography, colour, spacing, borders, focus state — is the
designer's. The components do not impose a default look that the designer
later has to override.

The contract that every catalog-search component honours:

1. **`className` lands on the visible interactive element.** The Plasmic
   style panel binds to a single class per component instance. We forward
   that class to the element designers actually want to style:

   | Component | Element that receives `className` |
   | --- | --- |
   | `EPSearchBox` | n/a — provider only, no DOM (see below) |
   | `EPCatalogSearchProvider` | the wrapper `<div data-ep-catalog-search-provider>` |
   | `EPSearchHits` | the grid `<div data-ep-search-hits>` |
   | `EPRefinementList` | the wrapper `<div data-ep-refinement-list>` |
   | `EPHierarchicalMenu` | the wrapper `<div data-ep-hierarchical-menu>` |
   | `EPRangeFilter` | the wrapper `<div data-ep-range-filter>` |
   | `EPSearchPagination` | the wrapper `<div data-ep-search-pagination>` |
   | `EPSearchStats` | the wrapper `<div data-ep-search-stats>` |
   | `EPSearchSortBy` | the wrapper `<div data-ep-search-sort-by>` |

2. **No inline `style` for appearance properties.** The components never set
   `border`, `border-radius`, `padding`, `font-*`, `color`, `background`, or
   `box-shadow` inline. CSS specificity goes class-wins-over-element, so
   designer styles always reach the rendered DOM.

3. **Inline `style` is permitted only for layout properties Plasmic strips.**
   Plasmic's canvas filters out `display`/`grid-*`/`flex-*` styles set on a
   code-component instance. `EPSearchHits` works around this by setting its
   grid layout inline, and exposing the values as `gridTemplateColumns` /
   `gridGap` props so designers can still control them.

4. **The editor and the runtime render the same DOM.** No mock-only inline
   styling that lies about runtime output — what the designer sees in the
   Plasmic canvas is what the live site renders. Test coverage in
   `__tests__/catalog-search-components.test.tsx` enforces this.

### Structural CSS via `:where()`

The components do need a small amount of structural CSS — for example,
`position: relative` on the EPSearchBox wrapper so its absolute-positioned
clear button can anchor. We ship that CSS once per page from
`headless-styling.ts`, scoped via `:where()` so every selector has zero
specificity and any designer class always wins.

If you add a new catalog-search component, follow the same pattern:

```tsx
import { useHeadlessStyling } from "./headless-styling";

export function EPNewSearchComponent({ className, ...props }) {
  useHeadlessStyling();
  return <div className={className} data-ep-new-search-component="">…</div>;
}
```

Then add a contract test alongside the existing nine in
`__tests__/catalog-search-components.test.tsx` via `describeHeadlessStylingContract`.
The helper asserts (a) the className lands on the documented leaf, (b) no
inline appearance styles are set anywhere in the rendered tree, and (c) the
editor and runtime renders produce the same root tag.

### Composing EPSearchBox

`EPSearchBox` is a provider, not a renderer. It exposes search-field state
to its slot children and otherwise renders nothing. The visible chrome —
the `<input>`, the clear `<button>` — is owned by the designer. Drop a
Plasmic-controlled input and button into the slot and wire them via
`$ctx.searchFieldData` and the registered ref-actions.

| What `EPSearchBox` exposes | Type | Use it for |
| --- | --- | --- |
| `$ctx.searchFieldData.value` | `string` | the controlled value of the input element |
| `$ctx.searchFieldData.displayValue` | `string` | the query that has actually been refined (diverges from `value` during the debounce window) |
| `$ctx.searchFieldData.isEmpty` | `boolean` | hide the clear button when nothing is typed |
| `setValue(value: string)` ref-action | | call from the input's `onChange` interaction |
| `clear()` ref-action | | call from the clear button's `onClick` interaction |

Wiring a fresh EPSearchBox in Plasmic Studio:

1. Drop an `<input>` (Plasmic's built-in tag, **not** a code component) into
   the EPSearchBox slot. Style it freely from the style panel — appearance
   reaches the live site because the input is a Plasmic-controlled tag.
2. Set the input's `value` attribute to a dynamic value: `$ctx.searchFieldData.value`.
3. Add an `onChange` interaction → custom function: `EP_SEARCH_BOX_REF.setValue(event.target.value)`,
   where `EP_SEARCH_BOX_REF` is the ref to the parent EPSearchBox instance.
4. Drop a `<button>` (also a Plasmic-controlled tag) for clear. Style it
   freely.
5. Add the button's `onClick` → custom function: `EP_SEARCH_BOX_REF.clear()`.
6. Bind the button's visibility to `!$ctx.searchFieldData.isEmpty` so it
   only shows when there's something to clear.

Why this composition: Plasmic's codegen filters appearance styles
(`padding`, `border`, `background`, `font-*`, `color`, `border-radius`,
`box-shadow`) off any code-component instance — only the Plasmic-controlled
tags (`input`, `button`, `div`, etc.) escape the filter. By making
EPSearchBox a render-children-only provider, the visible chrome is owned
by tags the designer fully controls. See PRD #308 for the long-form
rationale.

### Migration notes

Before this contract was in place, `EPSearchBox` and `EPCatalogSearchProvider`
shipped polished default styles inline. Designers who relied on those
defaults will need to re-style the component from the Plasmic style panel
after upgrading. The defaults were misleading — they appeared in the canvas
preview but only some applied at runtime — so a clean reset is healthier
than continuing to ship the lie.

PRD #308 also moved EPSearchBox from a chrome-rendering component to a
provider. Existing EPSearchBox instances will lose their input and clear
button; re-author the slot per the wiring steps above.
