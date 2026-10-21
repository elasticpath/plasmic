# Changelog

## Unreleased

### Breaking

This release reverses the design 0.3.0 documented. 0.3.0 moved the shopper's
token to the server but kept a second Elastic Path client in the browser, which
minted its own anonymous token from the public `clientId`. The README then
described keeping that token in browser memory as a security property. **That
claim is retired.** It protected nothing: anyone holding the `clientId` can mint
the same token, and the token can write to `/carts` and `/checkout`.

The package now has one Elastic Path identity. The shopper envelope, the
encrypted `better-auth.session_data` cookie, is the only input to it, no Elastic Path credential of any kind reaches the
browser, and every browser call that carries identity goes through the
storefront's own origin.
[ADR-0003](docs/adr/0003-one-session-for-elastic-path-identity.md) records the
decision. Upgrade in one step: no release supports both designs.

Upgrade the storefront's npm package and publish the hostless package
together; mixed versions are not supported. Shopper cookies and open checkout
sessions survive an upgrade and a rollback, as long as the checkout session
secret (`CHECKOUT_SESSION_SECRET` in the example storefront) does not change.

The package needs Node 22.12 or later, and says so in `engines`. The CommonJS
build `require`s better-auth, which ships only as ES modules.

The package is built with the repository's shared `build.mjs` instead of tsdx,
so the published files change. Importing by package name, as every documented
example does, resolves as before.

| Was | Now |
| --- | --- |
| `dist/plasmic-ep-commerce-elastic-path.esm.js` | `dist/index.esm.js` |
| one `.d.ts` per source file under `dist/` | one rolled-up `dist/index.d.ts`, `dist/server.d.ts` and `dist/server.d.mts` |
| `/server` types under a single `types` condition | `import` resolves `server.d.mts`, `require` resolves `server.d.ts` |

On `/server`, `epAddCartItem`, `epUpdateCartItem` and `epRemoveCartItem` reject
the same way as in the browser. A rejection's `message` is shopper copy, such
as "There isn't enough stock to add that quantity. Try a smaller amount.", not
Elastic Path's reason, and it always has a `code`. To migrate, read Elastic
Path's reason from the rejection's `cause`, not its `message`, and branch on
`code`. In development the proxy route still forwards Elastic Path's reason, so
a rejection in the browser there has that reason as its `message`.

Checkout takes the cart from the shopper's session, never from the browser.
`handleCreateSession` checks out `sessionCartId` on `SessionHandlerContext`
and ignores any `cartId` in the request body. To migrate, set
`sessionCartId: session.cart?.id` where the checkout routes build their
context, from the same `getSession` that gives `shopperAccessToken`, and stop
copying a cart id into the request. Without it, creating a checkout session
returns `409` with code `NO_CART`.

**The server decides which payment methods an order may use.** Before `/pay`
creates an order, it checks the requested gateway against that order:

- `manual` completes an order whose total is zero, with no adapter and no rule.
- For an order with a total, the `manual` adapter is refused unless the host
  gives it a rule: `createManualAdapter({ allow })`. The rule receives the cart
  and the account (`{ cart, account }`) and must return `true`. A rule that
  throws refuses. `/pay` answers `400` with `GATEWAY_NOT_ALLOWED`. The input
  type is `PaymentAdapterOrderRuleInput`, from `/server`;
  `ManualPaymentRuleInput` is the same type.
- `epPlaceOrder(input, { allowManual })` follows the same rule, reads the cart
  before it creates the order, and throws when payment does not succeed.

A host that registers `createManualAdapter()` for paid orders, for example for
offline or invoice payment, must add an `allow` rule. The rule gets the
account the order is placed for; set it with `checkoutContextFromSession`. The example storefront no longer registers
`manual`; its README shows a rule.

**Orders are placed only through the checkout-session routes.** The EP proxy
route does not dispatch `placeOrder`, and `epPlaceOrder` no longer calls it
from the browser; it runs only inside a `withEpSession` scope. EP Checkout Form
Provider pays only through an EP Checkout Session Provider above it. Its
Payment Mode no longer offers `"proxy"`. A page that stored `"proxy"`, or whose
form has no EP Checkout Session Provider above it, shows a setup error that
names EP Checkout Session Provider. Its Payment Gateway and Payment Method
props are hidden and ignored.

**The Elastic Path cart id no longer reaches the browser.** The id alone is
enough to read and change a cart, also a cart linked to an account, so it stays
on the server.

| Removed | Migrate to |
| --- | --- |
| `$ctx.cart.id` and `$ctx.cart.links`, and `id` and `links` on every `Cart` the cart functions, the proxy route and `seedCartFallback` return | Nothing. To show whether there is a cart, bind to `$ctx.cart.itemCount`. Server code reads `session.cart?.id` from `epAuth.api.getSession`. |
| `epCartId` in the `get-session` and account route responses, on `ReleasedEpSession` and in `RELEASED_SESSION_PATHS` | Nothing in the browser. Server code reads `session.cart?.id` from `epAuth.api.getSession`. |
| `ClientCheckoutSession.cartId`, in every checkout session response and in `getMockSession` | Nothing. Checkout takes the cart from the session. |
| `POST /api/ep/ep/cart`, the identity client's `setCart` and `EpSetCartRequest` | Nothing. The route now returns 404. When a cart write through the proxy route creates a cart, the route records it on the session. |

The development-only proxy error text no longer names the cart.

**Search filters with no field set render nothing.** EP Refinement List,
EP Hierarchical Menu and EP Range Filter no longer fall back to `"brand"`,
`"categories.lvl0,categories.lvl1,categories.lvl2"` or
`"price.USD.float_price"` when their field is unset. Those were guesses, and on
a store without the field the whole search answered 400. A filter that relied
on one of them adds nothing to the search after the upgrade, and renders nothing
on a published page. On the Studio canvas it shows "Choose a field" and names
the prop to set (Attribute, or Attributes on EP Hierarchical Menu), in place of
sample values. After you upgrade, open each page with these filters in Studio,
choose a field on every filter that shows the prompt, and publish. If the
filter used the old default and your store has that field, choose it from the
list. A filter with a field set is unchanged.

**Four checkout data names are gone.** EP Checkout Provider, EP Checkout Step
Indicator and EP Payment Elements stay registered but publish no data (see
Deprecated). On an existing page, a binding to one of these names now reads
`undefined`. Rebind it:

| Was | Now |
| --- | --- |
| `$ctx.checkoutData` (EP Checkout Provider) | `$ctx.checkoutSession` under EP Checkout Session Provider. `session` holds `customerInfo`, `shippingAddress`, `billingAddress`, `selectedShippingRateId`, `totals`, `payment` and `order`; `isLoading` and `error` hold the request state. |
| `$ctx.currentStep`, `$ctx.currentStepIndex` (EP Checkout Step Indicator) | No component publishes a step. Show progress from `$ctx.checkoutSession.session`, for example whether `shippingAddress` or `selectedShippingRateId` is set. |
| `$ctx.paymentData` (EP Payment Elements) | `$ctx.stripePaymentData` under EP Stripe Payment: `isReady`, `isProcessing`, `error`. |

