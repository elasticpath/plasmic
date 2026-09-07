# ADR-0003: One session — the shopper envelope is the sole input to Elastic Path identity

## Status

Accepted (2026-09-07)

Supersedes the security claims in `README.md`'s Token Lifecycle section and the
CHANGELOG 0.3.0 entry, both of which document the browser-held anonymous token as
a deliberate property. This ADR reverses that direction.

## Context

The package carried two Elastic Path identities. On the server, the shopper's
access token came off the encrypted better-auth session cookie and was published
through `AsyncLocalStorage` by `withEpSession`. In the browser, the Elastic Path
SDK client minted its own anonymous token from the public `clientId` and held it
in the JS heap (`src/client.ts`), which thirteen call sites read as
`commerce.client`.

Identity and transport were welded: server-originated meant session token,
browser-originated meant anonymous token. `/api/ep/proxy` already broke the weld —
a browser-originated call carrying server identity — so the question was never
whether the browser can fetch, only whose identity it fetches under.

Four platform facts settled the shape of the answer.

**The implicit token is public by construction.** Elastic Path offers two grant
types and neither is scopable at mint time. Anyone holding the `client_id` can
mint an implicit token, so withholding it from the browser protects nothing. It is
not read-only: it can write to `/carts` and `/checkout`.

**Shopper identity rides in a second credential.** The account token, minted by
`POST /v2/account-members/tokens`, is what carries account scope and unlocks order
history, account and member records, and addresses. Two tokens on one request —
implicit bearer plus `EP-Account-Management-Authentication-Token` — is applied
upstream across Commerce, so nothing is wired per endpoint.

**The account token is mintable from the browser** with nothing but the public
`client_id` (verified live, 2026-08-27, 201 under an implicit bearer alone).
Elastic Path's own reference storefront does exactly that. So keeping it on the
server is a security-posture judgment, not a forced move.

**A cart id is the entire access boundary on a cart.** `GET /v2/carts/{id}`
succeeds for any known id under any token, an unknown id *creates* rather than
404s, and the 9,972-line carts specification carries one global `bearerAuth` block
with no scopes. Storefront-side custody of the id is not defence in depth on top
of something — it is the whole defence.

## Decision

### One session

The shopper envelope — the encrypted better-auth session cookie — is the sole
input to Elastic Path identity. The browser holds no Elastic Path credential of
any kind, and every browser-originated call carrying identity routes through the
storefront's own origin.

It went this way because the package had already built the expensive half —
HttpOnly custody with server-side verification — so a browser-held account token
would have contradicted the premise the rest of the package rests on; and because
catalog search, the one call site that looked structurally resistant, turned out
to call zero methods on the client and forward it to a single endpoint.

**The identity surface is closed.** Nothing the browser asserts names identity.
`X-Shopper-Context` is deleted rather than gated: it ranked above the HttpOnly
cookie with no dev gate, no origin check and no ownership check, which made it an
override channel rather than the mask it was described as. Gating it on
`NODE_ENV` was rejected — this package's production guard deliberately holds
preview deployments to production standards, so a dev-only override channel is the
exact shape that convention exists to reject.

**There is no per-component token surface switch.** `useServerRoutes` on
`EPPromoCodeInput` becomes an inert registration. A per-component switch only
means something while two identity surfaces coexist; what remains is not a choice
between surfaces but a choice between working and not working.

**"Leaves no persistent client-side trace" is retired, not restated.** It
protected a credential anyone can mint, so it read as a security property without
being one.

### Transport: the isomorphic function, not a route

The canonical unit is the `ep.*` function. A component calls `epGetCart()`; the
function selects its own transport — in-process under `withEpSession` during a
server render, over the storefront's own origin in the browser. No call site ever
names a transport, which is the structural form of "no per-component switch". The
route is that function's browser leg, not a peer a component chooses.

`/api/ep/cart/*` is deleted rather than migrated. It was a second implementation
of operations the `ep.*` functions already implement, and it had diverged: its own
`callEp` with its own headers, a hand-rolled `{items, meta}` response against
ADR-0002, a 422 on every add-to-cart, and an `EPPromoCodeInputServer` posting to
`/api/cart/promo`, an endpoint `createCartRoutes` never served.

