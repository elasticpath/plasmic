# ADR-0003: One session — the shopper envelope is the sole input to Elastic Path identity

## Status

Accepted (2026-09-07)

Supersedes the security claims in `README.md`'s Token Lifecycle section and the
CHANGELOG 0.3.0 entry, both of which document the browser-held anonymous token as
a deliberate property. This ADR reverses that direction.

The decision was reached on the #486 map, which holds the reasoning ticket by
ticket. The migration is sized into issues on the *ADR-0003 token architecture*
milestone, which holds the mechanics. This ADR records the decisions and the
platform facts that justify them — deliberately not the field shapes, orderings
or acceptance criteria those issues carry.

## Context

The package carried two Elastic Path identities. On the server, the shopper's
access token came off the encrypted better-auth session cookie and was published
through `AsyncLocalStorage` by `withEpSession`. In the browser, the Elastic Path
SDK client minted its own anonymous token from the public `clientId`, which
thirteen call sites read as `commerce.client`.

Identity and transport were welded: server-originated meant session token,
browser-originated meant anonymous token. `/api/ep/proxy` already broke the weld,
so the question was never whether the browser can fetch, only whose identity it
fetches under.

Four platform facts settled the shape of the answer. Each was verified live
against the integration store rather than read from documentation, because the
two diverge here.

- **The implicit token is public by construction.** Two grant types exist and
  neither is scopable at mint time, so anyone holding the `client_id` can mint
  one and withholding it from the browser protects nothing. It is not read-only:
  it can write to `/carts` and `/checkout`.
- **Shopper identity rides in a second credential**, the account token, which
  carries account scope and unlocks order history, account and member records,
  and addresses. Two tokens on one request is applied upstream across Commerce,
  so nothing is wired per endpoint.
- **The account token is mintable from the browser** with nothing but the public
  `client_id`. Elastic Path's own reference storefront does exactly that, so
  keeping it server-side is a judgment, not a forced move.
- **A cart id is the entire access boundary on a cart.** `GET /v2/carts/{id}`
  succeeds for any known id under any token, an unknown id *creates* rather than
  404s, and the carts specification carries one global `bearerAuth` block with no
  scopes.

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
preview deployments to production standards, so a dev-only override channel is
the exact shape that convention exists to reject.

**There is no per-component token surface switch.** A per-component switch only
means something while two identity surfaces coexist; what remains is not a choice
between surfaces but a choice between working and not working.

**"Leaves no persistent client-side trace" is retired, not restated.** It
protected a credential anyone can mint, so it read as a security property without
being one.

### Transport

The canonical unit is the isomorphic `ep.*` function, not a route. A component
calls `epGetCart()`; the function selects its own transport. No call site ever
names one, which is the structural form of "no per-component switch". The
`/api/ep/cart/*` routes are a second implementation of the same operations and
are deleted rather than migrated.

**Named when the request needs server-side handling, or when the resource is
id-scoped. Forwarded otherwise.** A forwarded call takes its path and parameters
from the browser and has credentials attached server-side; it is valid only where
Elastic Path scopes access by the presented credential. A named operation names a
server function rather than a URL, so the server supplies the ids that constitute
access control.

**The id-scoped column is carts and orders.** The account family — accounts,
account-members, account-memberships, account-addresses — was probed
cross-account and is credential-scoped: same path, own token 200, another
account's token 404, symmetric, reads and writes on the identical rule. Catalog
reads and multi-search are credential-scoped and named on the server-handling
half of the rule.

**The forwardable set is empty in practice.** Only files and currencies are
candidly forwardable and the package calls neither. The rule is recorded because
it is the boundary a future resource is measured against, not because anything
uses it today.

### Account identity

The envelope holds an **account member** (the authenticated person) and a
**selected account** (the organisation they act for) as independent slots.
Authentication is the member; selection is the account. Elastic Path's Customers
service is legacy; Accounts is the only identity surface this package supports.

**The package owns the login.** A server-side endpoint takes the member's
credentials and mints the account token itself, so the client-supplied-token
shape is deleted — a token the server minted needs no verification that the
caller did not forge it.