### Removed

| Removed | Replacement |
| --- | --- |
| `useEpCommerce().client`, `EpCommerce.client` | None. Call an `ep.*` server function; it resolves the session the server holds. |
| `createCartRoutes`, the `/api/ep/cart/*` routes | `createEpProxyRoutes`, already mounted at `/api/ep/proxy/[fn]`. Delete the cart route file. |
| `useCart`, `useAddItem`, `useUpdateItem`, `useRemoveItem` | `useEpCart` to read. To write, `epAddCartItem`, `epUpdateCartItem` and `epRemoveCartItem` from the root entry. Each returns a promise of the updated cart and rejects on failure. `epAddCartItem` takes `location`, `bundleConfiguration`, `customInputs` and `sku`. |
| `useShopperFetch`, `useShopperContext`, `getShopperContext`, `ShopperOverrides` | None. Nothing in the page carries shopper identity. |
| `X-Shopper-Context`, `resolveCartId`, `parseShopperHeader` | None. The shopper envelope is the only identity input. |
| `buildCartCookieHeader`, `buildClearCartCookieHeader`, the `ep_cart` cookie | The envelope's own cart pointer, which only server code sets. |
| `ShopperContext`'s `basePath` | None. The auth handler is always at `/api/ep`. |
| `basePath` on `createEpAuth` | None. Mount the auth handler at `/api/ep`, the only path the components, `epAuthMiddleware` and the proxy route's cart write call. A config that still passes `basePath` now throws at startup. |
| `basePath` on `createEpIdentityClient` | None. The client always calls `/api/ep`, where the auth handler is. Passing `basePath` now throws. |
| `DEFAULT_EP_BASE_PATH` | `EP_AUTH_BASE_PATH`, the same `"/api/ep"`, renamed because it is the only mount, not a default. |
| `providerProps()` on the session `getSession` returns | None. It carried only the mount path, and nothing read it. Drop any `globalContextsProps` entry that passes it. |
| `cartMergeStrategy` on `createEpAuth` | `sessionCartResolver`. |
| `buildEpCtx(session, { locale, currency })` | `createEpAuth({ resolveLocaleAndCurrency })`. It reads the request's cookies and headers, and `buildEpCtx(session)` takes the result from the session. |
| Elastic Path Provider's `currency` | `createEpAuth({ resolveLocaleAndCurrency })`. The prop is hidden and ignored, and no longer reaches `useEpCommerce().currency`; nothing ever sent it to Elastic Path. |
| `/ep/account/login` with `{ epMemberId, epAccountId, epAccountToken, epAccountExpires }` | `{ username, password }`. The package mints the account credential itself, so there is nothing left to verify. |

Two capabilities go with them, not only their configuration:

- **Previewing a chosen cart in Studio.** EP Shopper Context's Cart ID let a
  designer paste a cart id and see that cart on the canvas. Nothing replaces
  it. A cart id is the whole access boundary on a cart, so any route that
  accepted one from the page would hand that cart to whoever sent it.
- **Overriding the shopper from the page.** `X-Shopper-Context` and EP Shopper
  Context could set the cart, account, locale and currency for a request. The
  session the server holds is now the only source; set locale and currency
  with `createEpAuth`'s `resolveLocaleAndCurrency`.

### Deprecated

These registrations could not be removed, because hostless publishing rejects a
removed component or a removed published prop. All are empty instead.

- **EP Shopper Context** renders its children and nothing else. Its four props
  are hidden and ignored. Remove it from your project; nothing reads it.
- **EP Promo Code Input**'s `Use Server Routes` is hidden and ignored.
- **EP Checkout Provider** is now "EP Checkout Provider (deprecated)". It
  called `/api/checkout/create-order`, `/setup-payment` and `/confirm-payment`,
  which nothing serves, so it could not place an order. It renders its
  children and nothing else, publishes no `checkoutData`, and its ref actions
  are ignored. Every prop but its children slot, `Cart ID` included, is hidden
  and ignored. Build checkout with EP Checkout Session Provider.
- **EP Payment Elements** is now "EP Payment Elements (deprecated)". It took
  its client secret only from EP Checkout Provider, so it could not show a card
  form. It renders its children and nothing else, loads no Stripe.js and
  publishes no `paymentData`. Its other props are hidden and ignored. Use EP
  Stripe Payment.
- **EP Checkout Step Indicator** is now "EP Checkout Step Indicator
  (deprecated)". It read the step from EP Checkout Provider, so it always
  showed the first step. It renders nothing and publishes no `currentStep`;
  its children slot and `Preview State` are hidden and ignored. Show progress from
  `$ctx.checkoutSession`.
- **Elastic Path Checkout Form** is now "Elastic Path Checkout Form
  (deprecated)". It posted to `/checkout/create-order`, which nothing serves,
  so it could not place an order. It renders nothing and makes no request.
  Every prop, `Cart ID` included, is hidden and ignored. Build checkout with
  EP Checkout Session Provider. `On Complete` and `On Error` are advanced, so
  the Interactions section no longer lists them unless an action is already
  wired; they are still in its add menu, and they never fire.
- **EP Checkout Button**'s descriptions no longer call it step-aware: on a
  page it is always the "Checkout" link to `Checkout URL`. `On Complete` never
  fires, and is hidden and advanced like the Checkout Form's handlers. `Preview State` acts only in Studio: a published page shows
  "Checkout" whatever value is saved, and on the canvas `auto` shows
  "Checkout" too, not a step label.
- **EP Checkout Session Provider**'s `createSession` ignores its `cartId`
  argument. The session checks out the shopper's session cart.
- Older inert props and ref actions now say so: the descriptions of EP Add To
  Cart Button's four stock props, EP Product List Provider's `initialSort` and
  `setSort`, EP Search Box's `placeholder`, `autoFocus` and `showClear`, and EP
  Stripe Payment's `submitPayment` lead with "Deprecated — ignored.".

### Added

The Elastic Path Provider's **Add item to cart** global action takes an
optional **Location** after **Quantity**. On a multi-location store, a product
stocked only at named locations was refused with `insufficient_stock`
without it. Existing bindings are unchanged.

`identity.updateMember({ name?, email? })` updates the signed-in account
member's profile. The browser may send only a trimmed, non-empty `name`
and/or `email`. The server writes those fields to the member's user
authentication info with the selected account credential, or the anchor
credential when no account is selected, and returns `{ id }` for the session
member. It does not read the account member again. `EP Account Profile Form
Provider` and `EP Account Profile Field` edit `name` and `email` from
`$ctx.account.accountMember`, send only the fields the shopper changed, and
then use the existing account reload. A zero-organisation member, or a
member with no usable account credential, cannot update. Changing email does
not change the login username.

