# Changelog

## Unreleased

### Added

Six server functions reach data that previously only the browser client could:
`ep.getStock`, `ep.getLocations`, `ep.getBundleOptionProducts`,
`ep.getBaseProducts`, `ep.configureBundle` and `ep.multiSearch`. Each is
registered for Studio Server Queries and dispatchable from the browser through
the proxy route. Nothing is removed and no call site moves — the browser client
and every component that uses it behave exactly as before.

`ep.multiSearch` returns Elastic Path's response as written, under a
package-owned type that keeps the top-level `included` block. That block is
where the search adapter resolves each hit's `main_image`, and the SDK's own
`MultiSearchResponse` does not declare it — typing the result with the SDK
shape would drop every search hit's picture with nothing failing. Ask for the
block with `include: ["main_image"]`: Elastic Path omits it entirely unless the
call requests it, verified against a live store.

Every server call sends `EP-Inventories-Multi-Location`, as the browser client
already did. The locations registry 404s outright without it, and stock comes
back with no per-location breakdown — both of which read as "this store has
none" rather than as an error. It lives on the shared client builder rather
than on the two inventory functions, because leaving it to each function to
remember is how `ep.getLocations` first shipped reporting an empty store.
Confirmed inert on catalog and cart calls, reads and writes alike.

`ep.getStock` reports its counts as numbers. The browser hook builds them as
`BigInt`, which cannot cross `JSON.stringify` — and this value crosses it twice,
into prefetched query data and through the proxy route. Its per-location shape
is otherwise the browser client's, counts under `stock`, so a call site can
move without rereading them.

The two bundle product reads return the package's own product shape, so a
bundle option carries joined images and a price with all four members rather
than a bare formatted string. `ChildProduct` gains `bundleExcluded`, the
Elastic Path custom field marking a variation the merchandiser kept out of
bundle selection.

`sessionCartResolver` on `createEpAuth` chooses the session cart at a login or
an account switch, configured once rather than per call site. It is handed the
guest cart, the carts already on the account, and which transition this is; it
returns `{ keep }` naming one of them. It runs after the account swap, inside
the session context under the shopper's new identity, so it can read and write
carts rather than only choose between them — a rule like
take-the-higher-quantity needs per-line arithmetic, and no verdict value
carries that.

With no resolver the guest cart wins, and with no guest cart the account's most
recently updated cart is adopted. This is a change of behaviour from the
documented `cartMergeStrategy: "merge"` default: nothing merges, because
Elastic Path's own copy operation adds quantities together and ten saved plus
two added becoming twelve is not a merge anyone asked for. `cartMergeStrategy`
was read by no code, so nothing that worked stops working; it is removed in the
breaking release.

`trigger` is `"accountSwitch"` only where CONTEXT.md says an account switch is:
the selected organisation changed without re-authenticating. Everything else is
`"login"`, including a member of several organisations choosing their first
one. `guestCartId` is null whenever the trigger is `"accountSwitch"`.

The carts handed to a resolver arrive most recently updated first. Elastic Path
ignores `sort` on its cart list, so the order is the package's own.

A resolver that throws, or names a cart it was not offered, never blocks the
sign-in: the default applies and the failure is logged. The losing cart is
never deleted, and switching organisation never carries the previous
organisation's cart across.

`POST /ep/account/login` now tears down any checkout session in flight, as an
account switch already did. The identity changed, so the checkout was priced
and addressed for a shopper who is no longer the one here.

The `EpAccountCart`, `EpSessionCartResolver`, `EpSessionCartResolverInput`,
`EpSessionCartTrigger` and `EpSessionCartVerdict` types are exported from
`/server`.

`EPAccountProvider`, `EPAccountGate` and `EPAccountField` are the first
Studio-facing surface over the account identity work in 0.7.0. The Provider
maps `get-session` identity (and the account roster when a member is
present) into `$ctx.account` — `accountMember`, `selectedAccount`,
`accountRoster` (`{ accounts, total }`), `lapsedAccount`, derived
`state` (`anonymous | memberOnly | selected | lapsed`), and `isLoading`,
which stays true until the session read settles so no Gate renders its
children on the server or before the session arrives. Credentials stay server-side. Gate
and Field only consume that published context: Gate renders children on
`anonymous | authenticated | selected | lapsed`; Field reads one shallow
value. Preview State is Studio only, the same
pattern as `EPCheckoutProvider`: explicit values force one of the four
fixtures so Gates and Fields can be composed; `auto` uses live session
identity when a member is present, otherwise the selected-account
fixture. The published page always reads the live session and ignores
Preview State. No login, logout or account-switching action exists yet —
the Provider only reads — and `accountMember` carries an id and nothing
else, so no member profile field (name, email) is in the contract.

