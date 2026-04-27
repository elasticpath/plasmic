# EP Commerce Components — Usage Guide

> Integration guide for the Elastic Path commerce components in a Next.js + Plasmic consumer app.

---

## 1. Architecture Overview

```
Browser                          Server (Next.js)              Elastic Path
-------                          ----------------              ------------
ShopperContext                   /api/cart          ------>     Cart API
  useCart() ---- SWR GET -----> /api/cart/items     ------>     Cart Items API
  useAddItem() - POST --------> /api/cart/items     ------>
  useRemoveItem() DELETE -----> /api/cart/items/[id] ----->
  useUpdateItem() PUT --------> /api/cart/items/[id] ----->
                                /api/checkout/*     ------>     Orders / Payments
                                                               Stripe API
```

**Three layers:**

| Layer | Purpose | Runs on |
|-------|---------|---------|
| **Context** | ShopperContext, shopper overrides, fetch wrapper | Browser |
| **Cart Hooks** | SWR-cached cart state, add/remove/update mutations | Browser -> Server |
| **Checkout** | Multi-step orchestrator, forms, payment, totals | Browser -> Server |

**Key principle:** EP credentials (`client_id`, `client_secret`) stay on the server. Browser hooks call Next.js API routes which proxy to EP.

---

## 2. Quick Start

### Step 1 — Register ShopperContext

```ts
// plasmic-init.ts
import { ShopperContext } from "@elasticpath/plasmic-ep-commerce-elastic-path";

PLASMIC.registerComponent(ShopperContext, {
  name: "ShopperContext",
  props: {
    cartId:    { type: "string" },
    accountId: { type: "string" },
    locale:    { type: "string" },
    currency:  { type: "string" },
  },
  providesData: true,
  isDefaultExport: false,
});
```

### Step 2 — Create API routes

```ts
// app/api/cart/route.ts
import { resolveCartId, buildCartCookieHeader } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

export async function GET(req: Request) {
  const cartId = resolveCartId(
    Object.fromEntries(req.headers),
    parseCookies(req)
  );
  if (!cartId) return Response.json({ items: [], meta: null });

  const cart = await epClient.getCart(cartId); // your EP SDK call
  return new Response(JSON.stringify(cart), {
    headers: { "Set-Cookie": buildCartCookieHeader(cartId) },
  });
}
```

```ts
// app/api/cart/items/route.ts  (POST — add item)
// app/api/cart/items/[id]/route.ts  (DELETE — remove, PUT — update quantity)
```

### Step 3 — Wrap layout with ServerCartActionsProvider

```tsx
// app/layout.tsx (or Plasmic global context)
import { ServerCartActionsProvider } from "@elasticpath/plasmic-ep-commerce-elastic-path";

<ServerCartActionsProvider globalContextName="epCart">
  {children}
</ServerCartActionsProvider>
```

### Step 4 — Use cart hooks

```tsx
import { useCart, useAddItem } from "@elasticpath/plasmic-ep-commerce-elastic-path";

function AddToCartButton({ productId }: { productId: string }) {
  const { data, isEmpty } = useCart();
  const addItem = useAddItem();

  return (
    <button onClick={() => addItem({ productId, quantity: 1 })}>
      Add to Cart {!isEmpty && `(${data?.items.length})`}
    </button>
  );
}
```

---

## 3. Shopper Context

### ShopperContext (Global Context Provider)

Provides shopper identity overrides to all descendant hooks.

| Prop | Type | Description |
|------|------|-------------|
| `cartId` | `string?` | Override cart UUID (e.g. from URL or Plasmic Studio) |
| `accountId` | `string?` | EP account token for account-member carts |
| `locale` | `string?` | Locale override (e.g. `en-US`) |
| `currency` | `string?` | Currency override (e.g. `USD`) |

Singleton via `Symbol.for('@elasticpath/ep-shopper-context')` — safe across multiple package instances.

### useShopperContext()

```ts
const overrides: ShopperOverrides = useShopperContext();
// Returns { cartId?, accountId?, locale?, currency? }
// Returns {} when no ShopperContext provider is present
```

### useShopperFetch()

Returns a `fetch` wrapper that auto-attaches `X-Shopper-Context` header when overrides are active.

```ts
const shopperFetch = useShopperFetch();

const data = await shopperFetch<CartData>("/api/cart");
// Automatically adds: X-Shopper-Context: {"cartId":"..."}
// Adds Content-Type: application/json, credentials: "same-origin"
```

---

## 4. Cart Hooks

### useCart()

SWR-cached cart data. Cache key includes `cartId` when present via ShopperContext.