`accountMember` may now include `name` and `email` in addition to `id`.
`EPAccountProvider` reads them from `identity.member()` during the existing
account reload, and only when that result is for the same member id the
session established. An id-only result (including a zero-organisation member
or a lapsed selection with no usable account credential), a failed member
read, or a mismatched member id leaves `name` and `email` off. That does not
fail the reload, close Account Gates after the reload settles, or stop a
login or registration redirect. `EP Account Field` can display Member name
and Member email. The 0.8.0 release published `accountMember` as an id only.

`EPSearchInfiniteHits` ("EP Search Infinite Hits") gives catalog search the
load more that `EPProductListProvider` already has: the next page of results is
added below the ones shown, not in their place. It wraps react-instantsearch's
`useInfiniteHits`. Cards get the same `currentProduct`, `currentHit` (with
`path`) and `currentProductIndex` as `EPSearchHits`. A button in its Load More
Button slot binds to `$ctx.searchInfiniteHitsData.loadMore`, or the `loadMore`
element action, and hides when `isLastPage`. The page number goes in the URL,
so a shopper who reloads starts on the last page loaded; `loadPrevious`,
`isFirstPage` and a Load Previous Button slot load the pages above it. A click
while a page is still loading is ignored, so a double click cannot skip a page.
The first page renders on the server like the rest of catalog search.

`EPCatalogSearchProvider` renders the first page of results on the server, so
the HTML of a category page contains its products. It uses
`react-instantsearch-nextjs` and needs the Next.js App Router. Elsewhere, such
as on the Pages Router, search runs in the browser as before.

- The server search uses the page request's session, which `createEpAuth`
  makes available, so a storefront adds no route, property or component. The
  storefront's own copy of the package must be this version or later; with an
  older one, catalog search runs in the browser only.
- The browser uses the server's results without searching again. Each provider
  on a page uses its own results. After hydration, searches go through the
  storefront's proxy route as before.
- A query in the URL applies to the server render. Other URL search state, such
  as the page number, applies while the component that owns it is on the page.
- If the server search fails, has no session, or takes longer than 3 seconds,
  the page renders the provider's components with no results and the browser
  searches. It never fails the page, renders the error slot or shows
  EP Search Empty.
- A storefront with a nonce-based Content Security Policy sends the nonce in an
  `x-nonce` request header, or as a `'nonce-…'` source in the request's
  `Content-Security-Policy` header. The results script carries it.

The root entry exports the cart writes `epAddCartItem`, `epUpdateCartItem` and
`epRemoveCartItem`, their input types, and the `Cart` type they resolve with,
so a storefront's own React component can write to the cart. The types `Cart`
is built from, `CartResponse`, `CartMeta`, `CartItem`, `CartItemType` and
`FormattedPrice`, are exported too. In the browser the writes call the
storefront's proxy route, so no Elastic Path credential reaches the page. After
a write, every `useEpCart()` consumer shows the new cart. A rejection is an
`Error` whose `message` is text you can show the shopper and, when there is
one, a stable `code` such as `insufficient_stock`. On the Studio canvas and in
a configure panel a write does not run; it rejects with the code
`design_fn_not_served` and a `message` that names where it ran. They are the
same functions `/server` exports.

`identity.member()` and `POST /ep/account/member` read the signed-in account
member. The body must be empty. The server uses the selected account
credential when it is still valid, otherwise the anchor credential, together
with the implicit shopper token, and returns `{ id, name?, email? }`. `id` is
the session's member id. With no usable account-management credential it
returns `{ id }` and does not call Elastic Path. A rejection is
`account_member_read_failed` with Elastic Path's status and error detail, and
does not sign the shopper out.

`identity.register({ username, password, name, email })` and
`POST /ep/account/register` register an account member. The server sends
Elastic Path a self-signup token request, using the password profile
configured on `createEpAuth` or the store's only one, then follows login's
session, checkout and cart path. The response matches login. Account tokens
stay on the server. An Elastic Path `4xx` other than `401` is
`registration_rejected` with Elastic Path's status and error detail; a `401` or
`5xx` is `account_token_mint_failed`, as for login.

`createEpDesignRoutes` serves Studio design time. It answers the catalog
reads `getProduct`, `getProductList`, `getProductPage` and
`getRelatedProducts`, and `getSearchAttributes`, which lists the fields the
store's catalog search can filter on. It answers under the store's public
credential and refuses every other name. It reads no shopper session, so it works inside Studio's editing
frame, where the browser never sends the shopper envelope. Mount it at
`app/api/ep/design/[fn]/route.ts`. Without it, the canvas shows labelled
`"Sample"` fixtures and the console says once which route is missing.

Login is composable rather than a single form component.
`EPAccountLoginFormProvider` owns the username and password internally and
publishes only `$ctx.accountLoginFormData` (`status`, `error`,
`isSubmitting`). `EPAccountFormField` is the one field component: `name`
is `username` or `password`, and `inputType` is `text`, `email`, or
`password`. A normal Studio button calls the Login Form Provider's
`submit()` ref action. That signs in through the shared identity client
and asks the Account Provider to reload. A normal Studio button calls the
Account Provider's `logout()` ref action, which signs out through the
same client and reloads account state. Both actions no-op in the Plasmic
canvas; the real mutations run at runtime and in interactive preview.
`EPAccountLoginFormProvider` takes an optional `redirectUrl`. After sign-in
and a successful account reload, the page navigates there. A valid
`?redirect=` on the login page overrides it. The value must be a same-site
path starting with a single `/`, and may include a query string or fragment.
A protocol-relative path, a backslash, a scheme, or a control character is
ignored, and an invalid query falls back to a valid `redirectUrl`. If the
reload fails, the shopper stays on the page even when a later automatic
retry succeeds. With neither a valid query nor a valid `redirectUrl`, login
stays on the page as before. Navigation is a no-op in the Studio canvas.

`EPAccountRegistrationFormProvider` owns name, email, username, password, and
confirm-password internally and publishes only
`$ctx.accountRegistrationFormData` (`status`, `error`, `isSubmitting`).
`EPAccountRegistrationField` is the field: `name` is `name`, `email`,
`username`, `password`, or `confirmPassword`. Name, email, and password are
required even when a designer removes that field. Username is required only
when its field is on the form; otherwise the trimmed email is the username.
Confirm password is checked only when its field is on the form, and it is
never sent. A normal Studio button calls the Registration Form Provider's
`submit()` ref action. That registers through the shared identity client and
asks the Account Provider to reload. Optional `redirectUrl` follows the same
same-site rules as login, including `?redirect=`. If the reload fails, the
shopper stays on the page. Submit and navigation no-op in the Studio canvas.

