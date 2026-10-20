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

**Server rendering.** Both providers put their first page of products in the
HTML. EP Product List Provider needs its **Products (pre-fetched)** prop bound
to an `ep.getProductPage` Server Query. EP Catalog Search Provider needs nothing:
on the Next.js App Router it searches during the server render with the
shopper's session, and the browser uses those results without searching again.

- A query in the URL, such as `?search[query]=boots`, applies to the server
  render. Other search state in the URL, such as the page number, applies only
  while the component that owns it, such as EP Search Pagination, is on the
  page. The browser follows the same rule.
- If the server search fails, has no session, or takes longer than 3 seconds,
  the page still renders the provider's components with no results, and the
  browser runs the search. The page never fails, and never shows the error slot
  or EP Search Empty because of it. Components that show counts, such as EP
  Search Stats, render 0 until the browser's results arrive.
- Outside the App Router, for example on the Pages Router, catalog search runs
  in the browser only.
- The session reaches the server render through `createEpAuth`, so the
  storefront's own installed copy of this package must be this version or
  later. With an older copy, catalog search runs in the browser only.

**Loading more.** Both paths can add the next page below the products already
shown. On catalog search, use EP Search Infinite Hits in place of EP Search
Hits and EP Search Pagination. Bind its Load More button to
`$ctx.searchInfiniteHitsData.loadMore` and hide it when `isLastPage`. The page
number goes in the URL, so a shopper who reloads starts on the last page they
loaded. Put a button in its Load Previous Button slot, bound to `loadPrevious`
and hidden when `isFirstPage`, to load the pages above it.

**Content Security Policy.** The server render adds one inline script for each
catalog search provider. The script carries that provider's results. If your
storefront uses a nonce-based policy, send the nonce on the page request in an
`x-nonce` header, as the Next.js CSP guide shows. The package also reads a
`'nonce-…'` source from the request's `Content-Security-Policy` header. If the
policy blocks the script, the browser discards the server render and searches
again.

**Design time.** On the Studio canvas, EP Product List Provider and EP Related
Products Provider read your catalog through the design-time route
(`/api/ep/design/<fn>`), as EP Product Provider does. The route needs an app
host with `createEpDesignRoutes` mounted. While the read runs they show Loading
Content, and when it finds nothing they show Empty Content. When the read
fails, including when the route is not mounted, they show labelled `"Sample"`
fixtures. EP Related Products Provider also shows the fixtures when no product
is chosen. EP Catalog Search Provider always shows fixtures on the canvas: it
never mounts its inner component there.

| Component | On the Studio canvas |
| --- | --- |
| EP Product Provider | Your catalog |
| EP Product List Provider | Your catalog |
| EP Related Products Provider | Your catalog; fixtures when no product is chosen |
| EP Catalog Search Provider | Fixtures |
| EP Refinement List, EP Hierarchical Menu, EP Range Filter | Fixtures once a field is chosen; with no field, a "Choose a field" prompt that names the prop to set |

Preview State (`loading`, `error`, `empty`, `withData`) forces a state on the
canvas only. Published pages always fetch.

A newly inserted EP Product Grid's card is three EP Product Field components:
the first image, the name and the price. EP Product Field reads
`currentProduct`, which the grid publishes for each card, so the card needs no
bindings.

**Switching paths.** Three things change, and card layouts survive, because
both repeaters publish the same `currentProduct` and the same
`currentHit.path` product page link:

| EP Product List Provider path | EP Catalog Search Provider path |
| --- | --- |
| EP Product List Provider | EP Catalog Search Provider |
| EP Product Grid | EP Search Hits |
| buttons bound to the provider's `nextPage` / `prevPage` / `goToPage` | EP Search Pagination |
| EP Product Grid with a button bound to the provider's `loadMore` | EP Search Infinite Hits, with the button in its Load More Button slot |

Moving to catalog search also drops the **Products (pre-fetched)** Server Query
binding, which has no counterpart there.

An EP Product Grid left inside EP Catalog Search Provider renders nothing,
because the search provider does not supply its products. The grid logs a
console warning once, and on the Studio canvas shows that message in place of
sample products. Replace it with EP Search Hits or EP Search Infinite Hits. The
nearest provider decides: a grid inside EP Product List Provider or EP Related
Products Provider does not warn, even when that provider sits inside catalog
search. A grid inside catalog search renders nothing, even when catalog search
sits inside one of those providers.

**Product links.** Bind a card's link to `currentHit.path`. EP Product Grid, EP
Search Hits and EP Search Infinite Hits all build it as **Product Path Prefix** + `/` + the product's
slug, or its id when it has no slug. The prefix defaults to `/product` on all three.
Set it on the repeater to match your product page route, and set the same value
when you switch. EP Product Grid builds the link inside EP Related Products
Provider too. `currentHit.path` is the only link field: `currentProduct` has no
`path`.

