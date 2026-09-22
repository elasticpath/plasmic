# Elastic Path Commerce Components for Plasmic

The headless commerce building blocks published as
`@elasticpath/plasmic-ep-commerce-elastic-path`: Plasmic code components,
global contexts, and `ep.*` server functions that let designers compose
Elastic Path Composable Commerce storefronts in Plasmic Studio while the
server owns auth, data, and money.

## Language

### Component model

**Provider**:
A code component that publishes data to its descendants via Plasmic's
`DataProvider` (`$ctx.*`) and exposes mutations as refActions. Providers own
behaviour and data; they render no chrome of their own.
_Avoid_: wrapper, container

**refAction**:
A mutation exposed by a provider that a designer wires to an interaction in
Plasmic Studio (e.g. `setValue`, `placeOrder`, `goToPage`).
_Avoid_: callback, handler, action prop

**Headless styling contract**:
The rule that components ship behaviour, not appearance: `className` lands on
the visible interactive element, no inline appearance styles, structural CSS
only via zero-specificity `:where()` selectors, and the editor renders the
same DOM as the runtime.
_Avoid_: unstyled components, default theme

**Server Query**:
A Studio-authored server-side data binding that invokes a registered `ep.*`
function during SSR and surfaces the result under `$q.*`. The primary
data-binding path; client-side provider fetching is the alternative. Not the
only thing that renders on the server — see **search server pass**.
_Avoid_: data query, `$queries` (that is the client data-queries namespace)

**Search server pass**:
The client-component server render in which `<InstantSearchNext>` executes the
search and emits `initialResults` into the HTML. Distinct from a **Server
Query**: no `ep.*` binding, no `$q.*`. It applies `<Configure>` but not
`initialUiState` or routing state, so it renders the unrefined default first
page.

**Configure-scoped listing**:
A catalog-search listing whose scope rides `<Configure filters>` (the
`baseFilter` prop) rather than URL refinements, and which therefore
server-renders correctly. The shape both the SEO recommendation and the
`baseFilter` dev warning turn on.

**EP session scope**:
The per-request `AsyncLocalStorage` scope established by `withEpSession`
inside which every `ep.*` function reads auth and cart context. Auth is never
a function argument. Outside the scope, functions fail soft to `null`/`[]` —
except in Studio's data-query Configure panel, which has no **mock floor**
behind it and throws instead (ADR-0003).

### Checkout

**Managed-form checkout**:
The self-wiring, arbitrary-schema, single-page checkout form family:
`EPCheckoutFormProvider` plus `EPFormField`/`EPSelectField`/
`EPConsentCheckbox`/`EPPlaceOrderButton`. The recommended default. Reserved
field names map to the order; other fields persist as custom attributes.
_Avoid_: simple checkout, form provider checkout

**Controlled-field checkout**:
The refAction-orchestrated, fixed-schema checkout family:
`EPCustomerInfoFields`/`EPShippingAddressFields`/`EPBillingAddressFields`
with the 4-step `EPCheckoutProvider`. The breakout for multi-step flows,
bring-your-own inputs, address suggestions, and shipping-rate selection.
Either/or per page with managed-form, never mixed.
_Avoid_: composable checkout (ambiguous — both families are composable)

**Checkout session**:
The server-authoritative checkout state managed by
`EPCheckoutSessionProvider` and the `/api/…/checkout/sessions*` routes. Holds
orchestration and selection state only — never an authoritative amount. The
managed form auto-detects it (`paymentMode: "auto"`) and submits through it.

### Session & security

**Production guard**:
A check that makes the package refuse to construct or serve when
production-grade configuration is missing (real secrets, explicit origin
allowlists). Keyed on `NODE_ENV === "production"` with no opt-out flag;
preview deployments are deliberately held to production standards.
_Avoid_: strict mode, safe mode

**Dev sentinel**:
A known, public placeholder secret shipped in example code. Fine in
development (with a warning); rejected outright by the production guard,
because a copied sentinel in production makes session cookies forgeable.
_Avoid_: default secret, dummy secret