```ts
interface UseCartReturn {
  data: CartData | null;    // { items: CartItem[], meta: CartMeta | null }
  error: Error | null;
  isLoading: boolean;
  isEmpty: boolean;         // true when items.length === 0
  mutate: () => Promise<CartData | undefined>;  // force re-fetch
}
```

**CartItem** fields: `id`, `type`, `product_id`, `name`, `description`, `sku`, `slug`, `quantity`, `image?`, `meta.display_price.with_tax.unit/value { amount, formatted, currency }`.

### useCheckoutCart()

Normalized cart data for checkout display. Flat fields, formatted prices.

```ts
interface CheckoutCartData {
  id?: string;
  items: CheckoutCartItem[];
  itemCount: number;
  subtotal: number;             // Minor units (cents)
  tax: number;
  shipping: number;             // Always 0 in cart context
  total: number;
  formattedSubtotal: string;    // "$100.00"
  formattedTax: string;
  formattedShipping: string;
  formattedTotal: string;
  currencyCode: string;         // "USD"
  showImages: boolean;
  hasPromo: boolean;
  promoCode: string | null;
  promoDiscount: number;
  formattedPromoDiscount: string | null;
}

interface CheckoutCartItem {
  id: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;            // Minor units
  linePrice: number;
  formattedUnitPrice: string;
  formattedLinePrice: string;
  imageUrl: string | null;
}
```

### useAddItem()

```ts
const addItem = useAddItem();

interface AddItemInput {
  productId: string;
  variantId?: string;
  quantity?: number;            // Default: 1
  bundleConfiguration?: unknown;
  locationId?: string;
  selectedOptions?: {
    variationId: string;
    optionId: string;
    optionName: string;
    variationName: string;
  }[];
}

await addItem({ productId: "abc-123", quantity: 2 });
// POST /api/cart/items -> auto-refetches cart via SWR mutate
```

### useRemoveItem()

```ts
const removeItem = useRemoveItem();
await removeItem("line-item-id");
// DELETE /api/cart/items/{id} -> auto-refetches cart
```

### useUpdateItem()

```ts
const updateItem = useUpdateItem();
updateItem("line-item-id", 3);
// PUT /api/cart/items/{id} — debounced at 500ms
// Quantity 0 triggers removal on the server
```

### ServerCartActionsProvider

Bridges cart hooks to Plasmic `$actions` for visual interaction authoring.

```ts
// Registers three global actions:
interface ServerCartActions {
  addItem(productId: string, variantId: string, quantity: number): void;
  updateItem(lineItemId: string, quantity: number): void;
  removeItem(lineItemId: string): void;
}

// In Plasmic: $actions.epCart.addItem(productId, "", 1)
```

| Prop | Type | Description |
|------|------|-------------|
| `globalContextName` | `string` | Action namespace (e.g. `"epCart"`) |

### MOCK_SERVER_CART_DATA

Design-time mock data for Plasmic Studio canvas previews. Import for storybook or testing:

```ts
import { MOCK_SERVER_CART_DATA } from "@elasticpath/plasmic-ep-commerce-elastic-path";
// CheckoutCartData with 2 Ember & Wick candles, $108.25 total
```

---

## 5. Server Utilities

Import from the `/server` subpath:

```ts
import {
  resolveCartId,
  parseShopperHeader,
  buildCartCookieHeader,
  buildClearCartCookieHeader,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
```

### resolveCartId(headers, cookies, cookieName?)

Resolves cart identity with priority: `X-Shopper-Context` header > `ep_cart` cookie > `null`.

```ts
function resolveCartId(
  headers: Record<string, string | string[] | undefined>,
  cookies: Record<string, string | undefined>,
  cookieName?: string  // default: "ep_cart"
): string | null
```

### parseShopperHeader(headers)

Extracts JSON from the `x-shopper-context` header.

```ts
function parseShopperHeader(
  headers: Record<string, string | string[] | undefined>
): ShopperHeader
// Returns { cartId?, accountId?, locale?, currency? }
// Returns {} if header absent or malformed
```

### buildCartCookieHeader(cartId, opts?)

Builds a `Set-Cookie` header value.

```ts
interface CartCookieOptions {
  cookieName?: string;  // default: "ep_cart"
  secure?: boolean;     // default: true in production
  maxAge?: number;      // default: 30 days (in seconds)
  path?: string;        // default: "/"
}

const header = buildCartCookieHeader("cart-uuid-123");
// "ep_cart=cart-uuid-123; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000"
```

### buildClearCartCookieHeader(opts?)

Use after order completion to remove the cart cookie.

```ts
const header = buildClearCartCookieHeader();
// Sets Max-Age=0 to expire the cookie
```

---

## 6. Consumer API Routes

Full Next.js App Router examples. These routes are what the browser hooks call.