**Named when the request needs server-side handling, or when the resource is
id-scoped. Forwarded otherwise.** A forwarded call takes its path and parameters
from the browser and has credentials attached server-side; it is valid only where
Elastic Path scopes access by the presented credential. A named operation names a
server function rather than a URL, so the server supplies the ids that constitute
access control.

The id-scoped column is **carts and orders**. Account addresses, accounts,
account-members and account-memberships were probed cross-account and are
credential-scoped — same path, own token 200, another account's token 404,
symmetric, reads and writes on the identical rule. Catalog products and
multi-search are credential-scoped and named on the server-handling half of the
rule.

**The forwardable set is empty in practice.** Only files and currencies are
candidly forwardable and the package calls neither, so the forwarder's one virtue —
letting the browser choose the path — has no live customer. The rule is stated
because it is the boundary a future resource is measured against, not because
anything uses it today.

### Account identity

The envelope holds an **account member** (the authenticated person) and a
**selected account** (the organisation they act for) as independent slots.
`isAuthenticated` becomes `epMemberId != null`: authentication is the member,
selection is the account.

Elastic Path's Customers service is legacy; Accounts is the only identity surface
this package supports.

**The package owns the login.** A server-side endpoint takes the member's
credentials and calls `POST /v2/account-members/tokens` itself. The
client-supplied-token shape and `verifyEpAccountToken` are deleted — a token the
server minted needs no verification that the caller did not forge it.

**The envelope holds `epMemberId`, `epAccount {id, name, token, expires}`,
`epAnchorToken {token, expires}` and `epLapsedAccount {id, name}`.** 2,333 B as one
cookie, constant in the number of accounts. Holding every account token was
rejected on measurement: better-auth chunks `session_data`, so the ~4 KB
per-cookie ceiling is not the gate — the request head is. Node's default
`http.maxHeaderSize` of 16384 caps a shopper at 16 accounts (7 under nginx's 8 KB
per-header-line default) at ~15 KB of head on every request, and the held list
bought only a round trip: re-minting from an existing account token needs no
credentials, returns a fresh full 86400s window, and returns the whole roster.

`epAccount` and `epAnchorToken` are **mutually exclusive**. The account-header
attach path reads only `epAccount.token`, so an unselected session cannot send an
account header even by mistake — structure where a nullable selection would have
needed discipline. The anchor exists because a member with two or more accounts
and none selected would otherwise hold no Elastic Path credential at all, and
re-minting needs one.

**Auto-select only at exactly one account.** Ambiguity is real only above one, and
a B2B shopper transacting against an account they never chose is the failure this
rule prevents. A member belonging to no accounts logs in successfully —
authenticated, permanently unscoped; failing would tell someone removed from every
organisation that their password is wrong.

**The account token rolls on use** below 3600 s remaining — the implicit token's
fixed, non-configurable lifetime, the one interval the platform already forces on
this package. Anchor tokens are not rolled: an unselected session makes no
account-scoped call to hang a roll on, and a stale anchor correctly means
re-authenticate.

**A lapsed account is surfaced, never silent.** Rolling reaches only sessions
making calls, so an idle shopper crossing 24 hours still lapses against a cart
that outlives the token by six days. On lapse the package drops the token and
moves `{id, name}` into `epLapsedAccount` rather than leaving a past expiry in
place, so the storefront reads a positive fact instead of inferring one from a
timestamp. Reverting silently means prices change under the shopper with no
signal.

**Roster limit: none package-imposed; the platform's page cap of 100 is stated.**
`POST /v2/account-members/tokens` defaults to 25 per page and rejects `page[limit]`
above 100. A flat 100-account ceiling fails hard — a member in 101 accounts could
not transact for the 101st — so the platform's own paging is forwarded. Resolving
an account id to its token pages **server-side**, bounded by `meta.results.total`,
because tokens are never handed to the browser.

**Surfaces are `epAccountRoster` and `epAccountSelect` on the auth plugin, not
`ep.*`.** better-auth generates typed client methods from plugin endpoints, so a
consumer calls `authClient.epAccountSelect(...)` and names no transport. An `ep.*`
name would be designer-visible into a surface this package does not serve.
`epAccountLogin` returns `{ accounts: [{id, name}], total }` — login already holds
the roster, so a chooser renders with no extra call.

