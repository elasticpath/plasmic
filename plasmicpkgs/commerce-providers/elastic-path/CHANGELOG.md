# Changelog

## Unreleased

### Added

`ep.getProductPage({ limit?, offset?, search?, categoryId?, sort? })` — one page
of products with the total count, in Elastic Path's envelope (`data`, plus
`meta.results.total` and `meta.page`). `getProductList` returns a flat array
with no total, so a listing bound to it cannot compute ranges or next/previous.
Counts are `number`, not the SDK's `BigInt`, which `JSON.stringify` rejects.

EP Product List Provider gains **Products (pre-fetched)** (`initialPage`),
mirroring EP Product Provider's pre-fetched `product`. Bind it to an
`ep.getProductPage` Server Query result to server-render the first page with no
browser request for data the page already carries. The query's `page[limit]`
sets the page boundaries, overriding Page Size. Sorting or paging discards the
seed and falls back to client fetching; in load-more mode the seeded products
are the buffer the next page appends to. Leaving it empty preserves today's
client-fetch behaviour.

### Removed

`EPMultiLocationStock`, its `epMultiLocationStockMeta` registration, and the
three presentational components it alone consumed — `MultiLocationStock`,
`StockIndicator` and `LocationSelector`. Unlike the removals below, this
component was registered and worked, so this is a breaking change: a saved
Studio project that uses it will no longer render, and because the set of
registered components changes, the next `publish-hostless` cuts a new hostless
package version.

None of it was designable. The component exposed no `className` and no slots,
so every style it drew — the `#e0e0e0` borders, the `8px` corners, the literal
`<h4>Stock Availability</h4>` heading — was fixed at build time. It also fought
the newer components over `SelectedLocationSlug`, the form field Add To Cart
reads to decide which location to fulfil from: it cleared that field on mount
whenever it had no selection of its own, so placing it beside `EPStockProvider`
could wipe a location the shopper had already chosen. `EPStockProvider` with
`EPLocationPicker` and `EPLocationField` produces the same result, is fully
designable, and adds a dropdown mode and `?location=` URL syncing.

The helpers those components were the only callers of went with them:
`filterStockByLocation` in `inventory/utils/stockCalculations.ts`, and
`createStockSummaryMessage`, `shouldShowMoreLocationsIndicator` and
`createMoreLocationsText` in `inventory/utils/displayHelpers.ts`.
`getStockIndicatorStyle` and its `StockIndicatorStyle` type are gone too —
already unreferenced before this change, but named for a component that no
longer exists.

`EPLocationList` and its `epLocationListMeta`. The component was exported from
the package root but never registered, so it was never usable from Studio, and
it read its locations from a `StockContext` that nothing has ever rendered — it
would have shown "No locations available" in every case. `EPStockProvider`
already repeats its children once per location and provides `currentLocation`,
`currentLocationIndex` and the roving-focus data `EPLocationPicker` needs.

`LocationAwareAddToCartProps` and the `src/inventory/index.ts` re-export of
`./components/LocationAwareAddToCart`, a module that has never existed. The
barrel only stayed green because nothing imports it — the package entry reaches
`MultiLocationStock` directly — so any import of `src/inventory` failed to
compile.

## 0.4.1

### Fixed

Studio offered none of the eight `ep.*` server functions in its Server Query
pickers. `ServerQueryOpPicker` filters on `mode === "mutation" ? fn.isMutation
: fn.isQuery`; the four reads set neither flag, and three of the four cart
writes set neither either, so they were invisible in both pickers. The reads
worked until that filter arrived from upstream. Registration now derives
`isQuery` from `isMutation` so the two are exhaustive and a new function
cannot be registered as neither.

Code components and server functions registered with an `importPath` of the
package root or `/server` were not all exported from those entry points.
Studio resolves registrations through live JS references, so the dev host and
add-drawer worked; the loader resolves `importName` against the real export
surface, so publishing a project that used one failed to bundle with
`No matching export`. 15 components and all 8 `ep.*` server functions were
affected. The server functions are exported as their adapted, positional-arg
forms — the shape the loader calls them with.