**The envelope carries the selected account's token and, when none is selected,
one anchor token** — never the whole token list. The gate is not the ~4 KB cookie
ceiling, because better-auth chunks the session cookie; it is the request head.
Holding every token caps a shopper at 16 accounts against Node's default
`maxHeaderSize` (7 under nginx's per-header-line default) and spends ~15 KB of
head on every request. It buys only a round trip: re-minting from an existing
account token needs no credentials and returns the whole roster. The anchor
exists because a member with several accounts and none selected would otherwise
hold no Elastic Path credential at all, and re-minting needs one. The two slots
are mutually exclusive, so an unselected session cannot send an account header
even by mistake — structure where a nullable selection would have needed
discipline.

**Auto-select only at exactly one account.** A B2B shopper transacting against an
account they never chose is the failure this prevents. A member belonging to no
accounts logs in successfully — failing would tell someone removed from every
organisation that their password is wrong.

**The account token rolls on use**, at a threshold sourced from the implicit
token's fixed lifetime rather than invented. Rolling reaches only sessions making
calls, so an idle shopper still lapses. **A lapsed account is surfaced as a
positive fact, never inferred from a timestamp and never silent** — reverting
silently means prices change under the shopper with no signal.

**Resolving an account id to its token pages server-side.** The platform caps a
page at 100 and offers no way to read past it in one call, so the package
forwards the platform's own paging rather than imposing a flat ceiling a member
in 101 accounts would hit. It pages on the server because tokens are never handed
to the browser.

### Cart and session lifetimes

**One envelope, one lifetime**, on the cart clock, rolling, with account identity
a revocable layer inside it. Two lifetimes was rejected because its invariant
cannot be held: the implicit token's lifetime is fixed and unrefreshable — there
are **no refresh tokens anywhere in Elastic Path** — so any envelope longer than
an hour already contains a dead credential and already has to re-mint.

Carts expire seven days after **last update**, configurable per store. Reads
never move the clock and failed writes never move it, so browsing does not keep a
basket alive.

**Association is discoverability, not access control.** Associating a cart
requires the account token, but reading that cart by id under an unrelated
account token, or under the bare implicit token, both return 200 — and the
account relationship is an appendable **set**, so an account can add itself to a
cart whose id it knows and thereafter enumerate it. That upgrades a one-time
cart-id leak into durable access. It creates no capability that reading by id did
not already have, and association must never be presented as a second layer:
custody of the id is the whole defence. Association does not touch the expiry
clock either.

**A resolver seam chooses the cart at an identity transition** — a login or an
account switch — because merge semantics are merchant policy and Elastic Path
performs no automatic merge. It can act rather than only choose: a merchant
wanting take-the-higher-quantity semantics needs per-line arithmetic, and no
verdict value carries that without the package growing a merge language it has no
business owning. Absent a resolver the package **keeps the guest cart**, the only
default that cannot silently destroy or inflate what the shopper just built;
Elastic Path's own additive copy was rejected on its increment semantics. A
switch never offers the old cart as a candidate — that is the leak above, and the
lines carry the previous account's prices.

### Design time

Design time works today because the hook path goes straight to Elastic Path with
a public token and never touches a cookie. Under one session it would inherit the
proxy's cookie dependency, and better-auth's `SameSite=Lax` default means a
consumer self-hosting their app host on their own registrable domain breaks
cross-site. **Design-time parity is a ship requirement**, so this gets a
**separate session-free route** rather than a fallback branch inside the proxy:
two routes with one rule each, and a route that never touches the session cannot
leak session-scoped data.

**Unauthenticated, and staying that way.** It serves what the public `client_id`
already unlocks, so a gate would be theatre. What it buys is not "designers see
something" — the canvas already has an automatic **mock floor** of `"Sample"`
fixtures — but **per-store schema**: extension slugs, hierarchy node ids and
variation names exist only in the customer's store.

**It is a closed list of declared names, not a forwarder**, which is the opposite
of the rule the session proxy follows. The proxy can forward because the
shopper's credential is the boundary; this route cannot, because its implicit
token draws no boundary and can write to `/carts` and `/checkout`. An open
forwarder on an unauthenticated production route is an open proxy with a write
surface on the customer's own domain. Names are declared rather than subtracted,
so a future session-scoped function does not become anonymously readable by
omission.

**No code path retries a proxy failure against the design route.** That clause is
what keeps the closed identity surface true in the transport and not just on
paper; a fallback's failure mode is a genuinely logged-in shopper with a
just-expired envelope silently served unscoped prices.

**Where a read has no mock floor behind it, it throws rather than soft-failing.**
In the canvas a null is what lets the fixtures render; in Studio's data-query
Configure panel nothing sits behind it, so the same null is indistinguishable
from a wrong argument binding on the surface a designer opens to check bindings.

**`registerAll` must never register `ep.*` functions.** The hostless registry
wins on an id collision, so one import would move every consumer's Configure
panel into a realm where its URLs resolve against Studio's origin, with the
canvas unaffected and no error anywhere. Half of this is enforced by the
`./server` subpath split; this constraint holds the other half.

Designing as a particular shopper is not the target. There is no impersonation
grant to build it on, it renders a real shopper's order history inside Studio,
and it cannot show a designer the variations no real account currently exhibits.

### Catalog search

**Named, not forwarded.** The security case for naming it does not exist — the
shopper's resolved catalog *is* the whole collection, chosen server-side by index
selection before any filter runs, so a forwarder would be safe. It went named on
cost and on isomorphism: one endpoint and one caller make a forwarder's
path-choosing freedom worthless, and a forwarder is browser-to-server only, so a
server render would post to its own route with an absolute origin and
hand-forwarded cookies.

**The response passes back verbatim under a package-owned wire type**, because
the SDK's response type omits a field the adapter reads off the top level and an
SDK-typed function would silently drop every hit's image.

**No shared server-side cache.** Catalog visibility and pricing are
account-scoped, so a cache keyed on query text serves one account's prices to
another; keying on the account token leaves no hit rate. The constraint stands
for any future cache, not just this one.

**Server-rendered, unconditionally**, and it renders the **unrefined default
first page**: component-level scope flows into the server pass, URL-derived
refinement state does not, and that is foreclosed rather than rejected. Accepted,
because the SEO case rides component-level scope and renders correctly, while
deep-linked search URLs self-correct after hydration and are conventionally
`noindex`. **A failed server search falls through to client rendering and must
never 500** — a shopper always sees the hydrated render, whereas the alternative
is a crawler indexing an error message for a category page.

**The SSR library stays a declared dependency and needs fork patches to the
loader.** Hostless bundles resolve dependencies at bundle time and the externals
list is hardcoded server-side, so an unguarded require of an absent package fails
the whole loader bundle for every project using it. Restricting SSR to app-host
consumers was rejected — it splits the recommendation by deployment mode, which
is worse than splitting it by page type. **No upstream pull request**; these are
fork patches.

**Catalog search is the recommended listing path for every page type**, with the
simpler product-list component as the supported on-ramp for stores without a
search index. The discriminator is store capability, not page type. Neither path
carries a deprecation signal, and under ADR-0004 neither can be removed anyway.

## Consequences

- Every catalog read gains a hop through the storefront's own origin. Accepted:
  the alternative is an account token in the browser.
- The browser Elastic Path client has no consumers and is deleted, taking a
  request interceptor with it that must find a home server-side first, or
  converging silently changes inventory behaviour.
- EP Shopper Context loses every reader and becomes an inert registration under
  ADR-0004. The cart-id preview override dies with no replacement: reviving it
  means handing a cart id to an unauthenticated route, and the id is the
  capability.
- Design-time catalog reads become **relative**, so they resolve against whatever
  document serves the artboard. With an app host configured the designer gets
  better data than today; with none they 404 at the renderer and drop to the
  labelled mock floor.
- Catalog search shows fixtures at design time permanently — the canvas never
  mounts the provider's inner component — which is the one axis where the on-ramp
  path is better. Documented as a limitation, not closed here.
- Designers get no account-scoped design time. There are zero account-scoped
  components in this package, so there is no parity to preserve. The effort that
  adds them inherits two facts: a route that can name an account cannot be
  unauthenticated, and there is no impersonation grant.
- Defensive parenthesising of client filters is **defence in depth, not a fix**.
  The platform composes search-profile filters safely, verified live against a
  provisioned narrowing profile, so there is no open hole and this ADR must not
  present one. Safety rests on the implementation, which the specification does
  not promise.
- An account cart list can hold a cart another party planted, so adopting the
  most recently updated account cart adopts that. Severity is low — the shopper
  sees the lines before checkout — and it is one more reason the id stays in
  server custody.
- A store with catalog rules bound to an account is still needed to demonstrate
  account-scoped pricing end to end. The integration store exercises none, so the
  account header's effect is untested rather than shown.
- Route-wide rate limiting is unaddressed and now covers two routes: the session
  proxy and an unauthenticated design-time route on every consumer's production
  origin.
- A path-traversal authorization bypass on Orders was found incidentally
  (store-wide order PII under a bare implicit token). It is a gateway-side
  Elastic Path platform flaw that no storefront change closes, and it is out of
  scope here.