**The switch sequence is re-mint, tear down the checkout session, clear the cart
id, write `epAccount` last.** The swap is fallible now that it re-mints, so the
fallible step runs first and a failure changes nothing. The checkout session holds
its own `cartId`, resolved at creation and independent thereafter, so clearing the
envelope's does not reach it — a switch mid-checkout would otherwise leave a live
server-authoritative session pointed at the previous account's cart. Deselect has
no fallible step and demotes `epAccount.token` to `epAnchorToken`.

**The browser reads a path-aware allowlist, five entries**: `epMemberId`,
`epAccount.id`, `epAccount.name`, `epLapsedAccount.id`, `epLapsedAccount.name`.
The token lives inside `epAccount`, so a flat per-key allowlist would ship the
credential by allowlisting one display field. `epAccount.expires` is withheld —
rolling makes it close to meaningless and it is a credential's timestamp. A member
id present with `epAccount` null *is* "authenticated, no account chosen"; no flag
is needed.

### Cart and session lifetimes

**One envelope, one lifetime**, on the cart clock, rolling, with account identity a
revocable layer inside it. Two lifetimes — a guest envelope on the cart clock, an
authenticated envelope on the account-token clock — was rejected because its
invariant cannot be held: the implicit token's 3600 s is fixed and there are no
refresh tokens anywhere in Elastic Path, so any envelope longer than an hour
already contains a dead credential and already has to re-mint.

The cart id is already in the envelope as `session.epCartId`. The `ep_cart` cookie
and `utils/cookies.ts` are dead scaffolding.

Carts expire seven days after **last update**, configurable 1–365 per store.
Verified: reads never move the clock, failed writes never move it, and
`expires_at ≡ updated_at + cart_expiry_days` held exactly. Browsing does not keep
a basket alive.

**Association is discoverability, not access control.** Associating a cart
requires the account token, but reading that cart by id under an unrelated account
token, or under the bare implicit token, both return 200 — and the account
relationship is an appendable **set**, so an account can add itself to a cart
whose id it knows and thereafter see it in its own `GET /v2/carts`. That upgrades a
one-time cart-id leak into durable enumerable access. It creates no capability
that reading by id did not already have. Association must never be presented as a
second layer; custody of the id is still the whole defence. Association does not
touch the expiry clock either — attaching an anonymous cart on login buys the
basket no extra life.

**A `sessionCartResolver` on `createEpAuth` chooses the session cart at an
identity transition** — a login or an account switch. It receives the guest cart
in its own field, the account cart records verbatim under a package-owned wire
type, the selected account id, and a `trigger`. It runs inside `withEpSession`
with credentials, so it can act rather than only choose: a merchant wanting
take-the-higher-quantity semantics needs per-line arithmetic, and no verdict value
carries that without the package growing a merge language it has no business
owning. It returns `{ keep: cartId }` inline — an object rather than a bare id, so
a future `{ defer: true }` is additive.

With no resolver: **keep the guest cart**, or adopt the account cart with the most
recent update when there is no guest cart. Elastic Path's own additive copy was
rejected on its increment semantics — 10 saved plus 2 added becomes 12 and the
merchant blames the platform. The package writes `epCartId` and associates the
winner only, so repeated logins leave no dead baskets, and never deletes the
loser. On failure the login succeeds and the default applies, unlike
`shippingRateResolver`'s 502: a wrong shipping amount costs the merchant money, a
wrong cart choice costs the shopper a re-add, and a merchant bug in a merge hook
must not lock a shopper out of their account. A partial write is the resolver's
own problem — decide first, write last.

A switch never offers the old cart as a candidate. Carrying a basket from account
A to account B is exactly the leak above, and the lines would carry A's
account-scoped prices into B's checkout.

`cartMergeStrategy` is deleted. It was declared, defaulted, frozen into `config`,
README-documented and read by nothing — and doubly dead, since the package never
associated carts, so there was never a second cart to merge.

### Design time