Three enums (`CheckoutStep`, `OrderStatus`, `PaymentStatus`) were re-exported
via `export type`, which erases them at runtime. They are values again.

## 0.4.0

### Breaking

Products and carts are now Elastic Path's own response shapes, augmented rather
than normalized (ADR-0002). Elastic Path's API documentation is the binding
reference: what the docs describe is what `$ctx.currentProduct` and `$ctx.cart`
carry. Every saved binding that reached into the old Shopify-lineage shape
needs repointing.

| Was                                                    | Now                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| `currentProduct.name`                                  | `currentProduct.attributes.name`                            |
| `currentProduct.description` / `.sku` / `.slug`        | `currentProduct.attributes.*`                               |
| `currentProduct.price.value`                           | `currentProduct.meta.display_price.without_tax.float_price` |
| `currentProduct.price.currencyCode`                    | `currentProduct.meta.display_price.without_tax.currency`    |
| `currentProduct.options`                               | `currentProduct.variations`                                 |
| `currentProduct.variants`                              | `currentProduct.childProducts`                              |
| `currentProduct.path`                                  | removed — build it from `attributes.slug`                   |
| `cart.lineItems`                                       | `cart.items`                                                |
| `cart.subtotalPrice` / `.totalPrice`                   | `cart.meta.display_price.without_tax` / `.with_tax`         |
| `cart.currency.code`                                   | `cart.meta.display_price.without_tax.currency`              |
| `$ctx.cartData`                                        | `$ctx.cart`                                                 |
| `$ctx.checkoutCartData`                                | `$ctx.cart`                                                 |
| `currentVariationOption.label`                         | `currentVariationOption.name`                               |
| `currentCartItem.imageUrl`                             | `currentCartItem.image.href`                                |
| search hit `currentProduct.path` / `._highlightedName` | `$ctx.currentHit.path` / `.highlightedName`                 |

Instances of the generic `@plasmicpkgs/commerce` components — any
`plasmic-commerce-*` name without the `ep-` segment — stop rendering entirely,
with `TypeError: Cannot read properties of undefined (reading 'current')`. The
framework context they read is no longer supplied, so no amount of repointing
fixes them; they have to be replaced with their `plasmic-commerce-ep-*`
equivalents. `product-collection` becomes an `ep-product-list-provider`
wrapping an `ep-product-grid`; `product-box` becomes `ep-product-provider`,
whose `id` prop is now `productId`; `product-text-field` and `product-price`
become `ep-product-field`; `product-media` becomes a plain image bound to
`currentProduct.images[0].url`; `cart-provider` becomes `ep-cart-provider`.

`EPProductField`, `EPCartField`, `EPCartItemField` and `EPCheckoutCartField`
selections survive: the saved choice values are unchanged and only the paths
behind them moved.
`EPCartItemField`'s "Variant ID" choice is removed — it always held the same
value as "Product ID".

Also removed: `hexColors` on variation options (Elastic Path has no colour
there, and it was only ever populated by the design-time mock), `CartItemBody`,
`ExtendedCartItem`, `deriveCartData`, `buildCurrentProduct`, `CheckoutCartData`,
and five uncalled functions in `cartDataBuilder`.

### Money

Prices carry Elastic Path's own `formatted` string, and `currencyDisplay`
defaults to a new `"platform"` value that renders it — so a store's Commerce
Manager formatting is honoured. `"symbol"` and `"code"` keep the previous
`Intl` behaviour.

`amount / 100` is gone. Decimals come from the currency's real exponent, so
zero-decimal currencies (JPY `amount: 5000` → `¥5,000`) are correct where they
previously rendered 100x too small.

### Fixed

- A cart's subtotal, tax and total were one tax-inclusive number assigned to
  all three. Elastic Path reports them separately and they now stay separate.
- Money formatting used `Intl.NumberFormat(undefined, …)`, so the server
  formatted with Node's locale and the browser with its own — the visible
  symptom was `US$20.00` against Elastic Path's own `$20.00`. Every `Intl` call
  now takes an explicit locale, and the four checkout sites that hardcoded
  `en-US` read the provider's locale.