---

## 4. Cart

**In Studio,** use the cart components, or the Elastic Path Provider's global
actions **Add item to cart**, **Update item in cart** and **Remove item from
cart**. Each runs on the server through the proxy route and refreshes the cart.
**Add item to cart** takes an optional **Location** after **Quantity**: on a
multi-location store, a product stocked only at named locations needs it.

**In React code,** `useEpCart()` reads the shopper's cart:

```ts
import { useEpCart } from "@elasticpath/plasmic-ep-commerce-elastic-path";

const { cart, isLoading, error, refresh } = useEpCart();
```

`useCheckoutCart()` reads the same cart for checkout, as
`{ data, isEmpty, isLoading, error, mutate }`.

The cart holds what the shopper bought. Checkout writes its shipping charge
into the Elastic Path cart as a line with SKU `__ep_shipping`, but only while
a payment runs: picking a rate prices the line with the cart and takes it out
again. So outside a payment `meta` and `promotions`, as Elastic Path priced
them, add up to `items`, also for components older than the storefront. The
published cart leaves the line out of `items` and `itemCount` when it is
there. `withoutShipping.meta` and `withoutShipping.promotions` are the cart's
values less what the line adds and what a code took off it; they add up to
`items` in every case. EP Cart Field, EP Checkout Cart Field, EP Promo Code
Input and EP Order Totals Breakdown read them. Bind a cart page's own totals to
`$ctx.cart.withoutShipping.meta.display_price`. Checkout totals, which include
shipping, come from `$ctx.checkoutSession.session.totals`. A cart from a 0.8.0
storefront, which lists the line as an item, gets the same shape in the
browser.

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

The writes can overlap, for example when a shopper taps a quantity button
twice. The consumers never go back to an older cart, and after the last of the
overlapping writes finishes, they read the cart once from Elastic Path. Each
call still resolves with the cart it produced.

A rejection is an `Error` whose `message` you can show the shopper. When the
proxy route forwards Elastic Path's own reason, which it does only in
development, the `message` is that reason. Otherwise it is fixed text for the
failure, such as "We couldn't add this item to your cart. Please try again."
Branch on `code`, not on the message text. A network failure or an error page
with no code rejects with no `code`. `route_not_found` means the proxy route
is not mounted. `cause` holds the original failure, and `correlationId`, when
there is one, matches the proxy route's log line.

On the Studio canvas and in a configure panel, a write does not run and the
cart does not change. The write rejects with the code `design_fn_not_served`
and a `message` that names where it ran. Preview the page to try the write.

`/server` exports the same three functions. On the server they write with the
request's session and reject the same way: the same shopper `message`, the same
`code`, and Elastic Path's own reason in `cause`. A server rejection always has
a `code`; a failure with no known cause is `dispatch_failed`. Only a call in the
browser refreshes the `useEpCart()` cache.

The proxy route answers a refusal the shopper can act on with `409`: a code
of `insufficient_stock`, `invalid_promo_code` or `checkout_in_progress`, or
any other Elastic Path `4xx` except `401` and `403`. Any other failure is a
`500`. The body is the same either way.

---

## 5. Checkout Components

### EPCheckoutSessionProvider

The checkout path. **EP Checkout Session Provider** holds the checkout session
on the server and runs it through the checkout-session routes; the README
lists them. Put the field, shipping-rate and payment components
(`EPStripePayment`, `EPCloverPayment`, `EPManualPayment`) inside it. For a
single-page form, `EPCheckoutFormProvider` submits through it.

