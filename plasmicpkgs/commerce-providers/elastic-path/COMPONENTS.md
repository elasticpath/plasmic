# EP Commerce Components — Usage Guide

> Integration guide for the Elastic Path commerce components in a Next.js + Plasmic consumer app.

---

## 1. Architecture Overview

```
Browser                          Storefront server                     Elastic Path
-------                          -----------------                     ------------
component → ep.* function
  POST /api/ep/proxy/<fn> ─────→ session → withEpSession → ep.* fn ──→ catalog, carts, stock
  POST /api/ep/ep/<operation> ─→ auth handler (sign in, select…)  ──→ account-member tokens
  GET  /api/ep/get-session ────→ session, minus every credential
  /api/checkout/sessions/* ────→ checkout-session handlers         ──→ orders, payments

Studio canvas
  POST /api/ep/design/<fn> ────→ catalog reads, no session         ──→ catalog

Page render (Server Queries)
  withEpSession(session) → ep.* fn ──────────────────────────────────→ catalog, carts
```

**Key principle:** the browser holds no Elastic Path credential. The shopper
envelope holds them, and the server attaches them. Each `ep.*` function
is isomorphic: on the server it calls Elastic Path inside `withEpSession`, and
in the browser it posts to the proxy route, which runs the same function
server-side. See the README's
[Security model](README.md#security-model).

---

## 2. Setup

The README's [Quick Start](README.md#quick-start) covers it: the auth
instance, the auth handler, the proxy and design-time routes, the middleware
and the page. The components call those routes at `/api/ep`, so mount them
there.

---

## 3. Choosing a listing path

Two components build a product listing. Choose by what your store has, not by
what the page is for.

| Your store | Use |
| --- | --- |
| Has a Catalog Search index | **EP Catalog Search Provider** — search, filters, facets and sorting |
| Has no search index | **EP Product List Provider** — paging only |

Neither path is deprecated, and neither can be removed. EP Product List
Provider is the supported path for a store without a search index.

**Sorting needs catalog search.** Elastic Path's catalog product endpoints take
no `sort` parameter, and ignore one rather than reject it, so a sort control
over EP Product List Provider changes nothing. Use EP Search Sort By inside EP
Catalog Search Provider.

**Server rendering.** EP Product List Provider renders on the server: bind its
**Products (pre-fetched)** prop to an `ep.getProductPage` Server Query, and the
first page is in the HTML. Catalog search does not render on the server yet. Its
products appear only after the browser runs the page, so a crawler or link
preview that does not run scripts sees an empty listing.

**Design time.** Both providers show labelled `"Sample"` fixtures on the Studio
canvas, not your catalog. Catalog search never mounts its inner component on
the canvas. EP Product List Provider's Server Query reads the real catalog in
the data-query Configure panel.

**Switching paths.** Three things change, and card layouts survive, because
both repeaters publish the same `currentProduct`:

| EP Product List Provider path | EP Catalog Search Provider path |
| --- | --- |
| EP Product List Provider | EP Catalog Search Provider |
| EP Product Grid | EP Search Hits |
| buttons bound to the provider's `nextPage` / `prevPage` / `goToPage` / `loadMore` | EP Search Pagination |

Moving to catalog search also drops the **Products (pre-fetched)** Server Query
binding, which has no counterpart there. Set EP Search Hits' route prefix so
product links match your product page route.

---

## 4. Cart

**In Studio,** use the cart components, or the Elastic Path Provider's global
actions **Add item to cart**, **Update item in cart** and **Remove item from
cart**. Each runs on the server through the proxy route and refreshes the cart.

**In React code,** `useEpCart()` reads the shopper's cart:

```ts
import { useEpCart } from "@elasticpath/plasmic-ep-commerce-elastic-path";

const { cart, isLoading, error, refresh } = useEpCart();
```

`useCheckoutCart()` reads the same cart for checkout, as
`{ data, isEmpty, isLoading, error, mutate }`.

To write to the cart, call `epAddCartItem`, `epUpdateCartItem` or
`epRemoveCartItem`. They replace `useAddItem`, `useUpdateItem` and
`useRemoveItem`, which this release removed. In the browser they call the
storefront's proxy route, so no Elastic Path credential reaches the page. Each
resolves with the updated cart, and every `useEpCart()` consumer, such as the
cart drawer, the badge and the checkout summary, shows it without a reload:

```tsx
"use client";
import { epAddCartItem } from "@elasticpath/plasmic-ep-commerce-elastic-path";

async function addToCart(productId: string) {
  try {
    const cart = await epAddCartItem({
      productId,
      quantity: 1,
      location: "warehouse-north",
    });
    console.log(`${cart.items.length} lines in the cart`);
  } catch (err) {
    const { message, code } = err as Error & { code?: string };
    // code: "insufficient_stock", "no_session", "dispatch_failed",
    // "route_not_found" or "design_fn_not_served"
    showError(message);
  }
}
```

`epAddCartItem` takes `productId`, `quantity`, and optionally `sku`,
`location`, `bundleConfiguration` and `customInputs`. `epUpdateCartItem` takes
`itemId`, `quantity` and optionally `location`; without it, the line's own
location is used. `epRemoveCartItem` takes `itemId`. The root entry also
exports the types of the cart they resolve with: `Cart`, `CartItem`,
`CartItemType`, `CartMeta`, `CartResponse` and `FormattedPrice`.

A rejection is an `Error` whose `message` you can show the shopper. When the
proxy route forwards Elastic Path's own reason, which it does only in
development, the `message` is that reason. Otherwise it is fixed text for the
failure, such as "We couldn't add this item to your cart. Please try again."
Branch on `code`, not on the message text. A network failure or an error page
with no code rejects with no `code`. `route_not_found` means the proxy route
is not mounted. `cause` holds the original failure, and `correlationId`, when
there is one, matches the proxy route's log line.

On the Studio canvas, a write does not run and the cart does not change. The
write rejects with the code `design_fn_not_served`. Preview the page to try the
write.

`/server` exports the same three functions. On the server they write with the
request's session and reject the same way: the same shopper `message`, the same
`code`, and Elastic Path's own reason in `cause`. A server rejection always has
a `code`; a failure with no known cause is `dispatch_failed`. Only a call in the
browser refreshes the `useEpCart()` cache.

---

## 5. Checkout Components

### EPCheckoutProvider

Root orchestrator. Manages multi-step checkout state and provides data + actions to all child components.

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `cartId` | `string?` | — | Override cart ID |
| `apiBaseUrl` | `string?` | `"/api"` | Base path for checkout API routes |
| `autoAdvanceSteps` | `boolean?` | `false` | Auto-advance after step completion |
| `previewState` | `"auto" \| "customerInfo" \| "shipping" \| "payment" \| "confirmation"` | `"auto"` | Force preview step |
| `loadingContent` | `ReactNode?` | — | Slot shown while loading |
| `errorContent` | `ReactNode?` | — | Slot shown on error |
| `className` | `string?` | — | |

**DataProvider `checkoutData`** -> `CheckoutData`:

```ts
interface CheckoutData {
  step: string;                // "customer_info" | "shipping" | "payment" | "confirmation"
  stepIndex: number;           // 0-3
  totalSteps: number;          // 4
  canProceed: boolean;
  isProcessing: boolean;

  customerInfo: { firstName: string; lastName: string; email: string } | null;
  shippingAddress: AddressData | null;
  billingAddress: AddressData | null;
  sameAsShipping: boolean;
  selectedShippingRate: {
    id: string; name: string; price: number; priceFormatted: string;
    currency: string; estimatedDays?: string; carrier?: string;
  } | null;
  order: any | null;
  paymentStatus: "idle" | "pending" | "processing" | "succeeded" | "failed";
  error: string | null;

  summary: {
    subtotal: number;          subtotalFormatted: string;
    tax: number;               taxFormatted: string;
    shipping: number;          shippingFormatted: string;
    discount: number;          discountFormatted: string;
    total: number;             totalFormatted: string;
    currency: string;
    itemCount: number;
  };
}

interface AddressData {
  first_name: string;  last_name: string;
  line_1: string;      line_2?: string;
  city: string;        county?: string;
  country: string;     postcode: string;
}
```

**refActions (9):**

| Action | Signature | Description |
|--------|-----------|-------------|
| `nextStep` | `() => void` | Advance to next step |
| `previousStep` | `() => void` | Go back one step |
| `goToStep` | `(step: string) => void` | Jump to named step |
| `submitCustomerInfo` | `(data) => void` | Submit customer + addresses (see below) |
| `submitShippingAddress` | `(data: AddressData) => void` | Submit shipping address only |
| `submitBillingAddress` | `(data: AddressData) => void` | Submit billing address only |
| `selectShippingRate` | `(rateId: string) => void` | Select a shipping rate |
| `submitPayment` | `() => Promise<void>` | Trigger Stripe payment confirmation |
| `reset` | `() => void` | Reset to step 1 |

`submitCustomerInfo` data shape:
```ts
{
  firstName: string;
  lastName: string;
  email: string;
  shippingAddress: AddressData;
  sameAsShipping: boolean;
  billingAddress?: AddressData;
}
```

---

### EPCheckoutStepIndicator

Repeater over the 4 checkout steps. Provides per-step data for building step nav/progress bars.

**DataProvider `currentStep`** (per iteration):

```ts
{
  name: string;        // "Customer Info", "Shipping", "Payment", "Confirmation"
  stepKey: string;     // "customer_info", "shipping", "payment", "confirmation"
  index: number;       // 0-3
  isActive: boolean;
  isCompleted: boolean;
  isFuture: boolean;
}
```

**DataProvider `currentStepIndex`** (per iteration): `number`

**Props:** `previewState?: "auto" | "withData"`, `className?`

---

### EPCheckoutButton

Step-aware button that derives its label and behavior from the current checkout step.

**DataProvider `checkoutButtonData`:**

```ts
{
  label: string;         // Step-derived label (see below)
  isDisabled: boolean;
  isProcessing: boolean;
  step: string;          // Current step key
}
```

**Label mapping:**

| Step | Label |
|------|-------|
| `customer_info` | "Continue to Shipping" |
| `shipping` | "Continue to Payment" |
| `payment` | "Place Order" |
| `confirmation` | "Done" |
| outside a checkout provider | "Checkout", linking to `checkoutUrl` |

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `onComplete` | `(data: { orderId: string }) => void` | Fires on confirmation step |
| `checkoutUrl` | `string?` | Where the button links outside a checkout provider. Default `/checkout` |
| `previewState` | `"auto" \| "customerInfo" \| "shipping" \| "payment" \| "confirmation"` | |

---

### EPOrderTotalsBreakdown

Reads totals from `checkoutData.summary` or falls back to the cart published by `EPCheckoutCartSummary`.

**DataProvider `orderTotalsData`:**

```ts
{
  subtotal: number;          subtotalFormatted: string;
  tax: number;               taxFormatted: string;
  shipping: number;          shippingFormatted: string;
  discount: number;          discountFormatted: string;
  hasDiscount: boolean;
  total: number;             totalFormatted: string;
  currency: string;
  itemCount: number;
}
```

**Props:** `previewState?: "auto" | "withData"`, `className?`

---

### EPCustomerInfoFields

Form state manager for customer info (name + email). No rendered inputs — children bind via DataProvider.

**DataProvider `customerInfoFieldsData`:**

```ts
{
  firstName: string;
  lastName: string;
  email: string;
  errors: { firstName: string | null; lastName: string | null; email: string | null };
  touched: { firstName: boolean; lastName: boolean; email: boolean };
  isValid: boolean;
  isDirty: boolean;
}
```

**refActions:**

| Action | Signature | Description |
|--------|-----------|-------------|
| `setField` | `(name: "firstName" \| "lastName" \| "email", value: string) => void` | Update a field |
| `validate` | `() => boolean` | Validate all fields, returns isValid |
| `clear` | `() => void` | Reset all fields |

**PreviewStates:** `"auto"`, `"empty"`, `"filled"`, `"withErrors"`

Plasmic usage: place `<input>` children and bind `onChange` to `setField("email", event.target.value)`.

---

### EPShippingAddressFields

Form state manager for 9 address fields with country-aware postcode validation.

**DataProvider `shippingAddressFieldsData`:**

```ts
{
  firstName: string;  lastName: string;
  line1: string;      line2: string;
  city: string;       county: string;
  postcode: string;   country: string;
  phone: string;
  errors: {
    firstName: string | null;  lastName: string | null;
    line1: string | null;      city: string | null;
    postcode: string | null;   country: string | null;
    phone: string | null;
  };
  touched: { firstName: boolean; lastName: boolean; line1: boolean; city: boolean;
             postcode: boolean; country: boolean; phone: boolean };
  isValid: boolean;
  isDirty: boolean;
  suggestions: { line1: string; city: string; county: string; postcode: string; country: string }[] | null;
  hasSuggestions: boolean;
}
```

**refActions:** `setField(name, value)`, `validate()`, `clear()`, `useAccountAddress(addressId)`. `useAccountAddress` copies a saved address from an ancestor `shopperContextData` DataProvider's `addresses`. Nothing in this package provides that DataProvider, so it does nothing unless you supply one.

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `showPhoneField` | `boolean?` | `true` | Show/hide phone in validation |
| `previewState` | `"auto" \| "empty" \| "filled" \| "withErrors" \| "withSuggestions"` | `"auto"` | |

Postcode patterns: US `^\d{5}(-\d{4})?$`, CA `^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$`.

---

### EPBillingAddressFields

Mirrors shipping address when `sameAsShipping` is true (refActions become no-ops in mirror mode).

**DataProvider `billingAddressFieldsData`:**

```ts
{
  firstName: string;  lastName: string;
  line1: string;      line2: string;
  city: string;       county: string;
  postcode: string;   country: string;
  errors: { firstName: string | null; lastName: string | null; line1: string | null;
            city: string | null; postcode: string | null; country: string | null };
  touched: { firstName: boolean; lastName: boolean; line1: boolean;
             city: boolean; postcode: boolean; country: boolean };
  isValid: boolean;
  isDirty: boolean;
  isMirroringShipping: boolean;  // true when same-as-shipping is active
}
```

**refActions:** `setField(name, value)`, `validate()`, `clear()` — all no-op when `isMirroringShipping`.

Reads toggle state from `billingToggleData.isSameAsShipping` (EPBillingAddressToggle) or `checkoutData.sameAsShipping`.

**PreviewStates:** `"auto"`, `"sameAsShipping"`, `"different"`, `"withErrors"`

---

### EPShippingMethodSelector

Repeater over the shipping rates the checkout session quoted (`availableShippingRates` on EP Checkout Session Provider). It makes no request of its own. Without a checkout session it has no rates and logs a warning.

**DataProvider `currentShippingMethod`** (per iteration):

```ts
{
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  estimatedDays: string;
  carrier: string;
  isSelected: boolean;
}
```

**DataProvider `currentShippingMethodIndex`** (per iteration): `number`

**refAction:** `selectMethod(rateId: string)`

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `loadingContent` | `ReactNode?` | Shown while rates are loading |
| `emptyContent` | `ReactNode?` | Shown when no rates available |
| `previewState` | `"auto" \| "withRates" \| "loading" \| "empty"` | |

Rates come from the `shippingRateResolver` configured on the server; see the README's checkout-session routes.

---

### EPPaymentElements

Stripe Payment Element wrapper. Loads Stripe.js from `https://js.stripe.com/v3` when it mounts in the browser.

**DataProvider `paymentData`:**

```ts
{
  isReady: boolean;
  isProcessing: boolean;
  error: string | null;
  paymentMethodType: string;
  clientSecret: string | null;  // from EPCheckoutProvider's internal context
}
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `stripePublishableKey` | `string?` | Stripe publishable key (pk_test_... or pk_live_...) |
| `appearance` | `Record<string, any>?` | Stripe Elements appearance theme |
| `previewState` | `"auto" \| "ready" \| "processing" \| "error"` | |

Reads `clientSecret` from EPCheckoutProvider's internal context, which it sets after calling `/api/checkout/setup-payment`.

---

### Checkout API Routes

The supported checkout runs on the checkout-session routes, whose handlers this
package ships; the README lists them. EPCheckoutProvider without a checkout
session calls these routes instead, which the package does not ship — you
implement them:

| Route | Method | Purpose | Request Body |
|-------|--------|---------|-------------|
| `/api/checkout/create-order` | POST | Creates EP order | `{ cartId?, customerData, billingAddress, shippingAddress }` |
| `/api/checkout/setup-payment` | POST | Creates Stripe PaymentIntent | `{ orderId, amount, currency }` |
| `/api/checkout/confirm-payment` | POST | Confirms payment | `{ orderId, transactionId, stripePaymentIntentId }` |

Without a checkout session there are no shipping rates: the session's
`shippingRateResolver` is the only source.

---

## 6. Studio Server Queries (SSR)

For SSR'd product/cart/list data — where the initial HTML payload contains real EP data without a client-side waterfall — wire up Plasmic's Server Queries against the EP custom functions exposed by `@elasticpath/plasmic-ep-commerce-elastic-path/server`. This is what makes a PDP render `Test product English` `$15.00` in the response from the first request, before any JS runs in the browser.

### Architecture

```
Browser                          Server (Next.js)              Elastic Path
-------                          ----------------              ------------
                                 catch-all page.tsx
                                   getSession() ----- mints ---> /oauth/access_token
                                   buildEpCtx(session)
                                                                 /pcm/catalog/products
                                   withEpSession(epCtx, () =>
                                     PLASMIC.unstable__getServerQueriesData
                                       ↓ executes ep.getProduct({id})
                                       ↓ each ep.* fn reads session
                                       ↓ via getCurrentEpSession() (ALS)
                                   ) prefetchedQueryData ------> RSC payload
PlasmicClientRootProvider <-------- prefetchedQueryData
  $q.product.data hydrated from cache, no client refetch
```

### Custom functions (registered via `registerEpCustomFunctions(PLASMIC)`)

| Function | Args | Returns |
|---|---|---|
| `ep.getProduct` | `{ id }` | `Product \| null` — single product by product reference (the slug, or the ID when it has none); `null` when no product matches |
| `ep.getCart` | `{}` | `Cart \| null` — current cart contents |
| `ep.getProductList` | `{ limit?, search?, categoryId? }` | `Product[]` — the first page only, as a flat array with no total count |
| `ep.getProductPage` | `{ limit?, offset?, search?, categoryId? }` | `{ data: Product[], meta: { results: { total }, page: { limit, offset } } }` — one page in Elastic Path's envelope, with the total count. `limit` defaults to 25 |
| `ep.getRelatedProducts` | `{ productId, relationshipSlug, limit? }` | `Product[]` — products linked by EP custom relationship |
| `ep.getStock` | `{ productIds, locationIds? }` | `Record<productId, ProductStock>` — multi-location stock, each location named from the locations list (its slug when the list lacks it); a product whose stock is unreadable comes back with zero counts |
| `ep.getLocations` | `{}` (a `type` is ignored) | `Location[]` — every inventory location |
| `ep.getBundleOptionProducts` | `{ productIds }` | `Record<productId, Product>` — the products a bundle offers as options, each the package's product shape |
| `ep.getBaseProducts` | `{ productIds }` | `Record<productId, Product>` — the given products with their `variations` and `childProducts`. A product that is not a base product comes back with an empty `childProducts`; one the catalog does not return is omitted |
| `ep.configureBundle` | `{ bundleId, selectedOptions }` | Elastic Path's configured-bundle payload — re-prices a bundle for a set of selections. Throws on failure, because a stale price is worse than none |
| `ep.multiSearch` | `{ searches, include? }` | Elastic Path's multi-search response as-is. Pass `include: ["main_image"]` for hit images — Elastic Path omits the `included` block unless it is asked for |

Every count `ep.getStock` returns is a `number`, not the SDK's `BigInt` — the value crosses `JSON.stringify` into prefetched query data and through the proxy route, and a BigInt cannot.

`categoryId` takes a hierarchy **node** ID and reads that node's products from `/catalog/nodes/{id}/relationships/products`. Elastic Path's catalog product endpoints have no filterable category key, and they compose `filter` terms with a comma — `and(...)` is rejected.

Neither function takes a `sort`; see [Choosing a listing path](#3-choosing-a-listing-path).

The session (`accessToken`, `host`, `clientId`, `cartId?`, `accountId?`, `accountToken?`, `locale?`, `currency?`) is **not** an argument. `withEpSession(epCtx, callback)` establishes a per-request `AsyncLocalStorage` scope; each `ep.*` function reads the active session via `getCurrentEpSession()` internally. On the server, outside any `withEpSession` scope, they fail-soft to `null` / `[]` without calling Elastic Path. On a published page in the browser, they post to the proxy route. `locale` and `currency` come from `createEpAuth`'s `resolveLocale`, which runs on every `getSession`, so the server render and the proxy route send Elastic Path the same `Accept-Language` and `X-Moltin-Currency`. In Studio they post to the design-time route, which serves the four catalog reads only: any other function returns its empty shape on the canvas and throws in the data-query Configure panel.

### Studio binding

For each Server Query in the Plasmic UI:

- **Function:** `ep.getProduct` (or `getCart`/`getProductList`/`getProductPage`/`getRelatedProducts`)
- **Arguments (object editor):** `{ id: $ctx.params.slug }` — note `$q` (server queries) vs `$queries` (client data queries) when binding the result.

Then bind the result to **EP Product Provider**'s `product` prop (advanced section) as `$q.<queryName>.data`. For a listing, see the next paragraph.

For a server-rendered listing, bind an `ep.getProductPage` query to **EP Product List Provider** → **Products (pre-fetched)** (`initialPage`, advanced section) as `$q.<queryName>.data`. The provider renders that page without a browser fetch, and takes its page boundaries from the query's `page[limit]` rather than the **Page Size** prop. Changing page discards the seed and falls back to client fetching; in load-more mode the seeded products are the buffer the next page appends to. Where server queries do not execute — the Studio canvas — the binding evaluates to an unresolved Promise, and anything that is not a settled object carrying a `data` array counts as no seed, so the provider fetches for itself.

### Add to Cart errors (`$ctx.addToCartState.error`)

`EPAddToCartButton` exposes `{ isLoading, isDisabled, error }` via the DataProvider named `addToCartState`. On a proxy or Elastic Path failure, `error` is a non-empty string.

Designers must bind their own text, banner, visibility condition, or other UI to `$ctx.addToCartState.error`. The component does **not** render a default error banner or toast. Existing designs only show an error where that binding exists.

Use the component's **error** preview state in Studio to design the bound UI.

### Cart quantity and remove errors

Quantity and remove mutations expose the same pattern:

* `$ctx.quantityControl.error` — set when a quantity update fails (quantity still rolls back).
* `$ctx.removeItemState.error` — set when a remove fails (item stays in the cart).

`error` is `null` when there is no current failure, and clears when a new attempt begins. Studio provides an **error** preview state on both components. Neither renders a default toast or banner; designers choose how to display the bound value.

Like Add to Cart, these values are the cart write's rejection message (see [§4](#4-cart)): shopper-facing copy for the stable error code (`insufficient_stock`, `no_session`, …), or, in development only, Elastic Path's own reason when the proxy route forwards it.

### Required Next.js setup

1. **`platformOptions: { nextjs: { appDir: true } }`** in `plasmic-init.ts`. Without this the loader fetches the Pages Router bundle which omits `serverQueriesExecFuncFileName` per-page metadata.
2. **Wrap `unstable__getServerQueriesData` in `withEpSession(epCtx, ...)`** in the catch-all page. Without it, the EP functions run outside any session scope and return `null` / `[]`.
3. **Resolve a real page path in `resolveConfig`** — use `PLASMIC.fetchPages()` rather than hardcoding `/`. Projects without a homepage route otherwise return `null` from `maybeFetchComponentData("/")` and the credentials-extraction path silently fails.

### Common gotchas

| Symptom | Likely cause |
|---|---|
| Queries return `null` / `[]` despite valid arguments | Missing `withEpSession(epCtx, …)` wrap around `unstable__getServerQueriesData` |
| `prefetchedQueryData: "$undefined"` in the SSR HTML | `appDir: true` missing from loader config |
| `EP OAuth failed (401)` in dev log | `resolveConfig` found no EP Provider config — usually because `getEpProviderConfig` hardcoded `/` and the project has no homepage |
| Studio binding still references `auth: $ctx.ep` | Project predates PRD #272 — drop `auth` from each Server Query argument |
| A sort control over **EP Product List Provider** changes nothing | Expected — the catalog product endpoints cannot sort. See [Choosing a listing path](#3-choosing-a-listing-path) |

## 7. Utility Components

### EPCheckoutCartSummary

Fetches cart data and provides it to children. Supports collapsible mode for mobile.

- **DataProvider:** `cart` — the Elastic Path cart (see the shapes section)
- **Props:** `showImages?`, `collapsible?`, `isExpanded?`, `onExpandedChange?`, `cartData?` (code-only: pass a `Cart` to skip the internal fetch)

### EPCheckoutCartItemList

Repeater over `cart.items`.

- **DataProvider (per item):** `currentCheckoutItem` — Elastic Path's cart line, as listed in the quick reference below
- **DataProvider (per item):** `currentCheckoutItemIndex` — `number`

### EPCheckoutCartField

Renders a single cart or item field as a `<span>` (or `<img>` for `imageUrl`).

- **Cart fields:** `formattedSubtotal`, `formattedTotal`, `formattedShipping`, `formattedTax`, `itemCount`
- **Item fields** (inside EPCheckoutCartItemList): `name`, `quantity`, `formattedPrice`, `imageUrl`, `sku`

### EPCountrySelect

`<select>` dropdown with ISO 3166-1 countries. Priority countries shown at top with divider.

- **Props:** `value?`, `onChange?`, `defaultCountry?` (default `"US"`), `priorityCountries?` (default `"US,CA,GB,AU"`), `placeholder?`, `disabled?`

### EPBillingAddressToggle

"Same as shipping" checkbox with conditional billing form slot.

- **DataProvider:** `billingToggleData` — `{ isSameAsShipping: boolean }`
- **Props:** `checked?`, `onChange?`, `label?`, `billingContent?` (slot, shown when unchecked)

### EPPromoCodeInput

Promo code input with apply/remove. Codes are applied and removed on the server through `ep.applyPromoCode` / `ep.removePromoCode`.

- **DataProvider:** `promoCodeData` — `{ code, state, formattedDiscount, errorMessage }`
- **Props:** `placeholder?`, `applyLabel?`, `removeLabel?`, `onApply?`, `onRemove?`, `onError?`

---

## 8. DataProvider Quick Reference

Lookup table for Plasmic dynamic value bindings (`$ctx.xxx`).

| DataProvider Name | Source Component | Key Fields |
|-------------------|-----------------|------------|
| `checkoutData` | EPCheckoutProvider | `step`, `stepIndex`, `canProceed`, `isProcessing`, `summary.*`, `customerInfo`, `shippingAddress`, `billingAddress`, `sameAsShipping`, `selectedShippingRate`, `order`, `paymentStatus`, `error` |
| `currentStep` | EPCheckoutStepIndicator | `name`, `stepKey`, `index`, `isActive`, `isCompleted`, `isFuture` |
| `currentStepIndex` | EPCheckoutStepIndicator | `number` |
| `checkoutButtonData` | EPCheckoutButton | `label`, `isDisabled`, `isProcessing`, `step` |
| `orderTotalsData` | EPOrderTotalsBreakdown | `subtotalFormatted`, `taxFormatted`, `shippingFormatted`, `discountFormatted`, `totalFormatted`, `hasDiscount`, `currency`, `itemCount` |
| `customerInfoFieldsData` | EPCustomerInfoFields | `firstName`, `lastName`, `email`, `errors`, `touched`, `isValid`, `isDirty` |
| `shippingAddressFieldsData` | EPShippingAddressFields | `firstName`, `lastName`, `line1`, `line2`, `city`, `county`, `postcode`, `country`, `phone`, `errors`, `touched`, `isValid`, `isDirty`, `suggestions`, `hasSuggestions` |
| `billingAddressFieldsData` | EPBillingAddressFields | `firstName`..`country`, `errors`, `touched`, `isValid`, `isDirty`, `isMirroringShipping` |
| `currentShippingMethod` | EPShippingMethodSelector | `id`, `name`, `price`, `priceFormatted`, `estimatedDays`, `carrier`, `isSelected` |
| `currentShippingMethodIndex` | EPShippingMethodSelector | `number` |
| `paymentData` | EPPaymentElements | `isReady`, `isProcessing`, `error`, `paymentMethodType`, `clientSecret` |
| `cart` | EPCheckoutCartSummary | `items`, `itemCount`, `meta.display_price.{without_tax,tax,with_tax}` — Elastic Path's cart |
| `currentCheckoutItem` | EPCheckoutCartItemList | Elastic Path's cart line: `id`, `name`, `sku`, `quantity`, `product_id`, `image.href`, `meta.display_price.*` |
| `currentCheckoutItemIndex` | EPCheckoutCartItemList | `number` |
| `billingToggleData` | EPBillingAddressToggle | `isSameAsShipping` |
| `promoCodeData` | EPPromoCodeInput | `code`, `state`, `formattedDiscount`, `errorMessage` |