### Fixed

`ep.applyCartAdjustment` is dispatchable from the browser. It has been
registered as a Studio mutation since it landed, but had no entry in the proxy
route's dispatch table, so an adjustment a designer wired to an onClick — a
promo code, a handling fee — could not reach the server at all and failed with
`unknown_fn`.

`epAddCartItem`, `epUpdateCartItem`, `epRemoveCartItem` and `epGetProductList`
have a browser transport. Called outside a request scope they threw "no EP
session" (or, for the list, fetched under another function's name) instead of
routing through the proxy the way the other server functions do.

Signing out clears the cart pointer. It stripped the account fields and left
`epCartId`, handing the next shopper on that browser the previous one's cart.

`withEpSession` keeps working when the package is loaded as ES modules. It
reached `async_hooks` through `eval("require")`, which native ESM has no
`require` for, so the session scope fell through to its no-op and every `ep.*`
call fail-softed to `null` or `[]`. `process.getBuiltinModule` works in both
module formats; `require` remains the fallback for Node below 20.16 / 22.3,
which can still only reach it as CommonJS.

A session scope that cannot load now says so on the console instead of leaving
every `ep.*` call to return nothing for no visible reason.

The headers a shopper-facing Elastic Path call must carry now come from one
function, `epShopperHeaders`, rather than being spelled out at each of the
three call sites. That is how one site came to be missing the multi-location
header. The cart routes apply it after the caller's own headers, so neither the
header nor the account credential can be overridden per call. No caller passed
either, so nothing changes today.

### Removed

The undocumented `auth` field on the inputs of `getProduct`, `getProductList`,
`getProductPage`, `getRelatedProducts`, `getCart`, `getStock`, `getLocations`,
`getBaseProducts`, `getBundleOptionProducts`, `configureBundle` and
`multiSearch`. Nothing set it, and the proxy route forwards the browser's
request body verbatim, so it was a way to name your own credentials that only
the order of two lines kept shut. The shopper envelope is now the sole identity
input. `EpGetCartInput` goes with it in the breaking release: `epGetCart` takes
no argument, so the type had nothing left to name.

## 0.7.0

### Added

The session now carries business-account identity: `epMemberId` for the
authenticated **account member**, and `epAccount { id, name, token, expires }`
for the **selected account** — the organisation they are buying for. Every
`ep.*` call carries `EP-Account-Management-Authentication-Token` while an
account is selected, so account-scoped pricing reaches every server function
without any function opting in. The checkout-session handlers are not covered
yet; they take their own shopper token on `SessionHandlerContext`.

`epAccount` and `epAnchorToken` are mutually exclusive slots, and the account
header is attached only from `epAccount.token`, so a session with no account
selected cannot send an account credential.

`epLapsedAccount { id, name }` states that a selection's credential ran out,
so the storefront can tell the shopper which organisation they lost instead of
quietly showing list prices. Every session read reports the lapse — not only
the reads where a token rotation happens to run — so an expired credential is
never attached to a call. `/ep/refresh` writes the same transition to the
cookie when it next runs.

`createCartRoutes` carries the selected organisation's credential too. Those
routes reach Elastic Path through their own client rather than through the
`ep.*` client builder, so a signed-in member's cart reads and writes would
otherwise have stayed list-priced while every other call was account-scoped.

`get-session` releases `epMemberId`, `epAccount.{id,name}` and
`epLapsedAccount.{id,name}`. The response filter now names paths rather than
whole fields, so the account credential and its expiry stay out of the page
while the organisation's id and name are readable.

`POST /ep/account/login` takes `{ username, password }` and mints the account
credential on the server, so no Elastic Path credential passes through the
browser at any point in the flow. It answers with the roster —
`{ accounts: [{ id, name }], total }` — so a chooser renders with no second
call. A member of exactly one organisation is placed in it; a member of
several has none chosen for them; a member of none signs in successfully,
authenticated but unscoped.

`POST /ep/account/roster` reads the same list later in the session, forwarding
Elastic Path's own `limit`, `offset` and total rather than imposing a ceiling
of its own, so a member in more organisations than one page holds can still
reach any of them.

