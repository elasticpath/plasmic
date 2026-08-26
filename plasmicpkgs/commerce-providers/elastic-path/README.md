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

  // Session cookie secret. Read it straight from the environment — no `!`
  // and no fallback: a missing value must fail loudly in production, not
  // silently become a guessable key.
  secret: process.env.CHECKOUT_SESSION_SECRET,

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
import { createEpAuthRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

export const { GET, POST } = createEpAuthRoutes(epAuth);
```

**Pages Router:**

```ts
// pages/api/ep/[...path].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createEpAuthRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

const handlers = createEpAuthRoutes(epAuth);

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method?.toUpperCase() as "GET" | "POST";
  const fn = handlers[method];
  if (!fn) return res.status(405).end();

  // The handlers take a WHATWG Request, so rebuild one from the Node req.
  const url = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}${req.url}`;
  const body =
    method === "GET"
      ? undefined
      : await new Promise<string>((resolve) => {
          let raw = "";
          req.on("data", (chunk) => (raw += chunk));
          req.on("end", () => resolve(raw));
        });

  const response = await fn(
    new Request(url, {
      method,
      headers: req.headers as Record<string, string>,
      body,
    })
  );

  // Set-Cookie must be forwarded as a list — setHeader would collapse it.
  res.setHeader("Set-Cookie", response.headers.getSetCookie());
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  res.status(response.status).send(await response.text());
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

  // SSR: extract query data. The session stays server-side — it is never
  // handed to globalContextsProps, which Plasmic serializes into the HTML.
  const queryData = await extractPlasmicQueryData(
    <PlasmicRootProvider loader={PLASMIC} prefetchedData={plasmicData}>
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

  // SSR: extract query data. The session stays server-side — it is never
  // handed to globalContextsProps, which Plasmic serializes into the HTML.
  const queryData = await extractPlasmicQueryData(
    <PlasmicRootProvider loader={PLASMIC} prefetchedData={plasmicData}>
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

# Optional: extra origins permitted to act as the shopper. One list feeds
# auth, the proxy's CORS reflection and the origin gate — add your Studio
# origin here for cross-origin preview.
BETTER_AUTH_TRUSTED_ORIGINS=https://studio.example.com
```

In production `createEpAuth` refuses to serve when the secret is missing, is
a known example placeholder, or is under 32 characters. Anything other than
`NODE_ENV=development` / `test` counts as production, so preview deployments
are held to the same bar; the check stands down during `next build` so
build-then-inject-env pipelines still build.

Two options tighten the deployment further:

| Option | Default | Use when |
| --- | --- | --- |
| `trustedOrigins` | the app's own origin | another origin must act as the shopper (e.g. Studio preview) |
| `hostAllowlist` | Elastic Path Composable Commerce regions, the integration host, and loopback outside production | the EP API lives elsewhere — Elastic Path Self Managed Commerce |

`hostAllowlist` is applied independently by `createEpAuth`,
`extractEpProviderConfig` and `buildEpCtx`, so pass the same list to all
three rather than only to the factory.

## Architecture

### Token Lifecycle

```
First visit:
  page.tsx → epAuth.api.getSession() → OAuth with clientId → access token
  → buildEpCtx() → withEpSession() → Server Queries SSR product data
  → commitCookies() → httpOnly ep_token cookie set

Returning visit:
  page.tsx → epAuth.api.getSession() → reads ep_token cookie → access token
  → buildEpCtx() → withEpSession() → Server Queries SSR → zero OAuth calls
```

The access token never reaches the browser. It stays on the server:
1. `getSession()` reads or mints it, then writes it to an httpOnly cookie
2. `buildEpCtx()` puts it on an `EpCtx`, which `withEpSession()` publishes
   through AsyncLocalStorage
3. Server Queries and the `/api/ep` proxy routes read it via
   `getCurrentEpSession()` and call Elastic Path directly

`providerProps()` returns `{}`. Whatever it returned would be handed to
`globalContextsProps` and serialized into the page HTML, so it never carries
a credential.

Browser-side catalog reads go through the Elastic Path SDK client, which mints
its own anonymous token from the public `clientId` and holds it in memory —
never localStorage, never a cookie.

**`next dev` is an exception.** Next's RSC debug instrumentation serializes a
server component's local variables — including the EP session — into the flight
payload, so the access token is readable in the page source under `next dev`.
It is absent from `next build` output, and nothing this package does can
suppress it. Treat a dev server as carrying a live shopper credential: don't
run one on a shared host or against production Elastic Path credentials.

### API Routes

`createEpAuthRoutes(epAuth)` mounts the auth handler:

| Method | Path | Description |
|--------|------|-------------|
| POST | `{basePath}/ep/anonymous` | Mint an anonymous session |
| POST | `{basePath}/ep/refresh` | Rotate the EP token |
| POST | `{basePath}/ep/cart` | Persist `epCartId` on the session |
| POST | `{basePath}/ep/account/login` | Persist account fields |
| GET | `{basePath}/get-session` | Read the session, minus EP credentials |

`createCartRoutes(epAuth)` mounts the cart routes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `{basePath}/cart` | Get cart contents |
| POST | `{basePath}/cart/items` | Add item to cart |
| PUT | `{basePath}/cart/items/:id` | Update item quantity |
| DELETE | `{basePath}/cart/items/:id` | Remove item from cart |

Mount the auth handler through `createEpAuthRoutes`, never better-auth's
`toNextJsHandler` directly: better-auth's `/get-session` returns the whole
session record, and this package keeps the shopper's EP access token on it.

### Cookie Architecture