**Trusted origin**:
An origin permitted to act as the shopper from the browser. One list
(better-auth's `trustedOrigins`) feeds every origin check — auth endpoints,
internal synthetic requests, and the proxy's CORS reflection (ADR-0001).
There is no separate proxy allowlist.
_Avoid_: allowedOrigins, CORS whitelist

**Origin gate**:
The CSRF layer on state-changing routes: safe methods pass; unsafe methods
pass on `Sec-Fetch-Site: same-origin`/`none`, are checked against trusted
origins when cross-site, and pass when no browser origin signal exists
(non-browser client). Same semantics as Go's `CrossOriginProtection`;
layered with `SameSite=Lax` cookies, not CSRF tokens.
_Avoid_: CORS check (CORS is response readability; the gate is request rejection)

### Identity & transport (ADR-0003)

ADR-0003 decides this vocabulary. Entries marked *(not yet built)* name a
decided concept the code does not carry yet.

**Token surface**:
Where an Elastic Path credential lives, and therefore from what origin a call
carrying identity is made. Exactly one value: the server. Named despite having
one value, because it is what makes "no per-component switch" a statable rule
rather than a preference.
_Avoid_: token strategy, auth mode

**Shopper envelope**:
The encrypted better-auth session cookie carrying every Elastic Path
credential and the cart pointer; the sole input to Elastic Path identity on
any request.
_Avoid_: session cookie — that ambiguity is how `ep_cart`,
`X-Shopper-Context` and `utils/cookies.ts` accumulated as parallel identity
channels unnoticed

**Account member**:
The authenticated person, holding a password profile in Elastic Path's
Accounts service. Distinct from the account they act for.
_Avoid_: customer (a legacy Elastic Path service this package does not
support), user (better-auth's record)

**Selected account**:
The organisation the account member is currently acting for, chosen from the
accounts their membership grants. Determines account scope on every Elastic
Path call. Auto-selected only when the member belongs to exactly one.

**Account roster**:
The member's accounts as `{id, name}`, derived from the token response,
paginated, never carrying tokens to the browser. Distinct from the token list
precisely because it is what survives the server stripping credentials off it.
Sign-in returns it, and `epAccountRoster` reads it again later.
_Avoid_: account list

**Anchor token**:
An account token held only to keep re-minting possible while no account is
selected. Never sent; not evidence of a selection. Mutually exclusive with the
selected account's token, so an unselected session cannot send an account
header. Signing in as a member of several accounts mints one, and deselecting
demotes the selected account's token into it.
_Avoid_: default account token

**Account switch**:
Changing the selected account without re-authenticating. Re-mints, tears down
any checkout session, clears the cart id, writes the new account last — the
fallible step first.

**Roll on use**:
Re-minting the selected account's credential on a request that finds it with
under an hour left — the implicit token's own lifetime, not a number chosen
here. Needs no password, because re-minting runs off the credential the
envelope already holds. Anchor tokens are not rolled: an unselected session
makes no account-scoped call to hang a roll on.

**Lapsed account**:
The envelope is alive and still holds the cart, but the account token has
expired and cannot be rolled; scope falls back to anonymous until the shopper
re-authenticates. Surfaced as a positive fact, never inferred from a
timestamp.
_Avoid_: logged out (the shopper is not — envelope and basket persist),
expired session (precisely what this is not)

**Identity transition**:
The moment the envelope's Elastic Path identity changes — a login or an
account switch. The only moment the **session cart** is reselected.

**Session cart**:
The one Elastic Path cart the shopper envelope points at, held as `epCartId`.
A shopper has exactly one at a time.
_Avoid_: active cart, current cart, basket

**Session cart resolver** *(not yet built)*:
The config-time `sessionCartResolver` hook on `createEpAuth` that chooses the
session cart at an identity transition. Absent, the package keeps the guest
cart, or adopts the account cart with the most recent update when there is no
guest cart.

**Forwarded call**:
A browser-originated request whose path and parameters come from the browser
and whose credentials are attached server-side. Valid only against resources
Elastic Path scopes by the credential. No live call site — the rule exists as
the boundary a future resource is measured against.
_Avoid_: proxy (the word implies a forwarder is all there is)

**Named operation**:
A browser-originated call that names a server function rather than a URL, so
the server supplies the ids that constitute access control. Required wherever
the request needs server-side handling or the resource is id-scoped.

**Id-scoped resource**:
One where a caller-supplied id *is* the access boundary and no credential
narrows it. Carts and orders, confirmed live; the account family is
credential-scoped.
_Avoid_: unauthenticated (the call is authenticated; the resource is just not
scoped by that authentication)

### Design time & registration (ADR-0003, ADR-0004)

**Design-time catalog route** *(not yet built)*:
The session-free route serving the store's default catalog to Studio under an
anonymous implicit token, with four declared names and no cart or order
access. Distinct from the shopper proxy, which carries session identity.

**Mock floor**:
The automatic canvas fallback to `"Sample"` fixtures beneath any design-time
read. Existing, previously undocumented behaviour that ADR-0003 depends on:
where a mock floor exists a missing read soft-fails, where none exists it
throws.

**Inert registration**:
A registered surface kept alive solely because hostless publishing forbids its
removal — hidden or marked deprecated, doing nothing. The body is emptied, not
just the behaviour: a husk that still threads props into a context nobody reads
looks live to the next reader. Which surfaces are append-only, and the
deprecation house style, are ADR-0004.

### Money trust (ADR-0013, iso-storefront)

**Discretionary mutation**:
A cart write for a cost the shopper elects for themselves (e.g. opt-in gift
wrap). Shopper-auth is acceptable because manipulation is self-defeating.
`ep.applyCartAdjustment` is the discretionary member only.

**Authoritative money**:
A value the merchant's rules determine (mandatory fees, shipping, tax,
discounts). The client may only trigger and select — never supply the value.
Server-computed with the `client_credentials` secret and re-asserted by
`handlePay` at checkout, because the cart is shopper-mutable and no cart line
is self-guaranteeing.
_Avoid_: trusted cart line, server-priced line item

**Shipping rate resolver**:
The config-time `shippingRateResolver` hook on `SessionHandlerContext` that
sources `availableShippingRates` server-side. The only correct path for real
shipping charges — never `applyCartAdjustment` with `kind: "shipping"`.

### Product & cart shapes

**Formatted price**:
Elastic Path's own price leaf — integer amount in the currency's lowest
denomination, ISO currency code, the display-ready `formatted` string, and
the decimal `float_price`. Elastic Path omits the decimal on cart and line
prices; this package fills it in, derived from that currency's own exponent
and never a fixed hundredth, so zero-decimal currencies (JPY) are correct.
Every price the package publishes carries all four. `formatted` is the
preferred read — it is what Commerce Manager was configured to produce.
Elastic Path's *display price* is the block holding the with-tax and
without-tax pair, not the leaf itself.
_Avoid_: Money, ProductPrice, price value, cents

**Base product**:
A product a shopper cannot buy. It exists to carry the variations and the
matrix that select a purchasable child, and in PXM it carries no price of its
own — the price is inherited from a child. Elastic Path's own name for the
parent of a variation family.
_Avoid_: parent product, variation parent, master product

**Child product**:
A purchasable product selected by one combination of variation options. Owns
its own SKU, price and stock. A cart line always references a child product,
never the base product it came from.
_Avoid_: variant, SKU, `children` (that is Plasmic's slot word)

**Variation**:
One option group a shopper chooses from to select a child product — Colour,
Size — together with the options in it. The package's established word: the
variation picker, its fields, and the form keys all use it. Carries exactly
what Elastic Path models — identity, name, description and the merchandiser's
sort order — and nothing more; there is no colour on a variation option, so
swatches are a Studio-side mapping, not commerce data.
_Avoid_: product option, option group, attribute, hexColors

**Price from**:
The lowest price among a base product's children, published on the base
product only. Elastic Path gives a base product no price of its own, so this
is the package's own value, named for what it is rather than synthesized into
Elastic Path's price block. It is also the correct storefront semantics for a
variation family — "From £49.99".
_Avoid_: parent price, inherited price, starting price