`POST /ep/account/select` switches organisation without a password.
It re-mints first, then tears down any checkout session and clears the cart
pointer, and writes the new selection last — a switch that fails changes
nothing. Selecting the organisation already selected is a no-op, and
`{ accountId: null }` deselects by demoting the credential to the anchor.

The account credential is re-minted while it has under an hour left, with
nothing visible to the shopper. Rolling reaches only sessions making calls, so
an idle shopper still lapses — which `epLapsedAccount` states as a fact, and
which roster and select report as `account_lapsed` rather than presenting a
dead credential to Elastic Path.

The checkout session torn down on a switch is `CookieSessionStore`'s. A
consumer-supplied `SessionStore` is out of the auth handler's reach and must be
cleared by the consumer.

`createEpIdentityClient` and the `useEpIdentity` hook call the identity
operations by name — sign in, read the account roster, select or deselect an
account, sign out, set the cart — so a call site never writes a route or a base
path. The client takes the `basePath` the auth handler was mounted at and
nothing else; `epIdentityErrorCode` reads the server's reason for refusing, so
a storefront can branch on `account_lapsed` rather than on a status code.

`RELEASED_SESSION_PATHS` and the `ReleasedEpSession` types state what
`get-session` releases, so a consumer reading the session gets the same shape
the server filters to rather than guessing at it.

`passwordProfileId` on `createEpAuth` names the password profile members sign
in against. The package discovers it when the store's authentication realm
carries exactly one; a realm with several is reported rather than guessed at,
because signing in against the wrong profile fails with Elastic Path's own
`authentication failed`.

`ENVELOPE_LIFETIME_SECONDS` and `EP_ACCOUNT_TOKEN_HEADER`, plus the
`EpAccountSlot`, `EpLapsedAccount`, `EpSessionData` and
`BuildEpCtxAccountInput` types, are exported from `/server`.

### Changed

`isAuthenticated` now reports whether an account member is present, not
whether an account is selected. A member who belongs to no organisation reads
as signed in rather than signed out.

`buildEpCtx` takes the selected account as `session.account` and no longer
reads `session.accountId`. Catchall pages pass
`account: session.session?.account ?? null` in place of
`accountId: session.user?.accountId`, which was never populated.

`POST /ep/account/login` writes the grouped account shape. The flat
`epAccountId` / `epAccountToken` / `epAccountExpires` session fields are gone.
The older client-supplied-token body still works, still requires `epMemberId`
and still verifies the token against Elastic Path; it is removed in the
breaking release.

### Fixed

The session cookie no longer falls back to better-auth's 300-second
`cookieCache` default. Both it and the session's own expiry run on the cart's
seven-day clock and roll on `/ep/refresh`, so the envelope outlives the basket
it holds the only handle to.

An HTTPS deployment reads its own session cookie. `createEpAuth` left
better-auth to write `__Secure-`-prefixed cookies while the plugin looked up
the unprefixed name with no fallback, so `/ep/refresh`, account select,
account clear and cart-id persist all read no session in any HTTPS deployment
— and every one of them worked on `http://localhost`.

`epAccountExpires` accepts the ISO-8601 timestamp Elastic Path actually
returns, as well as epoch seconds. It previously demanded a number.

After a successful **cart PaymentIntent** checkout, the cart's
`payment_intent_id` is cleared (Update Cart with an empty id) before the
best-effort cart delete — only when `confirmOrder` reconciliation succeeded.
When reconciliation is pending, the Cart PI link is left in place. A surviving
cart can no longer carry a paid Stripe PaymentIntent into a later order after
a clean settle. Clear failures after a successful charge are non-fatal
(logged); abandon still fails closed on clear failure.

The zero-total (`settleFreeOrder`) path clears any leftover cart
`payment_intent_id` the same way before cart delete, so an earlier failed
Stripe attempt cannot leave a PI on a cart that then settles for free.

Success-path clear prefers the `client_credentials` token (same as cart
delete) so a present-but-expired shopper token cannot skip cleanup when admin
credentials are available.

## 0.6.0

### Added

**EP Manual Payment** (`EPManualPayment`,
`plasmic-commerce-ep-manual-payment`) — a checkout gateway component that
collects no card details and needs no client-side gateway credentials. Drop it
inside **EP Checkout Session Provider** in place of EP Stripe Payment or EP
Clover Payment; Place Order is unchanged. The component only selects the
`manual` gateway — all payment behaviour lives in the server adapter.