A normal Studio button calls the Account Provider's `selectAccount(accountId)`
ref action to choose an organisation. It no-ops in the Plasmic canvas. At
runtime the already-selected id returns without a request or a reload; any
other id selects through the shared identity client and then reloads account
state. A further call while that selection is still in progress returns
without another request or reload. `$ctx.account.isSelecting` is true only
while that call is in progress, including its immediate reload, and is false
again when the call resolves or rejects. It does not replace `isLoading`.
While the reload after a selection, including its retry, is unsettled,
`$ctx.account.accountRoster` stays the last roster that loaded, so a selector
outside an Account Gate stays on screen. `isLoading` stays true, Account Gates
stay closed, and the previous organisation is not published as the current
one. The initial load, login reload, and logout reload publish an empty roster.

`SessionHandlerContext` takes `accountToken`, the selected account's
credential, next to `shopperAccessToken`. Resolve it in the same
checkout-context factory, from `session.session.account?.token`, and every
checkout-session handler call made as the shopper carries
`EP-Account-Management-Authentication-Token`, as every `ep.*` server function
already does. Calls made with `getClientCredentialsToken` never carry it, and
with no account selected no checkout call does.

`EPProductGrid` inside `EPCatalogSearchProvider` logs a console warning once
per mount instead of rendering an empty listing with no error. The search
provider does not supply the grid's products; the warning says to use
`EPSearchHits` or `EPSearchInfiniteHits` instead. On the Studio canvas the grid
shows the same message in place of sample products. The nearest provider
decides: a grid inside `EPProductListProvider` or `EPRelatedProductsProvider`
never warns, even when that provider sits inside catalog search, and a grid
inside catalog search renders no products even when catalog search sits inside
one of those providers. Nothing substitutes another data source.

### Changed

EP Refinement List `attribute`, EP Hierarchical Menu `attributes` and EP Range
Filter `attribute` are dropdowns in Studio instead of free text. The list comes
from the connected store: on the canvas the components ask the design-time
route for the fields the store's catalog search can filter on. EP Range Filter
lists only numeric fields, and EP Hierarchical Menu lists each `….lvlN` set as
one option. A field keyed by currency, such as `price`, is listed once per
currency (`price.USD.float_price`). A saved value stays selectable even when
the store does not list it. To use a field the list does not show, bind a
value. Without the design-time route the dropdown lists only the saved value.
The canvas asks the route once per page load for all filters. When the route
fails, it asks again a few times with growing delays, then when the canvas
regains focus or a filter is added; every filter already on the canvas gets
the list when an attempt succeeds.

EP Add To Cart Button, EP Cart Item Quantity Control and EP Cart Item Remove
Button show the cart write's rejection message as their `error`. They show
shopper copy for a network failure instead of the browser's own message, and on
the Studio canvas they say that cart changes do not run there. In development,
when the proxy route forwards Elastic Path's reason, they show that reason.

A shopper's cart at sign-in is not merged with the account's. 0.8.0 replaced
the documented `cartMergeStrategy: "merge"` default with keep-the-guest-cart,
and with no guest cart, adopt the account's most recently updated cart. This
release removes the option that described the old default. Configure
`sessionCartResolver` for any other rule.

On a Studio canvas, the catalog components read through the design-time route
at the relative path `/api/ep/design/<fn>`. The path resolves against whatever
document serves the artboard. With an app host configured, that is your
storefront, and EP Product Provider, EP Product List Provider and EP Related
Products Provider show your own catalog. With no app host, it is Studio's
renderer, which has no such route, so the read fails and the canvas shows the
labelled `"Sample"` fixtures. To see real catalog data at design time,
configure an app host and mount `createEpDesignRoutes`. EP Catalog Search
Provider still shows fixtures on the canvas.

On the canvas, EP Product List Provider and EP Related Products Provider show
Loading Content while the read runs and Empty Content when it finds nothing.
EP Related Products Provider shows sample products when no product is chosen,
for example on a product page template. The Preview State values `loading`,
`error`, `empty` and `withData` now apply only on the canvas, on these two
providers and on EP Product Grid. Before this release, `withData` also showed
sample products on a published page.

A newly inserted EP Product Grid's card shows each product's image, name and
price through EP Product Field, in place of static "Product Name" and "$0.00"
text. EP Product Field's **Show** prop gains an **Image** value, which renders
a URL field, such as First image URL, as an image.

A shopper whose account credential lapses now keeps the cart they build after
the lapse. The package clears the session cart once, at the moment it sees the
lapse, so the next cart is the shopper's own guest cart. At their next sign-in,
`sessionCartResolver` receives it as `guestCartId`, and the default keeps it.
Before this release, sign-in discarded that cart and adopted the
organisation's most recently updated cart. The package does not delete the
cart held before the lapse. It stays with the organisation, and the shopper
gets it back when they sign in to that organisation without a newer cart.
A session that an earlier release recorded as lapsed still holds the
organisation's cart. The package clears that cart the first time it reads the
session, so it is never offered to another organisation.
Deselecting an organisation still clears the session cart, and the README now
says so.

Catalog search and search-as-you-type run through the server. EP Catalog
Search Provider and EP Search Autocomplete handed the browser's Elastic Path
client to the search adapter; both now go through `ep.multiSearch`, which
resolves the session the server already holds. The browser sends no request to
Elastic Path, results keep their product images, and the same code runs on the
server and in the browser, so nothing forwards a cookie or names an absolute
origin. Same props, same slots, same data.

The search error slot says what went wrong. It previously blamed the adapter
installation and the store's Catalog Search setting, neither of which was ever
the cause, and it only appeared when the provider could not start at all — a
search that failed mid-flight rendered as no results, which a shopper cannot
tell from a search that matched nothing. It now appears whenever a search
fails, naming an unreachable route, a route older than the components, and an
expired session separately, and the search stays on screen so the shopper can
try again. `$ctx.catalogSearchData.error` carries the same `code` and
`message` for designers who want their own copy. The `Error Content` slot no
longer ships default text; existing projects keep whatever text they have, so
clear that slot to get the new message.

Every catalogue and inventory read now goes through the server instead of the
browser's Elastic Path client. Products, product lists, related products,
stock, store locations and the three bundle reads all resolve through the
session the server already holds, so a shopper's browser makes no request to
Elastic Path and an account member sees their own prices on every surface, not
only the ones that were already server-rendered. Nothing about the components
changes: same props, same slots, same data.

### Fixed

The proxy route answers a refusal the shopper can act on with `409` instead of
`500`: `insufficient_stock`, `invalid_promo_code`, `checkout_in_progress`, and
any other Elastic Path `4xx` except `401` and `403`. The body is unchanged.
Server failures stay `500`.