### GET /api/cart

```ts
// app/api/cart/route.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveCartId, buildCartCookieHeader } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

export async function GET(req: NextRequest) {
  const headers = Object.fromEntries(req.headers);
  const cookies = Object.fromEntries(
    req.cookies.getAll().map((c) => [c.name, c.value])
  );
  const cartId = resolveCartId(headers, cookies);

  if (!cartId) {
    return NextResponse.json({ items: [], meta: null });
  }

  const cart = await fetchEPCart(cartId); // your EP SDK call
  const res = NextResponse.json(cart);
  res.headers.set("Set-Cookie", buildCartCookieHeader(cartId));
  return res;
}
```

### POST /api/cart/items

```ts
// app/api/cart/items/route.ts
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { productId, variantId, quantity = 1 } = body;

  let cartId = resolveCartId(/* ... */);
  if (!cartId) {
    const newCart = await createEPCart(); // auto-create
    cartId = newCart.id;
  }

  await addItemToEPCart(cartId, { productId, variantId, quantity });
  const cart = await fetchEPCart(cartId);

  const res = NextResponse.json(cart);
  res.headers.set("Set-Cookie", buildCartCookieHeader(cartId));
  return res;
}
```

### DELETE /api/cart/items/[id]

```ts
// app/api/cart/items/[id]/route.ts
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const cartId = resolveCartId(/* ... */);
  if (!cartId) return NextResponse.json({ error: "No cart" }, { status: 400 });

  await removeItemFromEPCart(cartId, params.id);
  const cart = await fetchEPCart(cartId);
  return NextResponse.json(cart);
}
```

### PUT /api/cart/items/[id]

```ts
// app/api/cart/items/[id]/route.ts
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { quantity } = await req.json();
  const cartId = resolveCartId(/* ... */);

  await updateItemQuantity(cartId!, params.id, quantity);
  const cart = await fetchEPCart(cartId!);
  return NextResponse.json(cart);
}
```

---

## 7. Checkout Components

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

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `onComplete` | `(data: { orderId: string }) => void` | Fires on confirmation step |
| `previewState` | `"auto" \| "customerInfo" \| "shipping" \| "payment" \| "confirmation"` | |

---

### EPOrderTotalsBreakdown

Reads totals from `checkoutData.summary` or falls back to `checkoutCartData`.

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

**refActions:** `setField(name, value)`, `validate()`, `clear()`

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

Repeater over shipping rates fetched from the server. Calls `POST /api/checkout/calculate-shipping`.

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

**API request shape:**
```ts
POST /api/checkout/calculate-shipping
{
  shippingAddress: {
    first_name: string; last_name: string;
    line_1: string; city: string;
    postcode: string; country: string;
  }
}
```

---

### EPPaymentElements

Stripe Payment Element wrapper. Lazy-loads `@stripe/stripe-js` and `@stripe/react-stripe-js`.

**DataProvider `paymentData`:**

```ts
{
  isReady: boolean;
  isProcessing: boolean;
  error: string | null;
  paymentMethodType: string;
  clientSecret: string | null;  // from CheckoutPaymentContext
}
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `stripePublishableKey` | `string?` | Stripe publishable key (pk_test_... or pk_live_...) |
| `appearance` | `Record<string, any>?` | Stripe Elements appearance theme |
| `previewState` | `"auto" \| "ready" \| "processing" \| "error"` | |

Reads `clientSecret` from `CheckoutPaymentContext` (provided by EPCheckoutProvider after calling `/api/checkout/setup-payment`).

---

### Checkout API Routes

These server routes must be implemented in your Next.js app:

| Route | Method | Purpose | Request Body |
|-------|--------|---------|-------------|
| `/api/checkout/calculate-shipping` | POST | Returns shipping rates | `{ shippingAddress: AddressData }` |
| `/api/checkout/create-order` | POST | Creates EP order | `{ cartId, customer, shipping, billing, shippingRate }` |
| `/api/checkout/setup-payment` | POST | Creates Stripe PaymentIntent | `{ orderId, amount, currency }` |
| `/api/checkout/confirm-payment` | POST | Confirms payment | `{ paymentIntentId, orderId }` |

---

## 7.5. Studio Server Queries (SSR)

For SSR'd product/cart/list data — where the initial HTML payload contains real EP data without a client-side waterfall — wire up Plasmic's Server Queries against the EP custom functions exposed by `@elasticpath/plasmic-ep-commerce-elastic-path/server`. This is what makes a PDP render `Test product English` `$15.00` in the response from the first request, before any JS runs in the browser.

### Architecture

```
Browser                          Server (Next.js)              Elastic Path
-------                          ----------------              ------------
                                 catch-all page.tsx
                                   buildEpCtx() ----- mints ---> /oauth/access_token
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
| `ep.getProduct` | `{ id }` | `Product \| null` — single product by EP UUID |
| `ep.getCart` | `{}` | `Cart \| null` — current cart contents |
| `ep.getProductList` | `{ limit?, search?, categoryId?, sort? }` | `Product[]` — paginated list |
| `ep.getRelatedProducts` | `{ productId, relationshipSlug, limit? }` | `Product[]` — products linked by EP custom relationship |