`createManualAdapter(config?)`, from `/server`. It registers the `manual`
gateway. The host chooses the EPCC payment method with
`createManualAdapter({ method })` — `"purchase"` (the default) settles
immediately; `"authorize"` leaves the transaction to be captured later, which
this package does not yet do for you. `ManualAdapterConfig` and
`ManualPaymentMethod` are exported alongside it.

The **order-first** payment sequence, for gateways that cannot take payment
against a cart. `/pay` checks the cart out to an unpaid order, asks the adapter
for a payment-setup body, calls EPCC `paymentSetup`, and maps the returned
transaction. Stripe keeps the existing cart PaymentIntent sequence.

`PaymentSequence`, `PaymentSetupRequest`, `CartPaymentIntentAdapter`,
`OrderFirstAdapter` and `LegacyPaymentAdapter`, exported from `/server`.

`isCartPaymentIntentAdapter()`, `isOrderFirstAdapter()` and
`isLegacyPaymentAdapter()`, also from `/server` — the narrowing guards for the
`PaymentAdapter` union. They ship with the union they narrow, so a consumer
holding a `PaymentAdapter` does not have to hand-roll the `paymentSequence`
check. The adapter surface stays on `/server` rather than the package root, so
server-only code stays out of the hostless client bundle.

### Changed

`PaymentAdapter` is now a union discriminated by a `paymentSequence` field:
`CartPaymentIntentAdapter` (`"cart_payment_intent"`), `OrderFirstAdapter`
(`"order_first"`), or `LegacyPaymentAdapter` — the pre-sequence two-method
shape Clover still uses. Existing adapter objects satisfy the union unchanged.
Code that _reads_ a `PaymentAdapter` must now narrow on `paymentSequence`
before reaching `initializePayment`, `buildPaymentSetup` or `confirmPayment` —
use the exported guards above.

`/pay` dispatches on the adapter's declared sequence instead of branching on
the gateway name, so adding a gateway no longer means editing generic checkout.
There is no default sequence: an adapter that declares none and does not match
the legacy shape is rejected.

A gateway's `requires_action` continuation is no longer Stripe-only. EP
Checkout Session Provider ran `completeRequiresAction` only when the registered
gateway was named `stripe`; it now runs for any gateway that registers one.
Stripe 3DS behaviour is unchanged, and a gateway that registers no
continuation — Clover — is unaffected.

An unrecognised EPCC transaction status **fails closed**. A status that is
neither a documented complete nor a documented failed value, carrying no
`client_parameters` and no `next_actions`, is now reported as a failed payment
instead of falling through as success.

An order-first retry reuses the unpaid order recorded on the session rather
than checking the cart out a second time, so retrying a failed payment cannot
leave a second order behind.

`SessionPayment.clientToken` and `PaymentAdapterResult.clientToken` are
documented as opaque EPCC `client_parameters`, not a Stripe PaymentIntent
client secret. Stripe stores its client secret there, but generic code must not
read the field as a PaymentIntent. Type and wire format are unchanged.

## 0.5.3

### Fixed

The package installs into a React 19 app again. The declared
`react-instantsearch@^7.13.6` peer-requires React `<19`, so npm resolves it as
an `ERESOLVE` conflict. The floor goes to `^7.32.0` and `instantsearch.js` to
`^4.96.0`, the versions server-rendered catalog search will also need:
`react-instantsearch-nextjs@1.4.5` deep-imports `isTwoPassWidget` from
`instantsearch.js/cjs/lib/utils`, absent below 4.96.0.

`react-instantsearch-nextjs` goes to `^1.4.5`. It stays in `dependencies`
because a hostless bundle resolves npm dependencies at bundle time and cannot
extend the externals list, so a `require` of a package that is not installed
fails the bundle for every project using this one.

### Removed

The optional `@algolia/autocomplete-plugin-recent-searches` peer dependency.
Nothing requires it.

## 0.5.2

### Fixed

EP Product List Provider's `initialSort` prop and `setSort` ref action are
registered again, as **deprecated and inert**. 0.5.0 removed them, which makes
`publish-hostless` fail with `Deleted param initialSort of component
plasmic-commerce-ep-product-list-provider` — a hostless package cannot drop a
published prop or slot any more than it can drop a component, and the repair
path exists only in Studio's client, so a headless publish cannot get past it.
0.5.0 and 0.5.1 therefore cannot be published as hostless bundles.