Design time works today because the hook path goes straight to Elastic Path with a
public token and never touches a cookie. Under one session it would inherit the
proxy's cookie dependency, and better-auth's `SameSite=Lax` default means a
consumer self-hosting their app host on their own registrable domain breaks
cross-site. **Design-time parity is a ship requirement**, so this gets a separate
route rather than a fallback branch inside the proxy: two routes with one rule
each, and a route that never touches the session cannot leak session-scoped data.

**A session-free design-time catalog route**, `app/api/ep/design/[fn]` via
`createEpDesignRoutes(epAuth)`, mounted in production with `Access-Control-Allow-Origin: *`,
no credentials and no origin gate. `trustedOrigins` stays shopper-only, so design
time never adds an entry to it, and a gate on a credential-free public-data route
buys nothing.

**Unauthenticated, and staying that way.** It serves what the public `client_id`
already unlocks. What it buys is not "designers see something" — the canvas
already has an automatic **mock floor** — but **per-store schema**: extension
slugs, hierarchy node ids and variation names exist only in the customer's store,
and the code already concedes it by mocking `MOCK_EXTENSION_TEMPLATES`.

**Four declared names**: `getProduct`, `getProductList`, `getProductPage`,
`getRelatedProducts`. By declaration, not subtraction — subtraction means the next
session-scoped function added to `FN_DISPATCH` becomes anonymously readable by
omission. The session proxy can forward because the shopper's credential is the
boundary; this route cannot, because its implicit token draws no boundary and can
write to `/carts` and `/checkout`. An open forwarder on an unauthenticated
production route is an open proxy with a write surface on the customer's own
domain.

**Detection is per realm.** In the canvas artboard,
`usePlasmicCanvasContext` bridged to a module-level flag — authoritative where a
raw `#canvas=true` hash read is spoofable. In the app-host document, where
Studio's data-query Configure panel resolves and executes registered `ep.*`
bodies, `window.__CanvasPkgs`, read **per call and never memoised at module load**
because Studio injects it asynchronously. `__CanvasPkgs` was chosen because it is
load-bearing — two wab call sites read it, so it cannot be dropped silently —
unlike `#plasmic-studio-script` and `window.__PLASMIC_ARTBOARD`, which are each
written and never read. It is a wab internal with no contract, and it is
fork-owned, unlike `@plasmicapp/host`, which consumers take from upstream npm.

**No code path retries a proxy failure against the design route.** That clause is
what keeps the closed identity surface true in the transport and not just on
paper; a `no_session` fallback would silently serve unscoped prices to a
genuinely logged-in shopper with a just-expired envelope.

`sameSite: "none"` was rejected as the fix for the Configure panel: it moves CSRF
defence entirely onto the origin gate, weakening the sole-input decision above; it
renders the *developer's own* cart and account prices in the panel; and it
requires `Secure`, breaking plain-http local dev. The defect is invisible in every
environment we test, because same-site excludes ports.

**Off-allowlist names — `getCart` and the cart mutations — throw in the Configure
panel and soft-fail in the artboard.** The rule is *soft-fail where a mock floor
exists, throw where none does*. In the canvas a null is what lets the mock floor
render `"Sample"` fixtures; nothing sits behind the panel, so the same null is
indistinguishable from a wrong argument binding on the one surface a designer
opens specifically to check a binding.

**`registerAll` must never register `ep.*` functions.** `hostLessRegistry` is
spread second in Studio and wins on an id collision, so one import would move
every consumer's Configure panel into the hostless `about:blank` realm and its
`<base href>`-rewritten URLs, with the canvas unaffected and no error anywhere.
The `./server` subpath split half-enforces this; the other half —
`canvas-packages/src/commerce-elastic-path.ts` growing a `./server` import — cannot
be seen from inside the package and is held by this constraint plus a comment in
that entry file.

Designing as a particular shopper is not the target. There is no impersonation
grant to build it on, it renders a real shopper's order history inside Studio, and
it cannot show a designer the variations no real account currently exhibits.

### Catalog search