The session (`accessToken`, `host`, `clientId`, `cartId?`, `accountId?`, `locale?`) is **not** an argument. `withEpSession(epCtx, callback)` establishes a per-request `AsyncLocalStorage` scope; each `ep.*` function reads the active session via `getCurrentEpSession()` internally. Outside any `withEpSession` scope (Studio canvas, mistakes), functions fail-soft to `null` / `[]` without calling EP.

### Studio binding

For each Server Query in the Plasmic UI:

- **Function:** `ep.getProduct` (or `getCart`/`getProductList`/`getRelatedProducts`)
- **Arguments (object editor):** `{ id: $ctx.params.slug }` — note `$q` (server queries) vs `$queries` (client data queries) when binding the result.

Then bind the consuming component's `product` / `cart` / `products` prop (advanced section) to `$q.<queryName>.data`.

### Required Next.js setup

1. **`platformOptions: { nextjs: { appDir: true } }`** in `plasmic-init.ts`. Without this the loader fetches the Pages Router bundle which omits `serverQueriesExecFuncFileName` per-page metadata.
2. **Wrap `unstable__getServerQueriesData` in `withEpSession(epCtx, ...)`** in the catch-all page. Without it, the EP functions run outside any session scope and return `null` / `[]`.
3. **Resolve a real page path for the API route's `epProviderHeaders()`** — use `PLASMIC.fetchPages()` rather than hardcoding `/`. Projects without a homepage route otherwise return `null` from `maybeFetchComponentData("/")` and the credentials-extraction path silently fails.

### Common gotchas

| Symptom | Likely cause |
|---|---|
| Queries return `null` / `[]` despite valid arguments | Missing `withEpSession(epCtx, …)` wrap around `unstable__getServerQueriesData` |
| `prefetchedQueryData: "$undefined"` in the SSR HTML | `appDir: true` missing from loader config |
| `EP OAuth failed (401)` in dev log | Override headers (`x-ep-client-id`/`x-ep-host`) returned empty — usually because `getEpProviderConfig` hardcoded `/` and the project has no homepage |
| Auth works on the page but `/api/ep/cart` returns 500 | Pre-fix: `toNextJsHandler` was passing the native Next `Request` directly; resolved by the Request adapter committed in `a363aaf23` |
| Studio binding still references `auth: $ctx.ep` | Project predates PRD #272 — drop `auth` from each Server Query argument |

## 8. Utility Components

### EPCheckoutCartSummary

Fetches cart data and provides it to children. Supports collapsible mode for mobile.

- **DataProvider:** `checkoutCartData` (same shape as `CheckoutCartData`)
- **Props:** `showImages?`, `collapsible?`, `isExpanded?`, `onExpandedChange?`, `cartData?` (code-only: pass `CheckoutCartData` to skip internal fetch)

### EPCheckoutCartItemList

Repeater over items from `checkoutCartData`.

- **DataProvider (per item):** `currentCheckoutItem` — `{ id, name, quantity, price, formattedPrice, imageUrl, sku, options }`
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

Promo code input with apply/remove. Supports client-side EP SDK or server routes.

- **DataProvider:** `promoCodeData` — `{ code, state, formattedDiscount, errorMessage }`
- **Props:** `useServerRoutes?` (toggle between EP SDK and `/api/cart/promo`), `placeholder?`, `applyLabel?`, `removeLabel?`, `onApply?`, `onRemove?`, `onError?`

---

## 9. DataProvider Quick Reference

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
| `checkoutCartData` | EPCheckoutCartSummary | `items`, `itemCount`, `formattedSubtotal`, `formattedTax`, `formattedShipping`, `formattedTotal`, `currencyCode`, `showImages`, `hasPromo`, `promoCode` |
| `currentCheckoutItem` | EPCheckoutCartItemList | `id`, `name`, `quantity`, `price`, `formattedPrice`, `imageUrl`, `sku` |
| `currentCheckoutItemIndex` | EPCheckoutCartItemList | `number` |
| `billingToggleData` | EPBillingAddressToggle | `isSameAsShipping` |
| `promoCodeData` | EPPromoCodeInput | `code`, `state`, `formattedDiscount`, `errorMessage` |