Neither does anything. `initialSort` is hidden in Studio and is not threaded
into the query; `setSort` is a no-op that exists so an interaction already
wired to it does not throw. Elastic Path's catalog product endpoints take no
`sort` parameter, so no sort here can work — that is what 0.5.0 fixed, and it
still holds: nothing sends `sort` to Elastic Path. To sort a listing, use
`EPCatalogSearchProvider` with `EPSearchSortBy`, which sorts on the catalog
search index.

## 0.5.1

### Fixed

`EPMultiLocationStock` is registered again, as **deprecated**. 0.5.0 removed it
outright, which makes `publish-hostless` fail with `Hostless package removed
components plasmic-commerce-ep-multi-location-stock` — a component that
disappears from a hostless package's registered set is a fatal error there, and
the repair path exists only in Studio's client, so a headless publish cannot get
past it. 0.5.0 therefore cannot be published as a hostless bundle at all.

Components in a hostless package can be deprecated but not removed. Upstream
does the same thing (`Table (deprecated)` in `antd5`, `Aria Heading
(deprecated)` in `react-aria`): keep the registration, mark it in the
`displayName`.

Do not use it. `EPStockProvider` with `EPLocationPicker` and `EPLocationField`
replaces it, is fully designable, and adds a dropdown mode and `?location=` URL
syncing. This one exposes no `className` and no slots, and it clears the shared
`SelectedLocationSlug` field on mount, so placing it beside `EPStockProvider`
can wipe a location the shopper already picked.

## 0.5.0

### Added

`ep.getProductPage({ limit?, offset?, search?, categoryId? })` — one page
of products with the total count, in Elastic Path's envelope (`data`, plus
`meta.results.total` and `meta.page`). `getProductList` returns a flat array
with no total, so a listing bound to it cannot compute ranges or next/previous.
Counts are `number`, not the SDK's `BigInt`, which `JSON.stringify` rejects.

EP Product List Provider gains **Products (pre-fetched)** (`initialPage`),
mirroring EP Product Provider's pre-fetched `product`. Bind it to an
`ep.getProductPage` Server Query result to server-render the first page with no
browser request for data the page already carries. The query's `page[limit]`
sets the page boundaries, overriding Page Size. Paging discards the seed and
falls back to client fetching; in load-more mode the seeded products
are the buffer the next page appends to. Leaving it empty preserves today's
client-fetch behaviour.

### Fixed

Filtering a listing by category never worked. Elastic Path's catalog product
endpoint has no filterable `category.id` key, and it rejects `and(...)` — terms
compose with a comma. `categoryId` is now understood as a hierarchy **node** ID
and reads `/catalog/nodes/{node_id}/relationships/products`, which also accepts
a name filter, so searching within a category works for the first time. The
Studio prop is relabelled **Category (node) ID**; a hierarchy ID in that prop
returns nothing, as it did before. Both the server functions and the
browser-side listing hook are fixed together.

`ep.getProductList` is now a wrapper over `ep.getProductPage`, dropping the
envelope and returning the first page as a flat array. Its published return
type is unchanged.

### Removed

`EPMultiLocationStock`, its `epMultiLocationStockMeta` registration, and the
three presentational components it alone consumed — `MultiLocationStock`,
`StockIndicator` and `LocationSelector`. This removal is reverted in 0.5.1: it
prevents the hostless bundle from being published at all, so 0.5.0 should not be
adopted.

The product listing's **Sort** control, along with `setSort`, the `sort` key on
`productGridData`, the `sort` argument to `ep.getProductList` and
`ep.getProductPage`, and the `getSortVariables` helper. It never worked and
could not be made to: Elastic Path's catalog product endpoints take no `sort`
parameter — the [Sorting guide](https://developer.elasticpath.com/guides/Getting-Started/sorting)
lists the eight endpoints that accept one and no catalog endpoint is among them.
An unsupported value is ignored rather than rejected, so a sorted request
returned HTTP 200 in the store's unchanged order and nothing surfaced the
problem. The values being sent (`price asc`, `createdAt desc`) were not Elastic
Path syntax either — the helper was copied from another commerce provider,
unused `isCategory` parameter included.

This is a breaking change: a project binding **Sort** or invoking `setSort`
loses that binding, and the set of registered function arguments changes, so the
next `publish-hostless` cuts a new hostless package version. For a sortable
listing use `EPCatalogSearchProvider` with `EPSearchSortBy`, which sorts on the
catalog search index.

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