Account checkout links the order to the selected account. Before, every
checkout placed a guest order with the shopper's name and email, also when a
signed-in account member had an account selected, so the order was missing
from the account's order history. Now, when the checkout session is created
with an account selected, every order it places (card, 3DS, manual, free) is
for that account and the signed-in member, with the name and email from the
checkout form as the order's contact. `epPlaceOrder` does the same for the
account selected in its `withEpSession` scope. Pass the selected account on
`SessionHandlerContext` as `accountToken`, `accountId` and the new
`accountMemberId` (`session.session.memberId`); `buildEpCtx` now fills
`accountMemberId`. The new `checkoutContextFromSession(session)`, from
`/server`, sets all three, with `shopperAccessToken`, `sessionCartId`,
`locale` and `currency`, from one `getSession` result; spread it into the
context. A context with `accountToken` but no `accountId` (the 0.8.0 setup)
used to place a guest order for a signed-in member. It, and one with
`accountId` but no `accountToken`, now places no order: creating a checkout
session and pay return `500` with code `ACCOUNT_NOT_CONFIGURED`, and
`epPlaceOrder` throws. With no account selected, including a signed-in member
who has not chosen one, the order is a guest order as before. When the
shopper's selected account is no longer the one the checkout started with,
pay takes no payment and returns `409` with code `ACCOUNT_CHANGED`, and the
checkout session is dropped. The Manual payment rule sees the account the
order is placed for.

A published page no longer shows sample data. EP Order Totals Breakdown
showed sample totals ($62.00, $5.95, $4.96, $72.91) on a checkout page that
had no checkout session, such as an empty cart or a new visitor with no cart.
Now it shows nothing there and publishes no `orderTotalsData`. The Studio
canvas still shows the samples. Preview State on the cart and checkout
components now acts on the Studio canvas only, as it already did on the
product lists. Before, a saved Preview State also forced its sample data or
state on the published page. This applies to EP Order Totals Breakdown, EP
Checkout Cart Summary, EP Checkout Cart Item List, EP Checkout Cart Field, EP
Customer Info Fields, EP Shipping Address Fields, EP Billing Address Fields,
EP Shipping Method Selector, EP Checkout Shipping Rates, EP Cart Drawer, EP
Cart (Inline), EP Cart Drawer Trigger, EP Cart Field, EP Cart Item Field, EP
Cart Item Image, EP Cart Item List, EP Cart Item Quantity Control, EP Cart
Item Quantity Select, EP Cart Item Quantity Button, EP Cart Item Remove
Button, EP Cart Popover, EP Cart Provider and EP Add To Cart Button.

A refused Place Order no longer stays under the checkout form after the
checkout starts. When a shopper with no cart pressed Place Order, EP Checkout
Form Provider showed the refusal, and the message stayed after the shopper
added an item and the checkout session opened. Now the form removes a
message that came from the missing session when a session opens. Other
messages, such as missing required fields, stay. The form also sends a
shipping address that the shopper typed before the session opened, so the
shipping rates show without another Place Order.

A new visitor with no cart now sees "Your cart is empty" on the checkout page,
the same words as an empty cart, instead of "The shopper has no cart to check
out". The code stays `NO_CART`.

The checkout session routes refuse a customer email that Elastic Path would
refuse, before any payment. Before, `PATCH /api/checkout/sessions/current`
saved an email such as `jane doe@example.com` or `jane@example.com.`, and
Elastic Path refused it at checkout after the card was charged: the shopper
got `409 PAYMENT_NEEDS_REVIEW` and no order. Now that update returns `400`
with code `INVALID_EMAIL` and saves nothing, and `/pay` checks the session's
email again before any payment or order and returns the same `400`. The rule
is Elastic Path's own, measured on its checkout: plus addressing, long
top-level domains, non-ASCII addresses and a `Name <email>` form all pass.
EP Checkout Form Provider shows the message ("Enter a valid email address,
such as name@example.com.") and marks the email field until the shopper edits
it.

The Studio console warning that asks you to mount the design route now shows
for every 404 or 405 that does not come from that route, also when the
response carries its own error code. What the canvas shows is unchanged.

A checkout page with an empty cart no longer shows the last finished
checkout. When EP Checkout Session Provider cannot start a checkout, it
publishes no session, `$ctx.checkoutSession.error` carries the message (an
empty cart reads "Your cart is empty") and the new `errorCode` carries the
code, such as `EMPTY_CART`. Place Order and session updates answer with that
refusal and send nothing. The provider tries again when the cart changes or
the page gets focus. An order placed on the page stays shown: the provider no
longer starts a new checkout after it. EP Stripe Payment shows no card field
for a finished checkout.

The checkout total follows the cart before the shopper pays. A promo code
applied on the checkout page, or a cart change made in another tab, used to
show only after a first Place Order failed with `CART_MISMATCH`, and a 100%
code still asked for a card. Now `GET /checkout/sessions/current` re-reads the
cart of an open session and stores the cart's new totals when its lines
changed. It leaves a session alone while a card check holds its order or a
payment for its cart runs. EP Checkout Session Provider reads the session again
when the shared cart changes and when the page gets focus, so EP Stripe Payment
hides the card field as soon as the total is zero. Place Order now sends the
total the page showed as `shownTotal`, and `/pay` refuses with `409`
`TOTAL_CHANGED` and the current session when that total is not the total it
would charge. A request without `shownTotal` is checked as before.

The checkout's shipping line no longer shows in the cart. After a declined
card or a refused order, the cart page listed "Standard Shipping" as a line
the shopper could change or remove, and counted it. The published `Cart`
leaves that line out of `items` and `itemCount`. Its `meta` and `promotions`
keep Elastic Path's money as it is. The new `withoutShipping.meta` and
`withoutShipping.promotions` leave out what the line adds and what a code took
off it, so they add up to `items`; EP Cart Field, EP Checkout Cart Field, EP
Promo Code Input and EP Order Totals Breakdown read them. Checkout still
charges the shipping line. Session totals count the shipping line at
its discounted price, so the subtotal no longer goes negative under a code
that discounts shipping. A new checkout session leaves out a shipping line
left in the cart until a rate is chosen.

The checkout's shipping line is in the cart only while a payment runs. After
an unfinished checkout, components that read the cart's own totals showed a
total that included shipping next to a list without it. Choosing a rate now
prices the line with the cart and takes it out again; the checkout total keeps
Elastic Path's figures. Reading a session whose cart changed, and pay's `CART_MISMATCH`
answer, price the chosen rate the same way. Pay, resume, abandon and confirm
take the line out when they end, unless a card check waits with no order held,
and creating a session takes out a line an earlier checkout left. A rate
Elastic Path cannot price is no longer kept chosen with a total that leaves it
out: the update answers `502` with code `SHIPPING_NOT_APPLIED` and the session
without the rate.

EP Checkout Session Provider shows the empty state as soon as an open
checkout's cart has nothing to buy: on load, when the cart changes, and when
the page gets focus. It showed the old total and the card field until Place.
EP Stripe Payment takes its amount and its free state from the session the
provider shows.

A form reloaded while a card check is open shows the details the order was
placed with. EP Checkout Form Provider fills its locked fields from the
checkout session.

EP Checkout Form Provider shows why an order could not be placed, such as a
declined card or a failed card check, below the form without a binding. It
also shows why checkout could not start. The new **Show Errors** prop (on by
default) turns this off for a page that shows `$ctx.checkoutFormData.error`
itself.

Abandoning a card check that can still complete no longer leaves a payment
the shopper can complete later. `/abandon-payment` voids the PaymentIntent
through the order held for the challenge (the order's pending transaction is
cancelled, which cancels the PaymentIntent), returns the stock that order
took, and cancels the order before it frees the cart. If the challenge
completes during the void, the checkout ends with `409`
`PAYMENT_ALREADY_TAKEN` and the completed session: the order is placed, or
marked for reconciliation when it can no longer record the payment, and the
cart is not freed for a second charge. EP Stripe Payment treats that answer
as a placed order. Resume still never confirms a payment Stripe has not
reported taken.

Two limits are now documented in the README. The settle-once guard holds
within one server process: route a checkout session's requests to one
instance; across instances a double submit can create a duplicate order, not
a double charge. A card payment taken before Elastic Path finds the stock gone
ends in `PAYMENT_NEEDS_REVIEW` with a reconciliation log. A planned follow-up,
"every charge belongs to an order", removes both.

A card payment whose order total is not the amount charged is no longer
reported as a clean order. When a cart change made outside the storefront
lands between the charge and the order, `/pay` marks the order for
reconciliation (`external_ref`), answers `409` `PAYMENT_NEEDS_REVIEW` with
`reconciliationPending: true` and the completed session, and tells the shopper
both amounts, formatted with the currency's own minor unit (`¥2,799`, not
`27.99 JPY`). The Stripe adapter now reports the PaymentIntent's `amount` in
`gatewayMetadata`.