| Cookie | Contents | Purpose |
|--------|----------|---------|
| `better-auth.session_token` | Signed session id | Session identity |
| `better-auth.session_data` | JWE — EP access token, client id, host, cart id | Everything the server needs to act as the shopper |

Both are `HttpOnly; SameSite=Lax; Path=/`, `Secure` in production. The EP
access token, the account fields and the cart id all live inside the encrypted
`session_data` payload — there is no separate `ep_token`, `ep_account` or
`ep_cart` cookie.

### Server-Side Rendering

Product data server-renders through Studio Server Queries against the EP custom
functions — see [Studio Server Queries (SSR)](#studio-server-queries-ssr) below.
`buildEpCtx()` + `withEpSession()` carry the session; each `ep.*` function reads
it via `getCurrentEpSession()`.

Data flows into `prefetchedQueryData` → client hydration. Product data SSRs for
SEO. The token never enters the cache.

### Better Auth Alignment

The API follows [Better Auth](https://better-auth.com/) conventions:

| EP Commerce | Better Auth |
|-------------|-------------|
| `createEpAuth()` | `betterAuth()` |
| `epAuth.api.getSession(req)` | `auth.api.getSession(req)` |
| `createEpAuthRoutes(epAuth)` | `toNextJsHandler(auth)` |
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
- **EP Provider** — Global context: `clientId`, `host`, `locale`, `currency`
- **Shopper Context** — Global context: `cartId`, `accountId`, `basePath` overrides

### Product Display
- **EPProductProvider** — Single product data
- **EPProductListProvider** — Paginated product listing
- **EPRelatedProductsProvider** — Related products
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
- **EPLocationPicker** / **EPLocationField** — Location selection
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

### Composing EPSearchPagination

`EPSearchPagination` follows the same provider pattern. The default slot
ships an `hbox` with `Prev` button, page-indicator text, and `Next` button
so a fresh drop renders working chrome shape — the designer wires the
behaviour.

| What `EPSearchPagination` exposes | Type | Use it for |
| --- | --- | --- |
| `$ctx.searchPaginationData.currentPage` | `number` | zero-indexed current page |
| `$ctx.searchPaginationData.totalPages` | `number` | total page count |
| `$ctx.searchPaginationData.hasPrev` | `boolean` | hide Prev button when false |
| `$ctx.searchPaginationData.hasNext` | `boolean` | hide Next button when false |
| `$ctx.searchPaginationData.pages` | `number[]` | page-number buttons array |
| `goToPage(page: number)` ref-action | | call from a page-number button's `onClick` |
| `prevPage()` ref-action | | call from the Prev button's `onClick` |
| `nextPage()` ref-action | | call from the Next button's `onClick` |

Wiring a fresh EPSearchPagination in Plasmic Studio:

1. The default slot already contains a Prev button, a page text, and a
   Next button — restyle them freely from the style panel.
2. Replace the page-text content with a dynamic expression, e.g.
   `` `Page ${$ctx.searchPaginationData.currentPage + 1} of ${$ctx.searchPaginationData.totalPages}` ``.
3. Wire the Prev button's `onClick` → invoke ref-action `prevPage` on the
   EPSearchPagination instance. Bind its visibility to
   `$ctx.searchPaginationData.hasPrev`.
4. Wire the Next button's `onClick` → invoke ref-action `nextPage`. Bind
   its visibility to `$ctx.searchPaginationData.hasNext`.

### Composing EPSearchSortBy

`EPSearchSortBy` exposes the active sort and a `setSort` ref-action.
The recommended slot pattern is a native `<select>`:

| What `EPSearchSortBy` exposes | Type | Use it for |
| --- | --- | --- |
| `$ctx.sortByData.currentValue` | `string` | bind to the `<select>`'s `value` attribute |
| `$ctx.sortByData.options` | `Array<{value, label}>` | normalised options as `useSortBy` sees them |
| `setSort(value: string)` ref-action | | call from the `<select>`'s `onChange` |

The `items` prop accepts two shapes:

1. **Ergonomic (recommended)** — `{ field, direction, label }`:
   ```js
   [
     { label: "Most Relevant" },                                                   // default/unsorted
     { field: "price.USD.float_price", direction: "asc",  label: "Price: Low to High" },
     { field: "price.USD.float_price", direction: "desc", label: "Price: High to Low" },
     { field: "name", direction: "asc", label: "Name: A to Z" },
   ]
   ```
   Components compose `${indexName}/sort/${field}:${direction}` internally —
   the format the EP catalog-search-instantsearch-adapter parses. Field
   names are Typesense field paths on the EP catalog index (`name`, `sku`,
   `price.<currency>.float_price`, `created_at`, etc.).

2. **Raw (escape hatch)** — `{ value, label }` where `value` is the full
   indexName like `"search/sort/foo:asc"`. Use when you need to bypass
   the composer.

If the parent `EPCatalogSearchProvider` uses a non-default `indexName`,
set the matching value on the `indexName` prop here too — otherwise the
composed sort URLs target the wrong index.

Wiring a fresh EPSearchSortBy in Plasmic Studio:

1. Drop a `<select>` (Plasmic-controlled tag) into the slot.
2. Bind its `value` attribute to `$ctx.sortByData?.currentValue`.
3. Add `<option>` children for each sort entry — the option's `value`
   attribute should match the composed `value` from `$ctx.sortByData.options`
   (i.e. `$ctx.sortByData.options[N].value`), or hardcode if you know
   the indexName.
4. Wire the `<select>`'s `onChange` interaction → invoke ref-action
   `setSort` on the EPSearchSortBy instance with arg `event.target.value`.
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