- Server-rendered product lists joined no images: `epGetProductList` and
  `epGetRelatedProducts` passed the response where the locale goes and the
  locale where the `included` block goes.
- A base product's price was inherited from whichever child Elastic Path
  happened to return first. It is now `priceFrom`, the lowest.
- Variations ignored the merchandiser's `sort_order`, which Elastic Path
  documents as the display-order contract.
- The variation picker matched child products on option display names, so
  renaming an option in Commerce Manager silently stopped resolving a child.
  It matches on option ids, and a selection that resolves to no child now
  selects nothing rather than falling back to the first one — that fallback
  showed the shopper a different variant at a different price.
- Checkout money displays kept the formatting they were first rendered with:
  the three memos that format totals, order summaries and shipping rates closed
  over `currencyDisplay` and `locale` without depending on them, so a
  designer-bound currency or locale switcher left them stale until unrelated
  data forced a recompute. They share a bound `useMoneyFormat` instead.
- An empty cart rendered "Loading cart…", being indistinguishable from a cart
  that had not loaded. `EPCartProvider` gains `loading`/`error`/`empty` slots.

## 0.3.0

### Breaking

The shopper's Elastic Path access token no longer reaches the browser. It was
previously serialized into page HTML as `globalContextsProps.serverToken`,
readable by any script on the page.

Cart and checkout now always run through the server routes. The browser-direct
Elastic Path SDK cart path, and the `serverCartMode` toggle that selected
between them, are gone.

**Removed hooks** — all four called the Elastic Path SDK directly from the
browser using the leaked token:

| Removed                | Replacement                                                 |
| ---------------------- | ----------------------------------------------------------- |
| `cart/use-cart`        | `useCart` from `shopper-context`                            |
| `cart/use-add-item`    | `useAddItem` from `shopper-context`, or `EPAddToCartButton` |
| `cart/use-update-item` | `useUpdateItem` from `shopper-context`                      |
| `cart/use-remove-item` | `useRemoveItem` from `shopper-context`                      |

**Removed provider surface** — `getElasticPathProvider` and
`getCommerceProvider` no longer take a `serverToken` argument, and the returned
provider no longer carries `cart`. `initElasticPathClient` takes credentials
only; its client serves catalog reads and mints its own anonymous token from
the public `clientId`.

**Removed from the storefront** — drop the `globalContextsProps` entry that fed
`session.providerProps()` into `PlasmicClientRootProvider`. `providerProps()`
now returns `{}`.

**Removed `epClientSecret`** from `createEpAuth`'s config. It was accepted and
stored but never read. Drop it from your `createEpAuth` call; nothing replaces
it.

**Mount the auth handler with `createEpAuthRoutes`**, not better-auth's
`toNextJsHandler`:

```ts
// app/api/ep/[...path]/route.ts
export const { GET, POST } = createEpAuthRoutes(epAuth);
```

Every endpoint on the auth handler returns the session record, and the session
carries the shopper's EP credentials — the anonymous access token on all of
them, plus the account-management token once a shopper logs in. The raw handler
hands those to any same-origin script for the cost of one fetch; `/ep/refresh`
returns a freshly rotated token and `/ep/anonymous` needs no cookie at all.

`createEpAuthRoutes` filters the session on every response down to an allowlist:
`id`, `userId`, `expiresAt`, `createdAt`, `updatedAt`, `epCartId`, `epExpires`.
A field added to the session later is withheld by default. `epCartId` is kept
because the checkout components read it and it is not a credential; the
better-auth session id is not, because it lives in an HttpOnly cookie
specifically so scripts cannot read it.

`serverToken` and `serverCartMode` remain in the registered prop schema, hidden
and ignored. Registered props on a hostless package are append-only; removing
one breaks hostless publishing for every package. Everywhere else the flag is
gone: `EpCtx` and `EpProviderBundleConfig` no longer carry `serverCartMode`,
and `extractEpProviderConfig` no longer scrapes it from the loader bundle.

### Removed

The `getServerInfo` bridge on the provider global context, along with the
`auth/ep-*-server-info.ts` modules it fed. They targeted an upstream API that
was reverted and were never wired to a component. Server-side data flows
through Studio Server Queries and `withEpSession` instead.