A cart with a promotion no longer answers `409` `CART_MISMATCH` on the first
pay after a shipping rate is chosen. The cart check counts a promotion by its
id and code, not its amount, which Elastic Path re-prices when the shipping
line is added. Adding or removing a promotion, or changing an item, still
answers `CART_MISMATCH`, and the charge is still checked against the shown
total.

After a paid order the ordered lines always leave the shopper's cart, an
account cart included. Elastic Path will not delete the last cart linked to an
account (400 "Last cart"), and cleanup used to log that and leave the paid
lines in the cart, so the account's next checkout could buy them again.
Cleanup now deletes the cart's items (and unlinks its PaymentIntent) when the
cart itself cannot be deleted, and checks that the cart is empty. If it still
cannot remove them, the completed session records it and the next checkout
session for that cart retries the cleanup first, answering `409` with the new
code `CART_CLEANUP_PENDING` until it succeeds.

A checkout Elastic Path refuses, such as one for more stock than is left,
returns `409` with the new code `CHECKOUT_REJECTED` and Elastic Path's own
reason, takes no payment and leaves the session open for another try. It used
to be a `502` with a generic message. A server error or no answer is still a
`502`. When a card payment was already taken before Elastic Path refused the
checkout, the checkout ends with `409` `PAYMENT_NEEDS_REVIEW`, the shopper is
told the reason, the cart is unlinked from the PaymentIntent, and the payment
is logged for reconciliation. A server error or no answer from that checkout,
after `/pay` or `/resume-payment` took the payment, ends the same way. It used
to return `502` with the session still open and the cart still linked to the
paid PaymentIntent, so the shopper saw a failed payment and could not retry.
The checkout is not retried, because a failed or lost answer can still have
created the order. A failure to mint the token that writes the order's custom
fields no longer stops a paid order from being confirmed.

A cart settles at most one order. `/pay`, `/resume-payment`,
`/abandon-payment` and `handleConfirm` share one per-cart guard. While one of
them runs for a cart, another request from the same checkout session gets the
first one's response, and a request or session update from another checkout
session gets `409` with `CHECKOUT_IN_PROGRESS`. A shopper's cart write
(`epAddCartItem`, `epUpdateCartItem`, `epRemoveCartItem`, `epApplyPromoCode`,
`epRemovePromoCode`, `epApplyCartAdjustment`) made while that cart's payment
runs is refused with code `checkout_in_progress`. The guard holds within one
server process; send a checkout session's requests to one instance when you
run several. The shipping line stays one line at quantity 1: a line that
already matches the selected rate is left alone, and a concurrent write is
folded back.

A card payment that needs a 3DS challenge always ends in exactly the order
the shopper was shown and charged for. When Stripe asks for a challenge,
`/pay` creates the order before it returns the challenge, and returns the
challenge only when that order's total is the total the session showed;
otherwise it answers `409` with `ORDER_TOTAL_CHANGED` and unlinks the
PaymentIntent from the cart. Every `ORDER_TOTAL_CHANGED` (3DS, order-first
and zero-total checkouts) now cancels the unused unpaid order and returns the
session with that order's total, so the next submit pays the total on
screen; before, the session kept the old total and each retry left another
unpaid order. `/resume-payment` confirms that order, so a cart
change made while the challenge is open does not change what is ordered or
stop the order. A resume sent again after the order is paid answers with the
same order; it finishes the cart cleanup only while the cart still links to
that PaymentIntent (an earlier resume stopped before it), so a cart left
holding the paid lines and the PaymentIntent no longer blocks the next
pay. While the challenge is open, `/pay`
and session updates answer `409` with the new code `PAYMENT_ACTION_PENDING`
and the open session, and take no new payment; EP Checkout Session Provider
then continues that challenge with the gateway that started it.
`/abandon-payment`, and a resume whose PaymentIntent was declined, unlink the
PaymentIntent from the cart and drop the held order from the session, so the
next pay starts a new PaymentIntent and a new order. The held order stays
unpaid in Elastic Path.

`/resume-payment` confirms the order only after Stripe reports that the
payment was taken. It reads the PaymentIntent from Stripe with its client
secret plus a publishable key and connected account: from the new
`publishableKey` and `stripeAccount` options of `createStripeAdapter`, or
else from the keys EP Stripe Payment sends with the request. A resume it
cannot check this way returns `409` with the new code
`PAYMENT_STATUS_UNVERIFIED`; one sent before the challenge is passed returns
`409` with `PAYMENT_STILL_REQUIRES_ACTION`; a declined challenge frees the
cart for a new payment. When Stripe reports the payment taken but the order
can no longer record it, the checkout completes (`reconciliationPending:
true`) and the order's `external_ref` records the payment for
reconciliation; when no order was held and the cart changed, the checkout
ends with `409` and the new code `PAYMENT_NEEDS_REVIEW`, places no order for
items that were not paid, and tells the shopper. Either way no route is left
answering in a loop. Neither places an order, and the order can still
take the payment once the challenge is passed. `/abandon-payment` releases a
PaymentIntent only when it reads it as still waiting for the challenge or
failed: one Stripe reports as paid returns `409` with the new code
`PAYMENT_ALREADY_TAKEN` (EP Stripe Payment resumes instead), and one it
cannot read returns `409` `PAYMENT_STATUS_UNVERIFIED` or `502`
`PAYMENT_STATUS_UNKNOWN` and keeps the order. `useCheckoutSession().abandonPayment()`
sends no keys by default, so without server keys it is refused rather than
dropping an order it cannot check. A cart
PaymentIntent adapter can report the state through the new optional
`readPaymentIntentState`; without it, resume refuses.