The session checks out the cart in the shopper's session. The server takes
that cart from the session when it creates the checkout session, and every
later route works on it. The browser never names a cart: a cart id sent in
the request, or passed to `createSession`, is ignored.

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiBaseUrl` | `string?` | `"/api"` | Base path for the checkout-session routes |
| `autoCreate` | `boolean?` | `true` | Create a session on first render when there is none, or the last one is complete or expired |
| `previewState` | `"auto" \| "collecting" \| "paying" \| "complete"` | `"auto"` | Force a preview state in Studio |

**DataProvider `checkoutSession`:** `session`, `isLoading`, `error`,
`errorCode`, and the actions below.

When the provider cannot start a checkout, `session` is null, `error` is the
message to show and `errorCode` is the server's code, such as `EMPTY_CART`
or `NO_CART` (both "Your cart is empty"), `CART_CLEANUP_PENDING`, or
`NETWORK_ERROR` when the request did not reach the server. A finished checkout from an earlier visit is not
shown in its place, and `placeOrder` and `updateSession` answer with the same
refusal without sending anything. The provider tries again when the cart
changes or the page gets focus. `errorCode` is null otherwise.

The session's totals follow the cart. The provider reads the session again
when the shared cart cache changes (for example after EP Promo Code Input
applies a code) and when the page gets focus or becomes visible (a change made
in another tab). The server stores the cart's new totals when the cart's lines
changed. `placeOrder` sends the total on the page as `shownTotal`, and `/pay`
refuses with `TOTAL_CHANGED` and the current session when it would charge a
different total.

The provider reads the cart when an open checkout session appears, when the
shared cart cache changes and when the page gets focus. When the cart has
nothing to buy (no lines, or only the shipping line and promotions), `session`
is null, `error` is "Your cart is empty" and `errorCode` is `EMPTY_CART`, as
for a refused create: no totals and no card field show, and `placeOrder` and
`updateSession` answer with that refusal. The checkout shows again once the
cart has something in it.

Before each payment request, `placeOrder` reads the cart. When the cart holds
only the shipping line and promotions, it answers `EMPTY_CART` ("Your cart is
empty") and sends no payment request.

On a storefront still on 0.8.0, the session's totals do not follow the cart,
and they count a shipping line already in the cart as goods. The provider
reads the cart again whenever the session changes, and `session.totals` comes
from the cart: `subtotal` and `tax` from `withoutShipping`, `shipping` from the
line, `total` from Elastic Path. When the session's own total is not the
cart's, the provider starts a new checkout session at once, with the details
and delivery option already entered. `placeOrder` sends no payment request
when the storefront would charge a total other than the one on the page (the
cart changed, or the chosen shipping rate is not in the cart yet), or after
the storefront answers `CART_MISMATCH`: it starts a new checkout session, hides
the old total, and answers `TOTAL_CHANGED`. If that cart read fails there, it
answers `CART_UNREAD`.

**refActions:** `createSession()`, `updateSession(data)`,
`calculateShipping()`, `placeOrder()`, `confirmPayment(confirmData)`,
`resumePayment(resumeData)`, `reset()`.

---

### EPCheckoutProvider (deprecated)

Does nothing. It called `/api/checkout/create-order`, `/setup-payment` and
`/confirm-payment`, which nothing serves, so it could not place an order. It
stays registered because hostless publishing rejects a removed component
([ADR-0004](docs/adr/0004-registered-surfaces-are-append-only.md)). It renders
its children and nothing else, publishes no `checkoutData`, and every ref
action is ignored. Every prop except its children slot, `cartId` included,
is hidden and ignored. EPPaymentElements and EPCheckoutStepIndicator depended
on it and are deprecated too. Use EP Checkout Session Provider.

---

### EPCheckoutStepIndicator (deprecated)

Renders nothing. It read the current step from EPCheckoutProvider, which is
inert, so it always showed the first step. It stays registered
([ADR-0004](docs/adr/0004-registered-surfaces-are-append-only.md)); its
children slot and `previewState` are hidden and ignored. It publishes
no `currentStep` or `currentStepIndex`. Show checkout progress from
`$ctx.checkoutSession` under EP Checkout Session Provider.

---

### EPCheckoutButton

A "Checkout" control that goes to `checkoutUrl` (default `/checkout`), for a
cart page. On a page it is always the "Checkout" link. `previewState` shows a
step's label on the canvas only. `onComplete` is hidden and never fires.

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

Reads totals from the checkout session (`checkoutSession.session.totals`) or falls back to the cart published by `EPCheckoutCartSummary`. With neither, for example before a checkout starts or on an empty cart, a published page shows nothing inside it and publishes no `orderTotalsData`. Sample totals show on the Studio canvas only.

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

Reads toggle state from `billingToggleData.isSameAsShipping` (EPBillingAddressToggle).

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

### EPPaymentElements (deprecated)

Renders its children and nothing else. It took its client secret only from
EPCheckoutProvider, which is inert, so it could not show a card form. It stays
registered ([ADR-0004](docs/adr/0004-registered-surfaces-are-append-only.md));
`stripePublishableKey`, `appearance` and `previewState` are hidden and ignored.
It loads no Stripe.js and publishes no `paymentData`. Use `EPStripePayment`
inside EP Checkout Session Provider.

---

### EPCheckoutFormProvider payment

EP Checkout Form Provider places orders only through an EP Checkout Session
Provider above it. **Payment Mode** offers `"auto"` and `"session"`; both pay
through that provider. A page that stored `"proxy"`, or a form with no EP
Checkout Session Provider above it, renders a setup error (`role="alert"`)
that names EP Checkout Session Provider, and Place Order sets the same message
as `checkoutFormData.error`. **Payment Gateway** and **Payment Method** are
hidden and ignored; the payment component inside the session provider selects
the gateway.

**Show Errors** (`showError`, default on) shows, below the form in a
`role="alert"` element (`[data-ep-checkout-error]`), why Place Order failed:
a declined card, a failed card check, a payment that needs review. It also
shows why the session provider could not start a checkout, such as an empty
cart. Turn it off when the page shows `$ctx.checkoutFormData.error` itself.

When the server refuses the email (`INVALID_EMAIL`), the form also puts that
message on the email field (`email`, or the name Field Mapping gives it). EP
Form Field shows it, with `aria-invalid`, until the shopper edits the field.

While a card check is open, the form is locked: its fields are read-only and
show the details saved in the checkout session, also after a reload.

### EPManualPayment

Selects Elastic Path's `manual` gateway (no card) inside EP Checkout Session
Provider, for offline or invoice payment. A zero-total order completes without
it. For an order with a total, the server allows `manual` only when the host
registers `createManualAdapter({ allow })` and the rule returns `true` for that
cart and account; otherwise Place Order fails with `GATEWAY_NOT_ALLOWED`. The
README's Payment methods section shows the rule.

---

### Checkout API Routes

Checkout runs on the checkout-session routes, whose handlers this package
ships; the README lists them. The create route takes the cart from the
shopper's session (`sessionCartId` on `SessionHandlerContext`), never from the
request. It also takes the selected account (`accountToken`, `accountId`,
`accountMemberId`): with one, every order the session places is linked to that
account and member; with none, the order is a guest order. Pay returns `409`
`ACCOUNT_CHANGED` when the selection changed after the session was created.

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

The session (`accessToken`, `host`, `clientId`, `cartId?`, `accountId?`, `accountToken?`, `accountMemberId?`, `locale?`, `currency?`) is **not** an argument. `withEpSession(epCtx, callback)` establishes a per-request `AsyncLocalStorage` scope; each `ep.*` function reads the active session via `getCurrentEpSession()` internally. On the server, outside any `withEpSession` scope, they fail-soft to `null` / `[]` without calling Elastic Path. On a published page in the browser, they post to the proxy route. `locale` and `currency` come from `createEpAuth`'s `resolveLocaleAndCurrency`, which runs on every `getSession` with the request's cookies and headers (a server render that passes no headers gets the page request's), so the server render and the proxy route send Elastic Path the same `Accept-Language` and `X-Moltin-Currency`. Checkout reads the cart with the same pair when the host passes the session's `locale` and `currency` on `SessionHandlerContext`. In Studio they post to the design-time route, which serves the catalog reads only: any other function returns its empty shape on the canvas and throws in the data-query Configure panel.

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
| `checkoutSession` | EPCheckoutSessionProvider | `session`, `isLoading`, `error`, `errorCode` |
| `checkoutData` | EPCheckoutProvider (deprecated) | Never published |
| `currentStep` | EPCheckoutStepIndicator (deprecated) | Never published |
| `currentStepIndex` | EPCheckoutStepIndicator (deprecated) | Never published |
| `checkoutButtonData` | EPCheckoutButton | `label`, `isDisabled`, `isProcessing`, `step` |
| `orderTotalsData` | EPOrderTotalsBreakdown | `subtotalFormatted`, `taxFormatted`, `shippingFormatted`, `discountFormatted`, `totalFormatted`, `hasDiscount`, `currency`, `itemCount` |
| `customerInfoFieldsData` | EPCustomerInfoFields | `firstName`, `lastName`, `email`, `errors`, `touched`, `isValid`, `isDirty` |
| `shippingAddressFieldsData` | EPShippingAddressFields | `firstName`, `lastName`, `line1`, `line2`, `city`, `county`, `postcode`, `country`, `phone`, `errors`, `touched`, `isValid`, `isDirty`, `suggestions`, `hasSuggestions` |
| `billingAddressFieldsData` | EPBillingAddressFields | `firstName`..`country`, `errors`, `touched`, `isValid`, `isDirty`, `isMirroringShipping` |
| `currentShippingMethod` | EPShippingMethodSelector | `id`, `name`, `price`, `priceFormatted`, `estimatedDays`, `carrier`, `isSelected` |
| `currentShippingMethodIndex` | EPShippingMethodSelector | `number` |
| `paymentData` | EPPaymentElements (deprecated) | Never published |
| `cart` | EPCheckoutCartSummary | `items`, `itemCount`, `meta.display_price.{without_tax,tax,with_tax}` — Elastic Path's cart |
| `currentCheckoutItem` | EPCheckoutCartItemList | Elastic Path's cart line: `id`, `name`, `sku`, `quantity`, `product_id`, `image.href`, `meta.display_price.*` |
| `currentCheckoutItemIndex` | EPCheckoutCartItemList | `number` |
| `billingToggleData` | EPBillingAddressToggle | `isSameAsShipping` |
| `promoCodeData` | EPPromoCodeInput | `code`, `state`, `formattedDiscount`, `errorMessage` |