**A named `epMultiSearch` plus a shim search client** — one more entry in
`FN_DISPATCH`, no new route, nothing extra for a consumer to mount. The security
case for naming it does not exist: the shopper's resolved catalog *is* the whole
collection, chosen server-side by index selection before any filter runs, so no
filter expression has anywhere to go, and a forwarder here would be safe. It went
named on cost — one endpoint and one caller make a forwarder's path-choosing
freedom worthless — and on isomorphism: a forwarder is browser-to-server only, so
a server render would post to its own route with an absolute origin and
hand-forwarded cookies.

**The response passes back verbatim under a package-owned wire type.** The SDK's
`MultiSearchResponse` omits `included` while the adapter reads it off the top
level, so an SDK-typed function silently drops every hit's `main_image`.

**No per-request `searches` ceiling and no server-side cache.** No defensible
ceiling exists — our call sites send one, but InstantSearch legitimately batches
per `<Index>`, so any cap low enough to matter trips a valid page, and a cap
without a rate limit only changes the arithmetic. A cache keyed on query text
serves one account's prices to another under account-scoped pricing, and keying on
the account token leaves no hit rate.

**Search keeps its error slot** rather than soft-failing empty: an always-empty
search box is indistinguishable from a working one. The copy names the unmounted
route rather than blaming the adapter install.

**Server-rendered by `<InstantSearchNext>`, swapped in unconditionally.**
`getServerState` is unreachable in the App Router — Next 15.5 hard-fails
`next build` on any `react-dom/server` import from a Server Component or Route
Handler — and no `initialPage`-style seed prop is possible, because
`initialResults` is context-delivered only.

It server-renders the **unrefined default first page**. `<Configure>` flows;
`initialUiState` and routing-derived URL state do not, and `useSearchParams()` is
empty in the server pass, so skipping conditionally is foreclosed rather than
rejected. Accepted, because the SEO case rides `baseFilter` → `<Configure filters>`
and renders correctly; deep-linked search and refinement URLs self-correct after
hydration and are conventionally `noindex`. A **Configure-scoped listing** is
therefore the shape the recommendation turns on, and a dev warning fires on server
pass with `enableUrlSync` and an empty `baseFilter` — imperfect by construction,
since it cannot tell a category page from a search page, so the copy asks rather
than asserts.

**A failed server search falls through to client rendering and must never 500.**
This narrows the error-slot rule to the client side deliberately: a shopper always
sees the hydrated render, whereas the alternative is a crawler indexing "Catalog
Search is not available" for a category page.

**`react-instantsearch-nextjs` stays in `dependencies`** at `^1.4.x`. Hostless
bundles resolve dependencies at bundle time against `loader-bundle-env` and the
externals list is hardcoded server-side, so an unguarded bare `require` of an
absent package fails the whole loader bundle for every project using it. Its
unguarded `require("next/navigation")` and `require("next/headers")` resolve on
neither the loader nor the canvas build, so this needs fork patches: both
specifiers in `deriveExternals` behind a **new loader-version gate**, a browser
`next/headers` stub in `loader-nextjs`, and `canvas-packages` externals.
Restricting SSR to app-host consumers was rejected — it splits the recommendation
by deployment mode, which is worse than the page-type split. **No upstream pull
request**; these are fork patches with customization-registry entries.

**Catalog search is the recommended listing path for everything**, SSR and
SEO-critical pages included. `EPProductListProvider` is the supported on-ramp for
stores without a search index. The discriminator is store capability, not page
type — which retires the existing guidance, all of which splits the paths on
*sort*. Both repeaters DataProvide the same `currentProduct`, so card layouts
survive the switch; three components swap. Neither path carries a deprecation
signal, and neither can be removed regardless.

### Release shape and the append-only rule

The publish-hostless guard enforces three classes, and distinguishing them is the
constraint every future removal hits:

- **Internal modules** — delete freely. Nothing enforces them.
- **Registered components, global contexts, slots and props** — append-only, hard
  asserts in the publish step. 0.5.0 hit this twice: removing `EPMultiLocationStock`
  and removing `EPProductListProvider`'s `initialSort` prop each made the package
  unpublishable as a hostless bundle, and the repair path exists only in Studio's
  client. It fails with zero consumers, so customer count is irrelevant to it.