When a 3DS order completes, the cart keeps the lines the order did not take,
such as an item added while the challenge was open, instead of being
deleted. The lines the order took, the shipping line and promotions are
removed. The whole cart is deleted instead whenever the cart cannot be
unlinked from the PaymentIntent, an order item does not name its cart line,
or removing a line fails, so a paid line is never left in the cart.

A PaymentIntent in `processing` is no longer treated as paid. Elastic Path's
confirm on it records a pending payment and leaves the order unable to take
that PaymentIntent once the money arrives, so `/pay` holds the order and
waits, as for a challenge, and resume confirms it only once Stripe reports
`succeeded`. EP Stripe Payment says the payment is still processing.

EP Checkout Form Provider no longer loses edits made while a card check is
open. While the session's payment waits for a 3DS challenge, the form shows a
locked message (`role="status"`, also `checkoutFormData.isLocked` and
`lockedMessage`), its fields are read-only, and Place order finishes or
cancels the open check without sending the form or asking for a card. A
refused session update now stops the order and shows the reason; before, it
was ignored and the order carried the old details. EP Checkout Session
Provider continues an open challenge without asking the payment component
for a new card.

EP Stripe Payment resumes a checkout only for a PaymentIntent that took the
payment, and abandons it only for one that can no longer take it. When
Stripe.js reports no PaymentIntent state, for example because the challenge
was already passed, the component reads the state with
`retrievePaymentIntent`. When it cannot read the state, it does neither and
shows an error; the next Place order continues the challenge.

Pay charges only the total the session last returned to the browser. When
the cart total differs, pay charges nothing and returns `409` with
`CART_MISMATCH` or the new `TOTAL_CHANGED`; the session in that response, and
in the next `GET`, carries the new total. Before this release the
`CART_MISMATCH` session kept the old total. An order-first gateway (such as
`manual`) takes no payment for an order whose total is not that total, and
drops an unpaid order from an earlier attempt when its total no longer
matches.

Creating a checkout session for, or paying, a cart with nothing to buy (no
lines, or only the shipping line and promotions) returns `409` with
`EMPTY_CART`.

`epPlaceOrder` returns the order status the payment sets, not the status from
before payment: `complete` after a purchase or capture, `processing` after an
authorization, and empty for any other payment. The status comes from the
payment response, because Elastic Path does not let the shopper's token read
the order.

The README warning about `next dev` now names the cart id: the page source of
a dev server holds the session's cart id as well as the shopper's
credentials.

A zero-total checkout completes only when Elastic Path reports the `manual`
payment as complete. `/pay` answers `502` when that payment fails, and `409`
with `ORDER_TOTAL_CHANGED`, without taking payment, when the order it created
has a total. When the checkout response carries no total, `/pay` reads the
order back; when Elastic Path still reports none, `/pay` answers `502`
without taking payment. `epPlaceOrder` throws, without taking payment, when
the checkout response carries no total.

A product card inside EP Product Grid now has a link to its product page.
EP Product Grid publishes `$ctx.currentHit.path`, built exactly as EP Search
Hits builds it, so a card moved from catalog search to EP Product List
Provider or EP Related Products Provider keeps its links. EP Product Grid has
a new **Product Path Prefix** prop, with the same `/product` default as EP
Search Hits'. Set it to your product page route. `currentProduct` itself is
unchanged and has no `path` (ADR-0002).

A cart write no longer resolves with a cart priced differently from the one
`ep.getCart` reads. `epAddCartItem`, `epUpdateCartItem`, `epRemoveCartItem`,
`epApplyPromoCode` and `epRemovePromoCode` read the cart back without the
`Accept-Language` and `X-Moltin-Currency` headers that `ep.getCart` sent for the
shopper's locale and currency. Every cart read now sends the same headers.

A browser call through the proxy route is priced and localised the way the
server render is. The proxy sent neither `Accept-Language` nor
`X-Moltin-Currency`, so a cart a browser write returned could be in a different
currency from the server-rendered cart. `createEpAuth`'s new
`resolveLocaleAndCurrency` option, typed `EpLocaleAndCurrencyResolver`, now
chooses both from the request's cookies and headers on every `getSession`, and
the server render and the proxy route read them from that one session. A
`getSession` call that passes no headers, such as a server render, hands the
resolver the page request's headers from `next/headers`, so a resolver keyed on
`Accept-Language` answers the same on both paths. Outside the App Router there
is no `next/headers`, so pass the request's headers: `getSession` takes a Node
request's `IncomingHttpHeaders`, and the resolver gets header names in lower
case. Derive them from a cookie or
a header every request carries: a proxy request does not carry the page's URL.
The resolver can return the `Accept-Language` value as the browser sent it,
such as `en-GB,en;q=0.9`: the package sends the first valid tag in preference
order, honouring `q` weights and skipping `*`. A locale is sent in its
canonical BCP 47 form (`en-us` becomes `en-US`). A locale with no tag that
`Intl.getCanonicalLocales` accepts, such as `en-a`, or a currency that is not
three letters, is not sent, and the first one logs a `console.warn`; later ones
log nothing.

Checkout totals are in the currency the cart shows. Checkout read the cart
without `Accept-Language` or `X-Moltin-Currency`, so a currency the resolver
chose showed on the cart but not in the checkout totals, and `/pay` compared
the cart against the session in two currencies. `SessionHandlerContext` now
takes `locale` and `currency`; pass the session's, as `shopperAccessToken`
comes from it: `{ ...ctx, locale: session?.locale, currency: session?.currency }`.
A checkout cart read that returns no cart now fails with `EP_ERROR` instead of
hashing an empty cart.

`/server` type declarations are generated from the entry point instead of a
hand-kept list, so an export can no longer ship without its type. `/server`
also resolves under TypeScript's legacy `moduleResolution: node`.

`seedCartFallback` works when `/server` is imported as a native ES module. It
threw `Dynamic require of "swr" is not supported`.

Promo codes work. Neither of the component's two code paths did anything: one
posted to `/api/cart/promo`, a route the package never served, and the other
wrote the discount line from the browser on the public anonymous credential.
EP Promo Code Input now applies and removes codes through
`ep.applyPromoCode` / `ep.removePromoCode`, which resolve the session the
server already holds. The shopper's browser sends a code and nothing else, so
what a discount is worth is never a number the browser states. The applied
code, its discount and the re-priced basket all come back from Elastic Path,
and a code Elastic Path will not honour leaves the basket untouched and says
so. Same props, same slots, same `promoCodeData`. `Use Server Routes` no
longer does anything and is kept only so existing projects load.

