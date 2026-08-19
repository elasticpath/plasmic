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
data-binding path; client-side provider fetching is the alternative.
_Avoid_: data query, `$queries` (that is the client data-queries namespace)

**EP session scope**:
The per-request `AsyncLocalStorage` scope established by `withEpSession`
inside which every `ep.*` function reads auth and cart context. Auth is never
a function argument. Outside the scope, functions fail soft to `null`/`[]`.

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