- **Registered custom functions and code libraries** — append-only **by our
  policy**, not by enforcement. The equivalent asserts are commented out upstream
  since December 2024, and `params` is in the update-allowed set. Removal being
  *permitted* there makes it worse rather than better: the failure moves out of
  the publish step, where 0.5.0 caught it loudly, and into a designer's project as
  a silently broken data query that nothing checks.

An **inert registration** is a registered surface kept alive solely because
hostless publishing forbids its removal — hidden or marked deprecated, doing
nothing. The package has three today and this work adds two: EP Shopper Context
and `useServerRoutes`.

Deprecation house style: components and global contexts take `"X (deprecated)"` in
`displayName`, copying upstream's only convention; props keep this package's own —
`hidden: () => true` plus a description leading `"Deprecated — ignored."` —
because upstream's alternative leaves a live-sounding description on a dead prop.
`hideFromContentCreators` **hides nothing from designers**; it feeds
content-editor mode only, so its presence must never be read as "designers cannot
reach this".

**Expand-then-contract.** Every additive and internal change ships in ordinary
non-breaking minors; the breaking set lands together in one release, last. Slicing
by feature area would put several breaks in flight at once against a package where
a bad break cannot be published at all — 0.5.0 cost two recovery releases for a
much smaller mistake. Concentrating it makes the risky release the small one,
arriving after the additive work is proven on the dev host and the example app.
Every intermediate version must be independently publishable as a hostless bundle,
with its consumer lockfiles bumped in the same commit, because publish-hostless
installs with `--frozen-lockfile`.

**Staying in 0.x.** 1.0.0 waits for the architecture this ADR locks to be fully
built and for a first external customer.

## Consequences

- Every catalog read gains a hop through the storefront's own origin. Accepted:
  the alternative is an account token in the browser.
- `src/client.ts` has no consumers and is deleted, taking the memory storage
  adapter, the `configureClient` global-singleton workaround and the
  `EP-Inventories-Multi-Location` request interceptor with it. That header needs a
  home server-side before the call sites move, or converging silently changes
  inventory behaviour.
- EP Shopper Context loses every reader and becomes a children pass-through with
  all four registered props inert. The cart-id preview override dies with no
  replacement: reviving it means handing a cart id to an unauthenticated route,
  and the id is the capability.
- Design-time catalog reads become **relative**, so they resolve against whatever
  document serves the artboard. With an app host configured the designer gets
  better data than today; with no app host they resolve at the renderer, 404, and
  drop to the labelled `"Sample"` mock floor.
- Catalog search shows `"Sample"` fixtures at design time permanently — the canvas
  never mounts the provider's inner component — which is the one axis where the
  on-ramp path is better. Documented as a limitation, not closed here.
- Designers get no account-scoped design time. There are zero account-scoped
  components in this package, so there is no parity to preserve; the gated sibling
  route is deliberately not built. The effort that adds those components inherits
  two facts: a route that can name an account cannot be unauthenticated, and there
  is no impersonation grant.
- Defensive parenthesising of `filter_by` before forwarding is **defence in
  depth, not a fix**. The platform composes search-profile filters safely —
  `(profile) && (request)`, request wrapped, verified live against a provisioned
  narrowing profile — so there is no open hole and this ADR must not present one.
  Safety rests on the implementation, which the specification does not promise, so
  the one-line parenthesiser and a regression test stay; the full balance-checker
  does not get built unless a regression appears.
- An account cart list can hold a cart another party planted, because any account
  can add itself to a cart whose id it knows. Adopting the most recently updated
  account cart therefore adopts that. Severity is low — the shopper sees the lines
  before checkout — and it is one more reason the id stays in server custody.
- A store with catalog rules bound to an account is still needed to demonstrate
  account-scoped pricing end-to-end. The integration store exercises none, so the
  account header's effect is untested rather than shown.
- Route-wide rate limiting is unaddressed and now covers two routes: the session
  proxy and the unauthenticated design-time catalog route on every consumer's
  production origin. The amplification the dropped `searches` ceiling was meant to
  bound is real.
- A path-traversal authorization bypass on Orders
  (`GET /v2/carts/..%2Forders` → 200, store-wide order PII under a bare implicit
  token) was found incidentally. It is a gateway-side Elastic Path platform flaw
  that no storefront token-architecture change closes, and it is out of scope
  here.