EP Stock Provider and EP Multi-Location Stock (deprecated) show each
location's name, such as "East Distribution Centre", instead of its slug,
`east-dc`. Elastic Path's stock response names a location by slug only. After
it reads the stock, `ep.getStock` asks the locations list for those slugs only,
100 slugs to a request, and sets each location's `attributes.name` from the
answer. A Server Query bound to `ep.getStock` gets the names too. A location
the list does not return keeps its slug as its name. EP Stock Provider no
longer reads the locations list itself.

`ep.getLocations` returns every inventory location, not only the first page.
Elastic Path pages the locations list, and the package read one page of the
store's page length. A store with more locations than that lost the rest from
the location selector of EP Multi-Location Stock (deprecated) and from the
location names of EP Cart Item List.

`ep.getLocations` with a `type` returns the locations instead of an empty list.
Elastic Path filters inventory locations by slug only, so it rejected the
`type` filter, and the package returned no locations. An inventory location has
no type, so the package now ignores `type`.

Related products and bundle options show their images. EP Related Products
Provider requested products without their image files, so each product
referenced its main image by id only and got no image URL. EP Bundle Provider
requested the main images but used the main image's file id as the option's
`imageUrl`. Both now request `main_image` and `files`. They use the product's
main image, or its first file when it has none. A product with neither still
has no image, as before. A selected bundle variant with no image of its own
shows its parent option's image, as the product page does for a variant.

The account roster includes every organisation, not only the first 100. An
unpaged roster read asked Elastic Path for one page. It now reads each
following page on the server until the list is complete, and still answers
`{ accounts, total }` with no tokens. A request that sets `limit` or `offset`
still returns that one page.

Overlapping cart writes no longer leave the page on an older cart. When two
`epAddCartItem`, `epUpdateCartItem` or `epRemoveCartItem` calls overlapped,
such as an add and then a quick remove, every `useEpCart()` consumer showed the
cart from the response that arrived last. That could be the older cart, and it
stayed until something else read the cart. Now a consumer never goes back to a
cart older than one it has shown. When the last of the overlapping writes
finishes, the cart is read once from Elastic Path, so the consumers end on the
cart Elastic Path holds. A single write still reads nothing, and each call
still resolves with the cart it produced.

## 0.8.0

### Breaking

There is one EP host allow-list, and `createEpAuth` resolves it: the Elastic
Path-operated defaults, plus the `hostAllowlist` option, plus the
comma-separated `EP_HOST_ALLOWLIST` environment variable (ADR-0006). Your
entries extend the defaults rather than replacing them. Pass it once, to
`createEpAuth`, and delete your own `EP_HOST_ALLOWLIST` parsing.

| Was | Now |
| --- | --- |
| `buildEpCtx(prefetchedData, { session: { accessToken, cartId, account }, hostAllowlist })` | `buildEpCtx(session)`, where `session` is what `epAuth.api.getSession()` returned |
| `extractEpProviderConfig(prefetchedData)` | `extractEpProviderConfig(prefetchedData, { hostAllowlist })` — the list is required |
| `resolveConfig: async () => …` | `resolveConfig: async ({ hostAllowlist }) => …` — pass it to `extractEpProviderConfig` |
| `epPlugin({ clientId, host })` | `epPlugin({ clientId, host, hostAllowlist })` — the list is required |

`buildEpCtx` reads the host and client id from the session, which carries the
ones admitted when it was minted, so the page and the auth routes use the same
Elastic Path host by construction. An empty session yields an empty context,
which the server functions refuse to run with, as before. `buildEpCtx` no
longer throws when the page's bundle has no EP Provider. Code outside
`resolveConfig` that calls `extractEpProviderConfig` passes
`epAuth.config.hostAllowlist`. `locale` and `currency` move to an optional
second argument, and the `BuildEpCtxSessionInput` and `BuildEpCtxAccountInput`
types are removed.

A rejected host now names the `hostAllowlist` option and `EP_HOST_ALLOWLIST`
as the fix for a store whose Elastic Path API is served from a custom domain.
It no longer points at Elastic Path Self Managed Commerce, which never reaches
this package.

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
Preview State. `accountMember` carries an id and nothing else, so no
member profile field (name, email) is in the contract.

### Changed

EP Product Provider tells a product that does not exist from a read that
failed. A failed read used to be swallowed and shown as "not found"; it now
renders **Error Content** at runtime, which was never reachable before. A
reference that names no product still renders **Empty Content**.

On the Studio canvas, a **Product ID or slug** that names no product renders
**Empty Content** instead of the sample product, so a dead reference is visible
while authoring. The sample product still appears when no reference is set and
when the read fails. **Preview State** still overrides both.

A pre-fetched product (the advanced **Product (pre-fetched)** prop) renders at
runtime with no **Product ID or slug** bound. It rendered **Empty Content**.

### Fixed

A product page loads on a store whose products carry slugs. EP Search Hits
links to the product's slug, but `ep.getProduct` and EP Product Provider read
by id only, so every product with a slug showed "Product not found". Both now
take a *product reference* — the slug, or the id when there is none — so a
project that binds the product input to `$ctx.params.slug` works on upgrade
with no rebinding, and a consumer no longer needs its own slug lookup. A slug
naming a child product opens the family with that child preselected, as an id
does. See ADR-0005.

`ep.getProduct` accepts a product reference in its existing `id` argument, and
EP Product Provider's product input is now displayed as **Product ID or slug**.
No component, prop or function is added.

A page whose shopper token could not be minted renders without commerce data
instead of failing with a 500. `getSession` was meant to return an empty
session when the anonymous mint failed, but the mint's error escaped the
endpoint, so the empty session was never reached. `/ep/anonymous` and
`/ep/refresh` now answer 502 with `shopper_token_mint_failed` and log the
cause. An Elastic Path outage, or a Studio host that is not on the EP host
allow-list with no working fallback, reaches this path.

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

A saved shipping address is a quoted address. When the checkout-session update
changes the shipping address it runs the `shippingRateResolver` and persists
the address and the new rates in one write, so the response and the next read
both carry rates. It used to clear the rates and leave fetching new ones to a
second request, and a checkout that lacked one could not select a rate and
failed at `/pay`. A host that called the requote handler from its update route
can remove that call, along with the code that read the session cookie between
the two. A resolver failure does not fail the update: the address is saved,
the rate list is empty, and the failure is logged. The `/shipping` route and
the `calculateShipping` ref action are unchanged and are now the on-demand
requote, for example after the cart changes.

The server logs the package's warnings and errors. The logger read its level
only from the browser's `localStorage`, so on the server every message was
dropped, including a failed order reconciliation or a shipping-line write that
could not authenticate. Set `EP_DEBUG` in the server environment with the
browser's values to change the level; `EP_DEBUG=silent` restores the old
behaviour. The browser stays silent unless `EP_DEBUG` is set there.

The managed-form checkout no longer sends a second request after an address
change. It called the update and then the requote, so a tenant's resolver ran
twice for every address the shopper typed. When the update returns no rates, as
a server on an earlier version does, the form still requotes once, so an app
host whose server is behind its loader bundle keeps offering rates.

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
