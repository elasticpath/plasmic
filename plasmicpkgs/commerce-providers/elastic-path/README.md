# @elasticpath/plasmic-ep-commerce-elastic-path

Elastic Path commerce components for Plasmic. Server-side auth, SSR product data, cart operations — all wired through a Better Auth-aligned session pattern.

## Quick Start

### 1. Create the auth instance

```ts
// lib/ep-auth.ts
import { createEpAuth } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

export const epAuth = createEpAuth({
  // Same values configured on the EP Provider in Plasmic Studio
  clientId: "your-ep-client-id",
  host: "https://useast.api.elasticpath.com",

  // The storefront's own origin. Unset, it is http://localhost, and the auth
  // handler refuses calls from your real origin as "Invalid origin".
  baseURL: process.env.NEXT_PUBLIC_BASE_URL,

  // Session cookie secret. Read it straight from the environment — no `!`
  // and no fallback: a missing value must fail loudly in production, not
  // silently become a guessable key.
  secret: process.env.CHECKOUT_SESSION_SECRET,

  // Optional: checkout session encryption
  checkout: { sessionSecret: process.env.CHECKOUT_SESSION_SECRET! },

  // Optional: payment adapters
  adapters: { stripe: { secretKey: process.env.STRIPE_SECRET_KEY! } },

  // Optional: choose the shopper's cart when they sign in or switch
  // organisation. See "Which cart wins at sign-in" below.
  // sessionCartResolver: ({ guestCartId, accountCarts }) => ...,

  // Optional: the shopper's locale and currency, sent to Elastic Path as
  // Accept-Language and X-Moltin-Currency. The only way to set a currency.
  // Read cookies and headers only: a proxied browser call has no page URL.
  // `locale` takes a tag or the raw Accept-Language value.
  // resolveLocaleAndCurrency: ({ cookies, headers }) => ({
  //   locale: headers["accept-language"],
  //   currency: cookies["shop-currency"],
  // }),
});
```

### 2. Mount the catch-all API route

**App Router:**

```ts
// app/api/ep/[...path]/route.ts
import { createEpAuthRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

export const { GET, POST } = createEpAuthRoutes(epAuth);
```

**Pages Router:**

```ts
// pages/api/ep/[...path].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createEpAuthRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

const handlers = createEpAuthRoutes(epAuth);

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method?.toUpperCase() as "GET" | "POST";
  const fn = handlers[method];
  if (!fn) return res.status(405).end();

  // The handlers take a WHATWG Request, so rebuild one from the Node req.
  const url = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}${req.url}`;
  const body =
    method === "GET"
      ? undefined
      : await new Promise<string>((resolve) => {
          let raw = "";
          req.on("data", (chunk) => (raw += chunk));
          req.on("end", () => resolve(raw));
        });

  const response = await fn(
    new Request(url, {
      method,
      headers: req.headers as Record<string, string>,
      body,
    })
  );

  // Set-Cookie must be forwarded as a list — setHeader would collapse it.
  res.setHeader("Set-Cookie", response.headers.getSetCookie());
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  res.status(response.status).send(await response.text());
}
```

Mount the proxy and design-time routes too — the components call them. See
[The two browser routes](#the-two-browser-routes). Those recipes are App Router
route handlers; under the Pages Router, adapt each one the way the auth
handler is adapted above.

### 3. Wire the page with session

**App Router:**

A server component cannot write cookies, so a middleware mints the session
before the page renders. The page then reads it, and runs Studio Server
Queries inside it.

```ts
// middleware.ts
import { epAuthMiddleware } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

export const middleware = epAuthMiddleware(epAuth);

export const config = {
  // better-auth and AsyncLocalStorage need Node, not the Edge runtime.
  runtime: "nodejs",
  // Skip Next assets, the auth handler itself, and files.
  matcher: ["/((?!_next|api/ep|.*\\..*).*)"],
};
```

```tsx
// app/[[...catchall]]/page.tsx
import { PLASMIC } from "@/plasmic-init";
import { PlasmicClientRootProvider } from "@/plasmic-init-client";
import { PlasmicComponent } from "@plasmicapp/loader-nextjs";
import {
  buildEpCtx,
  withEpSession,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { epAuth } from "@/lib/ep-auth";

export default async function PlasmicLoaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ catchall?: string[] }>;
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const { catchall } = await params;
  const query = (await searchParams) ?? {};
  const plasmicPath = catchall ? `/${catchall.join("/")}` : "/";

  const prefetchedData = await PLASMIC.maybeFetchComponentData(plasmicPath);
  if (!prefetchedData || prefetchedData.entryCompMetas.length === 0) {
    notFound();
  }
  const pageMeta = prefetchedData.entryCompMetas[0];

  const cookieStore = await cookies();
  const session = await epAuth.api.getSession({
    cookies: Object.fromEntries(
      cookieStore.getAll().map((c) => [c.name, c.value])
    ),
  });

  // Each ep.* function reads the session from this scope.
  const prefetchedQueryData = await withEpSession(buildEpCtx(session), () =>
    PLASMIC.unstable__getServerQueriesData(prefetchedData, {
      pageRoute: pageMeta.path,
      pagePath: plasmicPath,
      params: pageMeta.params ?? {},
      query,
    })
  );

  return (
    <PlasmicClientRootProvider
      prefetchedData={prefetchedData}
      prefetchedQueryData={prefetchedQueryData}
      pageParams={pageMeta.params}
      pageQuery={query}
    >
      <PlasmicComponent component={pageMeta.displayName} />
    </PlasmicClientRootProvider>
  );
}
```

Reading the session makes the page dynamic, so `export const revalidate` has
no effect on it.

**Pages Router:**

```tsx
// pages/[[...catchall]].tsx
import type { GetServerSideProps } from "next";
import {
  buildEpCtx,
  withEpSession,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";
import {
  PlasmicRootProvider,
  PlasmicComponent,
  ComponentRenderData,
  extractPlasmicQueryData,
} from "@plasmicapp/loader-nextjs";
import { PLASMIC } from "@/plasmic-init";

export const getServerSideProps: GetServerSideProps = async ({ req, res, params }) => {
  const pagePath = "/" + ((params?.catchall as string[])?.join("/") ?? "");
  const plasmicData = await PLASMIC.fetchComponentData(pagePath);
  if (!plasmicData) return { notFound: true };

  // Resolve EP session from cookies (returning visitor) or OAuth (first visit)
  // Pass the headers: outside the App Router there is no `next/headers` to
  // fall back on, and `resolveLocaleAndCurrency` must see what the proxy sees.
  const session = await epAuth.api.getSession({
    cookies: req.cookies as Record<string, string>,
    headers: req.headers,
  });

  // Each ep.* function reads the session from this scope. The session stays
  // server-side: never hand it to globalContextsProps, which Plasmic
  // serializes into the HTML.
  const queryData = await withEpSession(buildEpCtx(session), () =>
    extractPlasmicQueryData(
      <PlasmicRootProvider loader={PLASMIC} prefetchedData={plasmicData}>
        <PlasmicComponent component={pagePath} />
      </PlasmicRootProvider>
    )
  );

  // Write the auth cookies for the next request (no-op if nothing changed)
  session.commitCookies({
    appendHeader(name: string, value: string) {
      res.appendHeader(name, value);
    },
  });

  return {
    props: { plasmicData, queryData, pagePath },
  };
};

export default function Page({
  plasmicData,
  queryData,
  pagePath,
}: {
  plasmicData: ComponentRenderData;
  queryData: Record<string, any>;
  pagePath: string;
}) {
  return (
    <PlasmicRootProvider
      loader={PLASMIC}
      prefetchedData={plasmicData}
      prefetchedQueryData={queryData}
    >
      <PlasmicComponent component={pagePath} />
    </PlasmicRootProvider>
  );
}
```

### 4. Environment variables

```bash
# .env.local — only genuine secrets, no EP credentials
CHECKOUT_SESSION_SECRET=your-32-char-secret-key-here
STRIPE_SECRET_KEY=sk_test_...

# Optional: extra origins permitted to act as the shopper. One list feeds
# auth, the proxy's CORS reflection and the origin gate — add your Studio
# origin here for cross-origin preview.
BETTER_AUTH_TRUSTED_ORIGINS=https://studio.example.com

# Optional: server log level. Unset, the server logs warnings and errors.
# Takes the browser's EP_DEBUG values: "*", "silent", "error", "warn:Pay".
EP_DEBUG=warn
```

In production `createEpAuth` refuses to serve when the secret is missing, is
a known example placeholder, or is under 32 characters. Anything other than
`NODE_ENV=development` / `test` counts as production, so preview deployments
are held to the same bar; the check stands down during `next build` so
build-then-inject-env pipelines still build.

Two options tighten the deployment further:

| Option | Default | Use when |
| --- | --- | --- |
| `trustedOrigins` | `baseURL`, its `localhost` / `127.0.0.1` twin, and `BETTER_AUTH_TRUSTED_ORIGINS` | another origin must act as the shopper (e.g. Studio preview) |
| `hostAllowlist` | Elastic Path Composable Commerce regions, `*.epcloudops.com`, the integration host, and loopback outside production | this store's Elastic Path API is served from a custom domain |

The EP API host named in the Plasmic bundle is checked against the **EP host
allow-list**: the defaults, plus `hostAllowlist`, plus the comma-separated
`EP_HOST_ALLOWLIST` environment variable. Your entries extend the defaults.
`createEpAuth` resolves the list once, hands it to `resolveConfig`, and
exposes it as `epAuth.config.hostAllowlist` for any other caller of
`extractEpProviderConfig`. A host off the list is logged and ignored, and the
session falls back to the `host` passed to `createEpAuth` (ADR-0006).

## Architecture

### Security model

The shopper has one Elastic Path identity, and it lives on the server.

- **One encrypted cookie holds the credentials.** `better-auth.session_data`,
  the shopper envelope, is an encrypted (JWE), `HttpOnly` cookie. Beside it,
  better-auth's signed `session_token` cookie carries only a session id. The
  envelope holds the shopper's Elastic Path access token, the
  signed-in account member, the selected organisation's account credential and
  the cart id. Page scripts cannot read it.
- **No Elastic Path credential in the browser.** The browser holds no access
  token, no account credential and no Elastic Path client. `get-session`
  answers with an allowlist of fields, and no credential is on it.
- **Identity goes through your own origin.** A browser call that acts as the
  shopper goes to the storefront, and the server attaches the credential. The
  proxy route runs named `ep.*` functions, so the server supplies the ids that
  decide access, not the browser. The auth handler runs the identity
  operations. The design-time route reads no session and serves public catalog
  data only.

```
First visit:
  middleware (App Router) or getSession() + commitCookies() (Pages Router)
  → no cookie → mint an access token → better-auth.session_data set
  → page → buildEpCtx() → withEpSession() → Server Queries render product data

Returning visit:
  page → epAuth.api.getSession() → read better-auth.session_data
  → re-mint the access token if it is about to expire
  → re-mint the account credential if it has under an hour left
  → buildEpCtx() → withEpSession() → Server Queries render product data
```

[ADR-0003](docs/adr/0003-one-session-for-elastic-path-identity.md) records the
decision and the platform facts behind it. Three of those facts shape what you
can rely on:

- **The anonymous access token is public by construction.** Anyone holding the
  store's `client_id` can mint one, and it can write to `/carts` and
  `/checkout`. Where it is kept protects nothing. Earlier releases called its
  in-memory custody a security property; that claim is retired.
- **A cart id is the entire access boundary on a cart.** `GET /v2/carts/{id}`
  succeeds for any known id under any token, and an unknown id creates a cart
  rather than returning 404. Whoever holds a cart id holds the cart.
- **Account association is discoverability, not access control.** The
  relationship is an appendable set, so any account that learns a cart id can
  attach itself and then list that cart.

**The cart id stays on the server.** The id alone is enough to read and change
a cart, and this is also true for a cart linked to an account. So nothing the
storefront sends to the browser contains it:

- `$ctx.cart`, and every cart the cart functions return, has no `id` and no
  `links`.
- `get-session` and the account routes do not return `epCartId`.
- Checkout session responses have no `cartId`.
- The browser cannot set the session's cart. When a cart write creates a cart,
  the proxy route records it on the session.

Server code that needs the id reads `session.cart?.id` from
`epAuth.api.getSession`. This keeps the id away from page scripts, browser
extensions and anything that records what a page receives. It does not make the
id less powerful: a person who gets the id in a different way can still read
and change the cart. In server code, treat the id as a credential for that one
cart: do not put it in a URL or send it to a third-party service.

**`next dev` exposes the session.** Next's React Server Components debug
instrumentation serializes a server component's local variables into the page
payload, and the session is one of them. Under `next dev`, the page source
contains the shopper's access token, the session's cart id and, once a member
selects an organisation, that organisation's account credential. A server
component that reads the cart also adds the raw Elastic Path cart response,
which carries the cart id. The account credential unlocks the organisation's
order history, account and member records, and addresses. None of these is in
`next build` output, and nothing this package does can suppress it. Treat a dev server as holding a live shopper credential:
never run one on a shared host or against a production store.

### API Routes

`createEpAuthRoutes(epAuth)` mounts the auth handler, which answers only under
`/api/ep`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ep/ep/anonymous` | Mint an anonymous session |
| POST | `/api/ep/ep/refresh` | Rotate the EP token |
| POST | `/api/ep/ep/account/login` | Sign an account member in |
| POST | `/api/ep/ep/account/register` | Register an account member |
| POST | `/api/ep/ep/account/roster` | Read the accounts the member belongs to |
| POST | `/api/ep/ep/account/select` | Select or deselect the account being bought for |
| POST | `/api/ep/ep/account/roll` | Re-mint the account credential before it runs out |
| POST | `/api/ep/ep/account/member` | Read the signed-in account member |
| POST | `/api/ep/ep/account/member/update` | Update the signed-in member's name and/or email |
| POST | `/api/ep/ep/account/logout` | Sign the account member out |
| GET | `/api/ep/get-session` | Read the session, minus EP credentials |

Call these through the identity client rather than by hand. The table is the
contract the client is built from, not an instruction to write `fetch`.

### The two browser routes

Components call the `ep.*` functions directly; in a browser those calls go out
over one of two routes, and both need mounting.

```ts
// app/api/ep/proxy/[fn]/route.ts — the shopper's own reads and cart writes
import { createEpProxyRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

const routes = createEpProxyRoutes(epAuth);
export const POST = routes.handle;
export const OPTIONS = routes.options;
```

```ts
// app/api/ep/design/[fn]/route.ts — Studio design time only
import { createEpDesignRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

const routes = createEpDesignRoutes(epAuth);
export const POST = routes.handle;
export const OPTIONS = routes.options;
```

The design route reads no shopper session, which is what lets it answer inside
Studio's editing frame: the session cookie is `SameSite=Lax` and never travels
there once the app host is served from the storefront's own domain. It serves
the catalog reads `getProduct`, `getProductList`, `getProductPage` and
`getRelatedProducts`, plus `getSearchAttributes` for the search filters'
attribute dropdowns, under a bare implicit token, and refuses every other
name. Mount it in production: designers edit against a deployed app host.

Its CORS is `Access-Control-Allow-Origin: *` with no credentials and no origin
gate, because it serves what the store's public client id already unlocks. It
takes no entry in `trustedOrigins`, which stays shopper-only (ADR-0001).

Leave it unmounted and Studio still works: the canvas falls back to its
labelled `"Sample"` fixtures and the console says once which route is missing.
What a designer loses is per-store schema — extension slugs, hierarchy node
ids, variation names — which no fixture can supply.

### The identity client

`useEpIdentity()` gives a component the identity operations as methods. It
passes no URL and no base path, so a component cannot get identity wrong by
configuring it wrong:

```tsx
import { useEpIdentity } from "@elasticpath/plasmic-ep-commerce-elastic-path";

function SignIn() {
  const identity = useEpIdentity();

  async function signIn(username: string, password: string) {
    const { session, accounts } = await identity.login({ username, password });
    // A member of exactly one account is already placed in it. A member of
    // several has nothing selected, and chooses.
    if (session.epAccount) return null;
    return accounts;
  }

  async function chooseAccount(accountId: string) {
    await identity.selectAccount({ accountId });
  }
  ...
}
```

| Method | Argument | Resolves to |
|--------|----------|-------------|
| `getSession()` | — | the session, or `null` |
| `signInAnonymously()` | — | the session |
| `refresh()` | — | the session |
| `login({ username, password, name? })` | credentials | the session, plus the member's organisations |
| `register({ username, password, name, email })` | credentials | the session, plus the member's organisations |
| `roster({ limit?, offset? })` | paging | every organisation, or one page when `limit` or `offset` is set |
| `selectAccount({ accountId })` | organisation id, or `null` to deselect | the session |
| `rollAccount()` | — | the session |
| `logout()` | — | the session |

Arguments and results are one declaration, which the endpoints are typed
against: renaming a field a method reads is a compile error in the handler,
and calling a method wrongly is a compile error at the call site. The session
each method resolves to is checked against the allowlist the handler filters
every response through, so no method can be typed as returning an Elastic
Path credential.

A refused operation throws, carrying the server's own reason:

```ts
import { epIdentityErrorCode } from "@elasticpath/plasmic-ep-commerce-elastic-path";

try {
  await identity.roster();
} catch (err) {
  if (epIdentityErrorCode(err) === "account_lapsed") {
    // Tell the shopper their account access ran out, rather than
    // showing them list prices with no signal.
  }
}
```

**Outside React**, `createEpIdentityClient()` builds the same client.

**Mount the routes at `/api/ep`.** The auth handler answers only there, and
the registered components, `useEpIdentity()`, `epAuthMiddleware` and the proxy
route's cart write call `/api/ep`, `/api/ep/proxy` and `/api/ep/design`. No
option moves them.

**In the Studio canvas** the client stays relative, which resolves against the
document serving the artboard — the consumer's own app, holding the shopper's
cookies, with no CORS involved. There is no origin to pin: reaching the auth
handler across origins would need that handler to reflect CORS with
credentials, and it does not.

### Account identity

The session holds the authenticated **account member** and the **selected
account** — the organisation they are buying for — as two separate facts.
`isAuthenticated` reports the member, so a member who belongs to no
organisation reads as signed in. While an account is selected, every `ep.*`
server function carries `EP-Account-Management-Authentication-Token`. The
checkout-session handlers carry it on every call made as the shopper: pass the
selected account's token as `accountToken` on `SessionHandlerContext`, resolved
from `session.session.account?.token` next to `shopperAccessToken`. Calls made
with `getClientCredentialsToken` never carry it.

An account member's checkout places the order for the selected account. Set
the shopper's fields with `checkoutContextFromSession`, from `/server`. It
reads one `getSession` result and sets `shopperAccessToken`, `sessionCartId`,
`accountToken`, `accountId`, `accountMemberId`, `locale` and `currency`:

```ts
const session = await epAuth.api.getSession({ cookies, headers });
const ctx: SessionHandlerContext = {
  // ...
  ...checkoutContextFromSession(session),
};
```

`accountToken` and `accountId` go together. A context with only one of them
(for example the 0.8.0 setup, which set only `accountToken`) cannot tell
whether the order is for an account, so creating a checkout session and pay
return `500` with code `ACCOUNT_NOT_CONFIGURED` and place no order, and
`epPlaceOrder` throws. The server log names the fix.

The checkout session takes the account when it is created. Every order it
places is linked to that account and member, with the checkout form's name
and email as the order's contact. With no account selected, the order is a
guest order with that name and email. That includes a signed-in member who has
not chosen an account: Elastic Path links an order to an account, not to a
member alone. When the selected account changes after the checkout session is
created (switched, deselected or lapsed), pay takes no payment, drops the
checkout session and returns `409` with code `ACCOUNT_CHANGED`. The account
and the member come only from the server-side session, never from the request.

The session cart is `sessionCartId` (`session.cart?.id` on the same
`getSession`). `handleCreateSession` checks out that cart and ignores any cart
id in the request; without it, creating a checkout session returns `409` with
code `NO_CART`. Every later checkout-session route works on the cart the
session was created with.

A cart with nothing to buy (no lines, or only the shipping line and
promotions) returns `409` with code `EMPTY_CART`, both when a checkout session
is created and at pay. Pay charges only the total the session last returned.
When the cart's total differs, pay charges nothing and returns `409` with
code `CART_MISMATCH` (the lines changed) or `TOTAL_CHANGED`, and the session
it returns carries the new total. A pay request may say which total the page
showed as `shownTotal` (EP Checkout Session Provider always does); pay then
also refuses with `TOTAL_CHANGED` when that is not the total it would charge.
Reading an open session (`GET …/current`) re-reads its cart, and when the
lines changed it stores and returns the cart's new totals, so the page shows a
cart change before the shopper pays. It does not move a session while a card
check holds its order or a payment for its cart runs.

The checkout's shipping line (SKU `__ep_shipping`) is in the cart only while a
payment runs. Choosing a rate writes the line, reads the cart Elastic Path
priced with it (promotions and tax included) as the session's totals, and
takes the line out again; reading a session whose cart changed prices the rate
the same way. Pay writes the line again before it charges, and pay, resume,
abandon and confirm take it out when they end, unless a card check waits with
no order held. Creating a session takes out a line an earlier checkout left.
So a cart page outside a payment shows totals its lines add up to. A rate
Elastic Path cannot price is not chosen: the update returns `502` with code
`SHIPPING_NOT_APPLIED` and the session without that rate. A cart settles at most one order: pay,
resume-payment and abandon-payment share one guard per cart. While one of
them runs for a cart, another request from the same checkout session gets the
same response, and one from a different checkout session gets `409` with code
`CHECKOUT_IN_PROGRESS`, as does a session update. A cart write while the
cart's payment runs is refused with code `checkout_in_progress`.

**Run one checkout session on one server instance.** The guard lives in one
server process. With more than one instance, route each checkout session's
requests to the same instance (session affinity). Across instances, a double
submit can create a duplicate order for one payment; it cannot charge twice.
A planned follow-up, "every charge belongs to an order", removes this limit.

When a card needs a 3DS challenge, pay creates the order first and returns
the challenge only when that order's total is the total the session showed
(else `409` with `ORDER_TOTAL_CHANGED`). Resume-payment confirms that order,
so a cart change during the challenge does not change what is ordered. While
the challenge is open, pay and session updates return `409` with code
`PAYMENT_ACTION_PENDING` and the open session; finish the challenge (resume)
or cancel it (abandon) first. EP Checkout Session Provider and EP Stripe
Payment do this for you, and EP Checkout Form Provider shows its fields
locked until the check ends. When the order completes, the cart keeps any
line the shopper added during the challenge; the lines the order took are
removed (the whole cart is emptied when that cannot be done safely).

After any paid order the ordered lines leave the cart. An account's last cart
cannot be deleted in Elastic Path, so its items are deleted instead and the
cart stays linked to the account. If the lines cannot be removed, the next
checkout session for that cart retries first and answers `409`
`CART_CLEANUP_PENDING` until it can. A checkout Elastic Path refuses (for
example, not enough stock) answers `409` `CHECKOUT_REJECTED` with Elastic
Path's reason and takes no payment.

**Out of stock after the charge.** Elastic Path checks stock when the order is
created, after a card payment is taken. When stock runs out in between, the
checkout ends with `409` `PAYMENT_NEEDS_REVIEW`, the shopper is told, and the
server logs the payment for reconciliation; no order is created for it. The
planned follow-up, "every charge belongs to an order", removes this limit.

**An email Elastic Path refuses.** Elastic Path checks the customer email at
checkout, also after a card payment. So a session update whose `customerInfo`
email Elastic Path would refuse returns `400` with code `INVALID_EMAIL` and
saves nothing, and pay checks the session's email again before any payment
or order. The rule is the one Elastic Path applies: one RFC 5322 address, so
`jane doe@example.com` and `jane@example.com.` are refused, and plus
addressing, non-ASCII addresses and `Jane <jane@example.com>` pass.

Abandoning a card check that can still complete voids its payment: the order
held for the challenge is confirmed and its pending transaction cancelled,
which cancels the PaymentIntent in Stripe, so the challenge can no longer
charge the card. The stock that confirm took is returned and the order
cancelled. If the challenge completes during the void, the payment is kept:
the order is placed (or marked for reconciliation) and the checkout ends.

Resume confirms the order only after Stripe reports that the payment was
taken. Elastic Path cannot report this, and its confirm on a payment still
waiting for 3DS leaves the order unable to take that payment. So resume reads
the PaymentIntent from Stripe, the same read Stripe.js makes: its client
secret (held in the checkout session) plus a publishable key and the
connected account. Give the Stripe adapter those keys:

```ts
createStripeAdapter({
  host: apiBaseUrl,
  clientId,
  getClientCredentialsToken,
  publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, // pk_…
  stripeAccount: process.env.NEXT_PUBLIC_STRIPE_ACCOUNT_ID, // acct_…
});
```

Both are public values; no Stripe secret is involved. Without them, resume
uses the keys EP Stripe Payment sends with the request. A resume the server
cannot check this way returns `409` with code `PAYMENT_STATUS_UNVERIFIED` and
places no order. A resume sent before the challenge is passed returns `409`
with `PAYMENT_STILL_REQUIRES_ACTION`; a declined challenge frees the cart for
a new payment. Abandon releases the payment only when Stripe reports it still
waiting or failed: a payment Stripe reports as taken returns `409` with
`PAYMENT_ALREADY_TAKEN` (resume instead), and one the server cannot check
returns `409` `PAYMENT_STATUS_UNVERIFIED`. A payment in `processing` is
waited for, not confirmed. When Stripe reports the payment taken but no
matching order can record it, the checkout ends instead of looping: it
completes with `reconciliationPending: true` (the order's `external_ref`
records the payment), or returns `409` `PAYMENT_NEEDS_REVIEW` with no order
when the cart changed and no order was held.

Pass the session's `locale` and `currency` on `SessionHandlerContext` as well,
from the same `getSession`:
`{ ...ctx, locale: session.locale, currency: session.currency }`. Checkout
reads the cart with them. Without them, checkout totals do not match the cart
the shopper saw.

`POST /ep/account/login` takes `{ username, password }`. The server calls
Elastic Path's `/v2/account-members/tokens` itself, so no Elastic Path
credential is ever in the browser. It answers with the roster —
`{ accounts: [{ id, name }], total }` — alongside the session, so a chooser
renders with no second call.

`POST /ep/account/register` takes `{ username, password, name, email }`. The
server posts a self-signup request to Elastic Path's `/v2/account-members/tokens`,
with the same password profile as login, then follows login's session,
checkout and cart path. The response has login's shape. An Elastic Path `4xx`
other than `401` is `registration_rejected` with Elastic Path's status and
`errors[0].detail` as the message; a `401` or `5xx` is
`account_token_mint_failed`, as for login.

Selection follows from the count. Exactly one account and the member is placed
in it; several and **none** is chosen for them; none at all and the member is
signed in anyway, authenticated but permanently unscoped.

`POST /ep/account/member` takes an empty body. The server reads
`GET /v2/account-members/{session.epMemberId}` with the implicit shopper token
and the account-management credential the session already holds: the selected
account's when it is still valid, otherwise the anchor held while none is
selected. The response is `{ id, name?, email? }`. `id` is the session's
member id. A member with no usable account-management credential, including a
member of no organisation and a lapsed selection, returns `{ id }` and does
not call Elastic Path. An Elastic Path rejection is
`account_member_read_failed` with Elastic Path's status and
`errors[0].detail` as the message. The shopper session is left as it was.

`POST /ep/account/member/update` takes `{ name?, email? }`, with at least one
of them. Each supplied value is trimmed and must be a non-empty string, and
`email` must be an email address. The server writes
`PUT /v2/authentication-realms/{realmId}/user-authentication-info/{session.epMemberId}`
and returns `{ id }`. It does not read the account member again; the next
account reload does. `realmId` comes from the store's account-authentication
settings. The bearer token is the implicit shopper token. The
account-management header is the selected account's credential, or the anchor
when none is selected. A lapsed selection is `account_lapsed`. A member with
no usable account-management credential, including a member of no
organisation, is `no_account_credential`. Neither calls Elastic Path. An
Elastic Path rejection is `account_member_update_failed` with Elastic Path's
status and `errors[0].detail` as the message. Changing `email` does not
change the login username.

`POST /ep/account/roster` reads the same list later in the session. With no
body it reads every page on the server and answers the whole list. With
`{ limit?, offset? }` it answers that one page; Elastic Path caps a page at
100. `total` is Elastic Path's own count.

`POST /ep/account/select` takes `{ accountId }`, or `{ accountId: null }` to
deselect. It re-mints the account credential first, then tears down any
checkout session, chooses the session cart (see
[Which cart wins at sign-in](#which-cart-wins-at-sign-in)), and writes the new
account last — so a switch that fails leaves the previous selection exactly as
it was. Deselecting clears the session cart.
Selecting the account already selected does nothing at all. No password is
needed: re-minting runs off the credential the session already holds.

The checkout session it tears down is the one `CookieSessionStore` holds. A
consumer who supplies their own `SessionStore` must clear it themselves on a
switch — the auth handler has no handle on it.

The account credential is re-minted while it has less than an hour left,
without the shopper noticing. A shopper idle long enough for it to run out is
reported as lapsed rather than quietly returned to list prices, and roster and
select answer `account_lapsed` rather than presenting a dead credential to
Elastic Path.

**A store whose authentication realm carries more than one password profile
must pass `passwordProfileId` to `createEpAuth`.** Nothing in a profile record
marks a default, and signing in against the wrong one fails with Elastic Path's
own `authentication failed`, which says nothing about profiles. With one
profile the package finds it.

`get-session` releases `id`, `userId`, `expiresAt`, `createdAt`,
`updatedAt`, `epExpires`, `epMemberId`, `epAccount.{id,name}` and
`epLapsedAccount.{id,name}`. The cart id is withheld, and so are the account
credential and its expiry: the response is filtered to an allowlist of **paths**, so a field
added inside `epAccount` later is withheld by default. `epLapsedAccount`
states that a selection's credential ran out, rather than reverting the
shopper to list prices with no signal.

Cart reads and writes go through the proxy route as `getCart`, `addCartItem`,
`updateCartItem` and `removeCartItem`. There are no separate cart routes.

Mount the auth handler through `createEpAuthRoutes`, never better-auth's
`toNextJsHandler` directly: better-auth's `/get-session` returns the whole
session record, and this package keeps the shopper's EP access token on it.

The checkout-session handlers are mounted one route each, under the
`apiBaseUrl` the session provider is given:

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `{apiBaseUrl}/checkout/sessions` | `handleCreateSession` | Open a session for the shopper's session cart |
| GET | `{apiBaseUrl}/checkout/sessions/current` | `handleGetSession` | Read the session; an open session takes the cart's new totals |
| PATCH | `{apiBaseUrl}/checkout/sessions/current` | `handleUpdateSession` | Merge fields; a changed shipping address requotes |
| POST | `{apiBaseUrl}/checkout/sessions/current/shipping` | `handleCalculateShipping` | Requote on demand, for example after the cart changes |
| POST | `{apiBaseUrl}/checkout/sessions/current/pay` | `handlePay` | Place the order and start payment |
| POST | `{apiBaseUrl}/checkout/sessions/current/resume-payment` | `handleResumePayment` | Resume payment after a customer action |
| POST | `{apiBaseUrl}/checkout/sessions/current/abandon-payment` | `handleAbandonPayment` | Unlink a failed or cancelled payment |
| POST | `{apiBaseUrl}/checkout/sessions/current/confirm` | `handleConfirm` | Confirm a gateway action |

A saved shipping address is a quoted address: the update runs the
`shippingRateResolver` in the same write, so a host that mounts only the
session route still offers rates. A resolver failure leaves the address saved
with no rates; the `/shipping` route is the retry.

### Payment methods

Orders are placed only through the checkout-session routes. The proxy route
does not dispatch `placeOrder`.

The server decides which gateway an order may use, before `/pay` creates the
order:

- A zero-total order completes with Elastic Path's `manual` gateway. It needs
  no adapter and no rule.
- An order with a total needs a registered adapter. The Manual adapter is
  refused (`400`, `GATEWAY_NOT_ALLOWED`) unless the host gives it an `allow`
  rule that returns `true` for that cart and account. A rule that throws
  refuses.

To offer offline or invoice payment, register the Manual adapter with a rule.
The rule sees the account the order is placed for (see
[Account identity](#account-identity)), or `null` for a guest order:

```ts
adapterRegistry.register(
  "manual",
  createManualAdapter({
    method: "purchase",
    allow: async ({ cart, account }) =>
      account !== null && (await isApprovedForInvoice(account.id)),
  })
);
```

`cart` is the cart as Elastic Path returns it, with its items under
`included`. `epPlaceOrder(input, { allowManual })` takes the same rule, runs
only inside `withEpSession`, and throws when payment does not succeed.

### Which cart wins at sign-in

A shopper can arrive at the sign-in form with a cart, and already have one
saved on the account they sign in to. Elastic Path merges nothing on its own,
and its copy operation **adds** quantities, so ten saved plus two added becomes
twelve. Which cart wins is merchant policy, so the package asks rather than
decides.

With no `sessionCartResolver` configured:

- the guest cart wins — the one the shopper is looking at when they click
  log in, and the only choice that cannot silently destroy or inflate what they
  just built;
- with no guest cart, the account's most recently updated cart is adopted;
- the losing cart is never deleted;
- switching organisation never carries the previous organisation's cart
  across, because its lines carry that organisation's prices.

To decide it yourself, configure the hook once on `createEpAuth`:

```ts
export const epAuth = createEpAuth({
  clientId: "your-ep-client-id",
  host: "https://useast.api.elasticpath.com",
  secret: process.env.CHECKOUT_SESSION_SECRET,

  async sessionCartResolver({ trigger, guestCartId, accountCarts, accountId }) {
    // `trigger` is "login" or "accountSwitch". `guestCartId` is null at a
    // switch. `accountCarts` carries { id, name, createdAt, updatedAt } —
    // no line items; read them yourself if your rule needs them.
    // `accountCarts` is newest-first, and may be empty.
    if (guestCartId) return { keep: guestCartId };
    // `accountCarts` can be empty. Naming no cart logs an error and keeps
    // the default, which is then no cart at all.
    return { keep: accountCarts[0]?.id ?? "" };
  },
});
```

The hook runs after the account swap, under the shopper's new identity, so
`ep.*` server functions and raw `fetch` calls both act as the signed-in member
of that organisation. That is how a rule like take-the-higher-quantity is
written: read both carts, write the lines you want, then return the id of the
cart you wrote to.

`trigger` is `"accountSwitch"` only when the shopper changed organisation
without signing in again — so `guestCartId` is always null when it is. Every
other case is `"login"`: signing in, and choosing an organisation while acting
for none, including a member of several picking their first.

`accountCarts` is one page, **most recently updated first**, so
`accountCarts[0]` is the organisation's newest cart. It can be empty. Elastic
Path ignores `sort` on its cart list, so the order is applied here, and an
organisation holding more carts than one page inside the store's expiry window
can have a more recent one the hook never sees.

`keep` must name a cart the hook was offered — `guestCartId` or one of
`accountCarts`. A hook that throws, or names anything else, never blocks the
sign-in: the default applies and the failure is logged. There is no package
timeout; your platform's request timeout is the bound. A partial write is
yours to avoid — decide first and write last, or make the writes safe to
repeat.

**A shopper who leaves their organisation loses their session cart, by choice
or not.** Deselecting an organisation clears the cart pointer. A lapsed account
credential also clears it, once, at the moment the package sees the lapse.
Neither deletes the cart. It stays with the organisation, and when the shopper
selects that organisation again, the package adopts it as the most recently
updated account cart. The hook is not called at either moment, because neither
ends with an organisation selected.

Elastic Path does not re-price a line when the shopper's scope changes, and
checkout does not correct it. A cart that followed the shopper would charge
them prices they are no longer entitled to. A cart the shopper builds after a
lapse is their own guest cart, and their next sign-in offers it like any other
guest cart.

Signing out clears the cart pointer, so the next person on that browser does
not inherit the previous shopper's cart. Signing in, like switching
organisation, tears down any checkout session in flight: it was priced and
addressed for the shopper who is no longer the one here.

The hook is handed no cart id on the session scope, only in its input. Which
cart is the session cart is the question it is answering, so `ep.*` calls
inside it name the cart they mean rather than defaulting to one.

### Cookie Architecture

| Cookie | Contents | Purpose |
|--------|----------|---------|
| `better-auth.session_token` | Signed session id | Session identity |
| `better-auth.session_data` | JWE — EP access token, client id, host, cart id | Everything the server needs to act as the shopper |

Both are `HttpOnly; SameSite=Lax; Path=/`. Over HTTPS they are `Secure`, and better-auth prefixes both names with `__Secure-`. The EP
access token, the account fields and the cart id all live inside the encrypted
`session_data` payload — there is no separate `ep_token`, `ep_account` or
`ep_cart` cookie.

### Server-Side Rendering

Product data server-renders through Studio Server Queries against the EP custom
functions — see [Studio Server Queries (SSR)](#studio-server-queries-ssr) below.
`buildEpCtx()` + `withEpSession()` carry the session; each `ep.*` function reads
it via `getCurrentEpSession()`.

Data flows into `prefetchedQueryData` → client hydration. Product data SSRs for
SEO. The token never enters the cache.

### Better Auth Alignment

The API follows [Better Auth](https://better-auth.com/) conventions:

| EP Commerce | Better Auth |
|-------------|-------------|
| `createEpAuth()` | `betterAuth()` |
| `epAuth.api.getSession(req)` | `auth.api.getSession(req)` |
| `createEpAuthRoutes(epAuth)` | `toNextJsHandler(auth)` |
| `session.user` / `session.session` | `session.user` / `session.session` |

## Studio Server Queries (SSR)

For SSR'd product data — where the initial HTML payload contains real product names, prices, and images — wire up Plasmic's Server Queries against the EP custom functions exposed by this package. The EP test project's PDP renders end-to-end this way; see `examples/ep-commerce-app-router/` for a working reference.

### 1. Loader configuration

```ts
// plasmic-init.ts
import { initPlasmicLoader } from "@plasmicapp/loader-nextjs/react-server-conditional";

export const PLASMIC = initPlasmicLoader({
  projects: [{ id: "...", token: "..." }],
  preview: true,
  // REQUIRED: without this the loader fetches the Pages Router bundle, which
  // omits per-page `serverQueriesExecFuncFileName` metadata and Server Queries
  // never execute.
  platformOptions: { nextjs: { appDir: true } },
});
```

### 2. Register the EP custom functions

```ts
// plasmic-register.ts
import { PLASMIC } from "./plasmic-init";
import { registerEpCustomFunctions } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

registerEpCustomFunctions(PLASMIC);
```

This registers the catalog reads below, and the cart writes `addCartItem`, `updateCartItem`, `removeCartItem` and `applyCartAdjustment`, in the `ep` namespace, callable from Studio's Server Query builder:

- `ep.getProduct({ id })` — single product by **product reference**: the product's slug, or its ID when it has none. Bind `id` to `$ctx.params.slug`; the links EP Search Hits builds carry exactly that value. A reference that names no product returns `null`.
- `ep.getCart()` — current cart contents.
- `ep.getProductList({ limit?, search?, categoryId? })` — a flat array of products. `categoryId` is a hierarchy **node** ID; it reads that node's products rather than filtering the whole catalog.
- `ep.getProductPage({ limit?, offset?, search?, categoryId? })` — one page of products **with the total count**, in Elastic Path's envelope: `data`, plus `meta.results.total` and `meta.page`. Bind it to EP Product List Provider's **Products (pre-fetched)** prop to server-render a listing. Prefer this over `getProductList` whenever the page has pagination controls — the flat array carries no total, so ranges and next/previous cannot be computed.
- `ep.getRelatedProducts({ productId, relationshipSlug, limit? })` — products linked by an EP custom relationship.
- `ep.getStock({ productIds, locationIds? })` — multi-location stock, keyed by product ID. Each location's `attributes.name` comes from the locations list, or is its slug when the list lacks it. Counts are plain numbers, because the value crosses `JSON.stringify` twice. A product whose stock is unreadable comes back with zero counts rather than failing the batch.
- `ep.getLocations()` — every inventory location. A `type` input is ignored, because a location has no type.
- `ep.getBundleOptionProducts({ productIds })` — the products a bundle offers as options, keyed by product ID, each the package's own product shape with images joined and prices carrying all four members.
- `ep.getBaseProducts({ productIds })` — the given products with their `variations` and `childProducts`. A product that is not a base product comes back with an empty `childProducts`; one the catalog does not return is omitted, because absent and purchasable-on-its-own are different answers.
- `ep.configureBundle({ bundleId, selectedOptions })` — re-prices a bundle for a set of option selections and returns Elastic Path's configured-bundle payload. Throws on failure: a configurator showing a stale total is worse than one showing an error.
- `ep.multiSearch({ searches, include? })` — a catalog multi-search, returned as-is. Pass `include: ["main_image"]` to get hit images: Elastic Path omits the top-level `included` block entirely unless it is asked for, and that block is what each hit's `relationships.main_image` resolves against. The response is passed through rather than reshaped so the block survives. It throws when the search fails: an empty result is a plausible correct answer here, so failing soft would render an outage as a no-results page.

Auth is **not** an argument. The session (`accessToken`, `clientId`, `host`, `cartId`, …) is propagated through `AsyncLocalStorage` — see step 3.

### 3. Wrap Server Queries in `withEpSession`

The quick start's page already does this: it reads the session, builds an
Elastic Path context with `buildEpCtx(session)`, and runs
`PLASMIC.unstable__getServerQueriesData` inside `withEpSession`. Each `ep.*`
function reads the active session from that scope through
`AsyncLocalStorage`, so a query in Studio needs no `auth` binding and the page
needs no `<DataProvider name="ep">`. On the server, outside any
`withEpSession` scope, the functions return `null` or `[]` without calling
Elastic Path.

### 4. Bind the queries in Studio

For each Server Query in the Plasmic UI, set the function and arguments. For a product detail page (`/product/[slug]`):

- **Function:** `ep.getProduct`
- **Arguments:** `{ id: $ctx.params.slug }`

`id` takes a product reference — the product's slug, or its ID when it has none — so the same binding works on a store whose products carry slugs and one whose products do not. A UUID-shaped reference is read by ID first and by slug on a miss; anything else is read by slug. A reference with a character outside `A-Z a-z 0-9 - _ .` names no product and sends no request.

Then bind the `EPProductProvider` component's advanced `product` prop to `$q.product.data`. Server Queries appear under `$q` (not `$queries`) in the binding panel.

### 5. Resolve EP credentials from Studio config

`clientId` and `host` come from the EP Provider global context (configured in Studio), not from `.env.local`. `createEpAuth`'s `resolveConfig` callback reads them with `extractEpProviderConfig(prefetchedData, { hostAllowlist })`, which scans the loader bundle for the global-context module, and the session carries them from then on; `buildEpCtx` reads them from the session. For projects without a homepage route, resolve a real page path via `PLASMIC.fetchPages()` rather than hardcoding `/` — see `getEpProviderConfig` in the example's `lib/ep-auth.ts`.

### Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `$q.product.data` always `null` / queries return `null` despite valid input | `withEpSession` not wrapped around `unstable__getServerQueriesData` | Wrap the query call per step 3; functions fail-soft to `null` outside an EP session scope |
| `prefetchedQueryData: "$undefined"` in the SSR HTML | `appDir: true` not set in `plasmic-init.ts` | Add `platformOptions: { nextjs: { appDir: true } }` |
| `EP OAuth failed (401) Invalid credentials` | `resolveConfig` found no EP Provider config (project has no homepage at `/`) | Ensure the storefront resolves a real page path via `fetchPages()` (already done if you copied `lib/ep-auth.ts` from the example) |
| Studio binding still references `auth: $ctx.ep` | Project predates PRD #272 | Drop `auth` from each Server Query argument — the session now flows via ALS, not execParams |

## Components

### Core
- **Elastic Path Provider** — Global context: `clientId`, `host`, `locale`
- **EP Shopper Context (deprecated)** — Does nothing and renders its children. Remove it from your project

### Product Display
- **EPProductProvider** — Single product data. **Product ID or slug** (`productId`) takes a product reference — usually `$ctx.params.slug`. A reference that names no product renders **Empty Content**, at runtime and on the canvas; a read that fails renders **Error Content** at runtime and the sample product on the canvas
- **EPProductListProvider** — Paginated product listing. **Products (pre-fetched)** (`initialPage`, advanced) seeds the first page from an `ep.getProductPage` Server Query result, and that query's `page[limit]` overrides **Page Size**; paging discards the seed and falls back to client fetching. To choose between this and catalog search, see [Choosing a listing path](COMPONENTS.md#3-choosing-a-listing-path)
- **EPRelatedProductsProvider** — Related products
- **EPProductGrid** — Repeater for product list items

### Cart
- **EPCartDrawer** / **EPCartInline** — Cart display
- **EPCartDrawerTrigger** — Opens cart drawer
- **EPCartItemList** — Cart item repeater
- **EPCartItemField** / **EPCartItemImage** — Cart item display
- **EPCartItemQuantityControl** / **EPCartItemQuantityButton** — Quantity adjustment
- **EPCartItemRemoveButton** — Remove item
- **EPCartField** — Cart totals and metadata
- **EPAddToCartButton** — Add to cart action

### Checkout (Composable)
- **EPCheckoutProvider** — Deprecated. Renders its children and nothing else. Use **EPCheckoutSessionProvider**
- **EPCheckoutStepIndicator** — Deprecated. Renders nothing; it read its step from EPCheckoutProvider
- **EPCustomerInfoFields** / **EPShippingAddressFields** / **EPBillingAddressFields** — Form fields
- **EPShippingMethodSelector** — Shipping options
- **EPPaymentElements** — Deprecated. Renders its children and nothing else; it took its client secret only from EPCheckoutProvider. Use **EPStripePayment**
- **EPCheckoutButton** — "Checkout" control that goes to `checkoutUrl`, for a cart page
- **EPPlaceOrderButton** — Places the order
- **EPOrderTotalsBreakdown** — Order summary
- **EPCheckoutCartSummary** / **EPCheckoutCartItemList** — Cart in checkout
- **EPPromoCodeInput** — Promo codes
- **EPCountrySelect** — Country picker

### Checkout (Session-based)
- **EPCheckoutSessionProvider** — The checkout path. Server-authoritative session for the cart in the shopper's session
- **EPCheckoutFormProvider** — Single-page form; places orders through the session provider above it, and shows a setup error without one
- **EPStripePayment** / **EPCloverPayment** — Payment adapters
- **EPManualPayment** — Manual payment (no card); needs the host's Manual payment rule for orders with a total (see [Payment methods](#payment-methods))

### Accounts (Composable)
- **EPAccountProvider** — Publishes `$ctx.account` from the shopper session: `accountMember`, `selectedAccount`, `accountRoster` (`{ accounts, total }`), `lapsedAccount`, derived `state` (`anonymous | memberOnly | selected | lapsed`), `isLoading` (true until the session read settles; Gates render nothing while it is true), and `isSelecting`. Tokens stay server-side; the Provider maps browser-readable identity only. `accountMember` is `{ id, name?, email? }`. The id comes from the shopper session. Name and email come from `identity.member()` when that result has the same id; an id-only result, a failed read, or a different id leaves them off and does not fail the account reload or a login or registration redirect that waits on it. Preview State is Studio only: explicit values force fixtures so Gates and Fields can be composed; `auto` uses live session identity when a member is present (otherwise the selected-account fixture). The published page always reads the live session and ignores Preview State. A normal Studio button calls this Provider's `logout()` ref action. `logout()` no-ops in the Plasmic canvas; the real sign-out runs at runtime and in interactive preview, then account state reloads. A normal Studio button calls `selectAccount(accountId)` to choose an organisation from `$ctx.account.accountRoster`. It no-ops in the Plasmic canvas. At runtime the already-selected id returns without a request or a reload; any other id selects through the identity client and then reloads account state. A further call while that selection is still in progress returns without another request or reload. `$ctx.account.isSelecting` is true only while that call is in progress, including its immediate reload, and is false again when the call resolves or rejects. Bind a selection button's Disabled prop to `$ctx.account.isSelecting`. Canvas and the already-selected id leave it false. It does not replace `isLoading`; Gates still close only while `isLoading` is true
- **EPAccountLoginFormProvider** — Login form boundary inside the Account Provider. Owns username and password internally and publishes only `$ctx.accountLoginFormData` (`status`, `error`, `isSubmitting`). A normal Studio button calls this Provider's `submit()` ref action. `submit()` no-ops in the Plasmic canvas; the real sign-in runs at runtime and in interactive preview, then the Account Provider reloads. Optional `redirectUrl` is a same-site path (`/account`, `/account?welcome=1`, `/account#orders`) opened with a full-page navigation after that reload succeeds. A valid `?redirect=` on the page overrides it; an invalid one falls back to `redirectUrl`. If the reload fails, the shopper stays on the page, including when a later retry succeeds. With neither value set, login does not navigate
- **EPAccountFormField** — Username or password input for the Login Form Provider (`name`: `username` or `password`; `inputType`: `text`, `email`, or `password`). Registers with that form and renders its own required-field error. Does not publish the value
- **EPAccountRegistrationFormProvider** — Registration form boundary inside the Account Provider. Owns name, email, username, password, and confirm-password internally and publishes only `$ctx.accountRegistrationFormData` (`status`, `error`, `isSubmitting`). A normal Studio button calls this Provider's `submit()` ref action. `submit()` no-ops in the Plasmic canvas; registration runs at runtime and in interactive preview, then the Account Provider reloads. Optional `redirectUrl` uses the same same-site rules as login (`/account`, `/account?welcome=1`, `/account#orders`). A valid `?redirect=` on the page overrides it; an invalid one falls back to `redirectUrl`. If the reload fails, the shopper stays on the page, including when a later retry succeeds. With neither value set, registration does not navigate
- **EPAccountRegistrationField** — Name, email, username, password, or confirm-password input for the Registration Form Provider. Registers with that form and renders its own validation error. Does not publish the value. Name, email, and password are required. Username is required only when that field is present, and then it is sent separately from email. Confirm password is checked only when that field is present, and it is never sent
- **EPAccountProfileFormProvider** — Profile form boundary inside the Account Provider. Edits the signed-in member's name and email and publishes only `$ctx.accountProfileFormData` (`status`, `error`, `isSubmitting`). A normal Studio button calls this Provider's `submit()` ref action. `submit()` no-ops in the Plasmic canvas. At runtime it sends only the fields the shopper changed, then the Account Provider reloads. Nothing is sent when no field changed. If the write succeeds and the reload fails, the shopper stays signed in and the form reports that the account could not be refreshed
- **EPAccountProfileField** — Name or email input for the Profile Form Provider. Shows the value from `$ctx.account.accountMember` until the shopper edits it, and keeps that edit if the account reloads. Does not publish the value
- **EPAccountGate** — Renders children when `$ctx.account` matches a condition (`authenticated`, `anonymous`, `selected`, `lapsed`). Consumes the Provider boundary; does not fetch
- **EPAccountField** — Displays one `$ctx.account` value (member id, member name, member email, or a selected or lapsed organisation name or id). Name and email are empty when the shopper is anonymous, the account is loading, or the profile is absent. Consumes the Provider boundary
- **EPAccountAddressProvider** — Reads the selected organisation's saved addresses with `identity.accountAddresses()` and publishes `$ctx.accountAddresses` (`status`: `loading | ready | empty | error`, `addresses`, `total`, `error`: `{ code, message } | null`). Place it inside EP Account Provider. It takes no account id, token, filter, or path, and it has no reload action. A normal Studio button calls this Provider's `delete(addressId)` ref action with `$ctx.currentAccountAddress.id`. `delete` no-ops in the Plasmic canvas, does nothing while a delete is in progress, and does nothing again for an address that has already been deleted. At runtime it sends `identity.deleteAccountAddress({ id })` with that trimmed id, then reads the book again. The row stays until that read commits. While that cycle is in progress, every row's `$ctx.accountAddressDeleteData.isDeleting` is true, and only the address being deleted has `status: "deleting"`. Other rows stay `idle` with no error. If the delete succeeds and the read fails, that row stays `deleted` and the error is `account_addresses_refresh_failed`: `The saved address was deleted, but the address list could not be refreshed.` A later delete of a different address is still possible. While `$ctx.account.isLoading` is true, including logout and a reload of the same organisation, status is `loading`, `addresses` is empty, and it does not call. If that reload settles on the same selected organisation, the committed book is shown again without another call. A selected account loads the collection: rows are `ready`, and `{ addresses: [], total }` is `empty`. No selected organisation publishes `error` / `no_selected_account` and does not call. A lapsed organisation publishes `error` / `account_lapsed` and does not call. No account member, or no `$ctx.account`, publishes `error` / `no_account_member`. A failed read publishes `error` with `epIdentityErrorCode()` and the identity error message. `addresses` is empty unless `status` is `ready`. Changing the selected account publishes `loading` and no rows on that render, then loads the new organisation. After a successful create or delete, the address provider reads the book again. That read keeps the current rows visible until it commits, and it is not a Studio reload action. Preview State is Studio only: `auto` shows two sample addresses; `withAddresses`, `empty`, `loading`, `error`, `noSelectedAccount`, and `lapsed` force that state on the canvas. The canvas never calls `identity.accountAddresses()`. Published pages ignore Preview State
- **EPAccountAddressList** — Repeats its children for each address when `$ctx.accountAddresses.status` is `ready`. Each row publishes `$ctx.currentAccountAddress` (the `EpAccountAddress`, including `id`), `$ctx.currentAccountAddressIndex`, and `$ctx.accountAddressDeleteData` (`status`: `idle | deleting | deleted | error`, `error`: `{ code, message } | null`, `isDeleting`). `status` and `error` belong to that row. `isDeleting` is true on every row while any delete and its address-book read are in progress. A row button disables from `isDeleting` and shows `error.message` without comparing address ids. Loading, empty, and error render no rows. The row layout is whatever you put in the slot
- **EPAccountAddressField** — Displays one field of `$ctx.currentAccountAddress`. Choice values are `name`, `first_name`, `last_name`, `company_name`, `phone_number`, `instructions`, `line_1`, `line_2`, `city`, `county`, `region`, `postcode`, and `country`. A missing value is an empty string. With no current address at runtime it renders nothing. `id` stays on `$ctx.currentAccountAddress` and is not a field choice
- **EPAccountAddressFormProvider** — Creates a saved address for the selected organisation. Place it inside EP Account Address Provider. Owns the address drafts internally and publishes only `$ctx.accountAddressFormData` (`status`: `idle | submitting | submitted | error`, `error`: `{ code, message } | null`, `isSubmitting`). A normal Studio button calls this Provider's `submit()` ref action. `submit()` no-ops in the Plasmic canvas. The default slot is First Name, Last Name, Line 1, City, County, Postcode, and Country. Required is on for each of those except City. That setting is per field: a blank field with Required on shows `This field is required.` and the form error `Please complete the required fields.`, and create is not called. A field with Required off does not block submit. At runtime a complete submit sends `identity.createAccountAddress` with only the non-empty trimmed fields, then the address provider reads the book again. An Elastic Path 400 is shown as that response's detail, or its title when detail is absent. Success clears the drafts and sets `submitted`. If the create succeeds and the address-book read fails, the form stays `submitted` and reports that the saved address was created but the address list could not be refreshed. It does not navigate
- **EPAccountAddressFormField** — One address input for the Address Form Provider. The choice is the same thirteen fields as EP Account Address Field, and the label is optional. `name` remains a choice and is not in the default slot. `required` is a Studio boolean, off unless set, and controls the required marker, the empty-field error, and whether that field blocks submit. `country` is a dropdown of country names with an empty "Select country" option and submits the ISO alpha-2 code, such as `PK` for Pakistan. The other fields are text inputs. Renders its own validation error. Read-only in the Studio canvas and while the form is submitting; the country dropdown is disabled in those states. Does not publish the value and does not read the current address

### Variations
- **EPVariationPicker** / **EPVariationOptionList** / **EPVariationOptionTrigger** — Product variant selection
- **EPVariationField** / **EPVariationOptionField** — Variant display

### Bundles
- **EPBundleProvider** — Bundle configuration
- **EPBundleComponentList** / **EPBundleOptionList** — Bundle structure
- **EPBundleOptionTrigger** / **EPBundleOptionField** — Option selection
- **EPBundleVariationPicker** — Bundle variant selection
- **EPBundlePriceField** / **EPBundleValidationErrors** — Bundle metadata

### Stock / Inventory
- **EPStockProvider** — Multi-location inventory
- **EPLocationPicker** / **EPLocationField** — Location selection
- **EPStockField** — Stock level display

### Catalog Search
- **EPCatalogSearchProvider** — InstantSearch over the store's Catalog Search index. See [Choosing a listing path](COMPONENTS.md#3-choosing-a-listing-path)
- **EPSearchBox** / **EPSearchHits** / **EPSearchPagination** — Search UI
- **EPSearchInfiniteHits** — Search results with load more, appended in place
- **EPRefinementList** / **EPHierarchicalMenu** / **EPRangeFilter** — Faceted filtering. In Studio, the attribute is picked from a list of the fields the store's catalog search can filter on, read through the design-time route. A filter with no attribute set renders nothing on a page and adds nothing to the search. On the canvas it shows "Choose a field" and names the prop to set
- **EPSearchStats** / **EPSearchSortBy** — Search metadata
- **EPSearchTypeahead** — Search box for a site header that lists a few products as the shopper types. Needs no EP Catalog Search Provider and loads no InstantSearch. See [A search box in the site header](COMPONENTS.md#a-search-box-in-the-site-header)

## Styling contract (catalog-search components)

The catalog-search components ship behaviour, not appearance. Every visual
choice — typography, colour, spacing, borders, focus state — is the
designer's. The components do not impose a default look that the designer
later has to override.

The contract that every catalog-search component honours:

1. **`className` lands on the visible interactive element.** The Plasmic
   style panel binds to a single class per component instance. We forward
   that class to the element designers actually want to style:

   | Component | Element that receives `className` |
   | --- | --- |
   | `EPSearchBox` | n/a — provider only, no DOM (see below) |
   | `EPCatalogSearchProvider` | the wrapper `<div data-ep-catalog-search-provider>` |
   | `EPSearchHits` | the grid `<div data-ep-search-hits>` |
   | `EPSearchInfiniteHits` | the wrapper `<div data-ep-search-infinite-hits>`; the grid inside it is `<div data-ep-search-hits>` |
   | `EPRefinementList` | the wrapper `<div data-ep-refinement-list>` |
   | `EPHierarchicalMenu` | the wrapper `<div data-ep-hierarchical-menu>` |
   | `EPRangeFilter` | the wrapper `<div data-ep-range-filter>` |
   | `EPSearchPagination` | the wrapper `<div data-ep-search-pagination>` |
   | `EPSearchStats` | the wrapper `<div data-ep-search-stats>` |
   | `EPSearchSortBy` | the wrapper `<div data-ep-search-sort-by>` |
   | `EPSearchTypeahead` | the `<form data-ep-search-typeahead>`; the dropdown takes **Panel Style** and each hit **Hit Style** |

2. **No inline `style` for appearance properties.** The components never set
   `border`, `border-radius`, `padding`, `font-*`, `color`, `background`, or
   `box-shadow` inline. CSS specificity goes class-wins-over-element, so
   designer styles always reach the rendered DOM.

3. **Inline `style` is permitted only for layout properties Plasmic strips.**
   Plasmic's canvas filters out `display`/`grid-*`/`flex-*` styles set on a
   code-component instance. `EPSearchHits` works around this by setting its
   grid layout inline, and exposing the values as `gridTemplateColumns` /
   `gridGap` props so designers can still control them.

4. **The editor and the runtime render the same DOM.** No mock-only inline
   styling that lies about runtime output — what the designer sees in the
   Plasmic canvas is what the live site renders. Test coverage in
   `__tests__/catalog-search-components.test.tsx` enforces this.

### Structural CSS via `:where()`

The components do need a small amount of structural CSS — for example,
`position: relative` on the autocomplete root, so its absolute-positioned
panel can anchor. We ship that CSS once per page from
`headless-styling.ts`, scoped via `:where()` so every selector has zero
specificity and any designer class always wins.

If you add a new catalog-search component, follow the same pattern:

```tsx
import { useHeadlessStyling } from "./headless-styling";

export function EPNewSearchComponent({ className, ...props }) {
  useHeadlessStyling();
  return <div className={className} data-ep-new-search-component="">…</div>;
}
```

Then add a contract test alongside the existing ones in
`__tests__/catalog-search-components.test.tsx` via `describeHeadlessStylingContract`.
The helper asserts (a) the className lands on the documented leaf, (b) no
inline appearance styles are set anywhere in the rendered tree, and (c) the
editor and runtime renders produce the same root tag.

### Composing EPSearchBox

`EPSearchBox` is a provider, not a renderer. It exposes search-field state
to its slot children and otherwise renders nothing. The visible chrome —
the `<input>`, the clear `<button>` — is owned by the designer. Drop a
Plasmic-controlled input and button into the slot and wire them via
`$ctx.searchFieldData` and the registered ref-actions.

| What `EPSearchBox` exposes | Type | Use it for |
| --- | --- | --- |
| `$ctx.searchFieldData.value` | `string` | the controlled value of the input element |
| `$ctx.searchFieldData.displayValue` | `string` | the query that has actually been refined (diverges from `value` during the debounce window) |
| `$ctx.searchFieldData.isEmpty` | `boolean` | hide the clear button when nothing is typed |
| `setValue(value: string)` ref-action | | call from the input's `onChange` interaction |
| `clear()` ref-action | | call from the clear button's `onClick` interaction |

Wiring a fresh EPSearchBox in Plasmic Studio:

1. Drop an `<input>` (Plasmic's built-in tag, **not** a code component) into
   the EPSearchBox slot. Style it freely from the style panel — appearance
   reaches the live site because the input is a Plasmic-controlled tag.
2. Set the input's `value` attribute to a dynamic value: `$ctx.searchFieldData.value`.
3. Add an `onChange` interaction → custom function: `EP_SEARCH_BOX_REF.setValue(event.target.value)`,
   where `EP_SEARCH_BOX_REF` is the ref to the parent EPSearchBox instance.
4. Drop a `<button>` (also a Plasmic-controlled tag) for clear. Style it
   freely.
5. Add the button's `onClick` → custom function: `EP_SEARCH_BOX_REF.clear()`.
6. Bind the button's visibility to `!$ctx.searchFieldData.isEmpty` so it
   only shows when there's something to clear.

Why this composition: Plasmic's codegen filters appearance styles
(`padding`, `border`, `background`, `font-*`, `color`, `border-radius`,
`box-shadow`) off any code-component instance — only the Plasmic-controlled
tags (`input`, `button`, `div`, etc.) escape the filter. By making
EPSearchBox a render-children-only provider, the visible chrome is owned
by tags the designer fully controls. See PRD #308 for the long-form
rationale.

### Composing EPSearchPagination

`EPSearchPagination` follows the same provider pattern. The default slot
ships an `hbox` with `Prev` button, page-indicator text, and `Next` button
so a fresh drop renders working chrome shape — the designer wires the
behaviour.

| What `EPSearchPagination` exposes | Type | Use it for |
| --- | --- | --- |
| `$ctx.searchPaginationData.currentPage` | `number` | zero-indexed current page |
| `$ctx.searchPaginationData.totalPages` | `number` | total page count |
| `$ctx.searchPaginationData.hasPrev` | `boolean` | hide Prev button when false |
| `$ctx.searchPaginationData.hasNext` | `boolean` | hide Next button when false |
| `$ctx.searchPaginationData.pages` | `number[]` | page-number buttons array |
| `goToPage(page: number)` ref-action | | call from a page-number button's `onClick` |
| `prevPage()` ref-action | | call from the Prev button's `onClick` |
| `nextPage()` ref-action | | call from the Next button's `onClick` |

Wiring a fresh EPSearchPagination in Plasmic Studio:

1. The default slot already contains a Prev button, a page text, and a
   Next button — restyle them freely from the style panel.
2. Replace the page-text content with a dynamic expression, e.g.
   `` `Page ${$ctx.searchPaginationData.currentPage + 1} of ${$ctx.searchPaginationData.totalPages}` ``.
3. Wire the Prev button's `onClick` → invoke ref-action `prevPage` on the
   EPSearchPagination instance. Bind its visibility to
   `$ctx.searchPaginationData.hasPrev`.
4. Wire the Next button's `onClick` → invoke ref-action `nextPage`. Bind
   its visibility to `$ctx.searchPaginationData.hasNext`.

### Composing EPSearchInfiniteHits

`EPSearchInfiniteHits` is `EPSearchHits` with load more: each page of results
is added below the ones already shown. Cards get the same `currentProduct`,
`currentHit` and `currentProductIndex`. Use it instead of `EPSearchHits` and
`EPSearchPagination`, not with them.

| What `EPSearchInfiniteHits` exposes | Type | Use it for |
| --- | --- | --- |
| `$ctx.searchInfiniteHitsData.isLastPage` | `boolean` | hide the Load More button when true |
| `$ctx.searchInfiniteHitsData.isFirstPage` | `boolean` | hide the Load Previous button when true |
| `loadMore()` ref-action | | call from the Load More button's `onClick` |
| `loadPrevious()` ref-action | | call from the Load Previous button's `onClick` |

The page number goes in the URL, as with `EPSearchPagination`. A shopper who
reloads after loading more starts on that page, so put a button in the
**Load Previous Button** slot to load the pages above it.

### Composing EPSearchSortBy

`EPSearchSortBy` exposes the active sort and a `setSort` ref-action.
The recommended slot pattern is a native `<select>`:

| What `EPSearchSortBy` exposes | Type | Use it for |
| --- | --- | --- |
| `$ctx.sortByData.currentValue` | `string` | bind to the `<select>`'s `value` attribute |
| `$ctx.sortByData.options` | `Array<{value, label}>` | normalised options as `useSortBy` sees them |
| `setSort(value: string)` ref-action | | call from the `<select>`'s `onChange` |

The `items` prop accepts two shapes:

1. **Ergonomic (recommended)** — `{ field, direction, label }`:
   ```js
   [
     { label: "Most Relevant" },                                                   // default/unsorted
     { field: "price.USD.float_price", direction: "asc",  label: "Price: Low to High" },
     { field: "price.USD.float_price", direction: "desc", label: "Price: High to Low" },
     { field: "name", direction: "asc", label: "Name: A to Z" },
   ]
   ```
   Components compose `${indexName}/sort/${field}:${direction}` internally —
   the format the EP catalog-search-instantsearch-adapter parses. Field
   names are Typesense field paths on the EP catalog index (`name`, `sku`,
   `price.<currency>.float_price`, `created_at`, etc.).

2. **Raw (escape hatch)** — `{ value, label }` where `value` is the full
   indexName like `"search/sort/foo:asc"`. Use when you need to bypass
   the composer.

If the parent `EPCatalogSearchProvider` uses a non-default `indexName`,
set the matching value on the `indexName` prop here too — otherwise the
composed sort URLs target the wrong index.

Wiring a fresh EPSearchSortBy in Plasmic Studio:

1. Drop a `<select>` (Plasmic-controlled tag) into the slot.
2. Bind its `value` attribute to `$ctx.sortByData?.currentValue`.
3. Add `<option>` children for each sort entry — the option's `value`
   attribute should match the composed `value` from `$ctx.sortByData.options`
   (i.e. `$ctx.sortByData.options[N].value`), or hardcode if you know
   the indexName.
4. Wire the `<select>`'s `onChange` interaction → invoke ref-action
   `setSort` on the EPSearchSortBy instance with arg `event.target.value`.
### Migration notes

Before this contract was in place, `EPSearchBox` and `EPCatalogSearchProvider`
shipped polished default styles inline. Designers who relied on those
defaults will need to re-style the component from the Plasmic style panel
after upgrading. The defaults were misleading — they appeared in the canvas
preview but only some applied at runtime — so a clean reset is healthier
than continuing to ship the lie.

PRD #308 also moved EPSearchBox from a chrome-rendering component to a
provider. Existing EPSearchBox instances will lose their input and clear
button; re-author the slot per the wiring steps above.

## One entry point per export

The root entry's ES module, `dist/index.esm.js`, re-exports every export by
name from the per-module files under `dist/esm`. A bundler keeps only the
modules an import needs. But a loader may bundle all of a project's pages at
once and split the code into shared chunks. Then every module that any page
imports through the root goes into a chunk that every page loads. For that
loader, every root export is also its own entry point, named after the export:

```js
import { EPProductGrid, EPProductListProvider as List } from "@elasticpath/plasmic-ep-commerce-elastic-path";
```

becomes

```js
import { EPProductGrid } from "@elasticpath/plasmic-ep-commerce-elastic-path/EPProductGrid";
import { EPProductListProvider as List } from "@elasticpath/plasmic-ep-commerce-elastic-path/EPProductListProvider";
```

Each entry point re-exports one name from the module that defines it. Every
source module is its own ESM file under `dist/esm`, so two entry points on one
page share one copy of each module they both need. `./exports-map.json` lists
every root export with its subpath: `{ "EPProductGrid": "./EPProductGrid", … }`.

- **Root imports and entry points can be mixed.** The root's ES module
  re-exports the same files, so a bundle with both still has one copy of each
  module. Only a CommonJS `require` of the root, which is one bundle, adds a
  second copy, with its own module state. Every root export has an entry point,
  or the build fails. Leave an import on the root if it is a namespace import
  (`import * as`), or if the installed package has no `exports-map.json`.
- The files are `.js` ESM for bundlers, for the same reason as the root's
  `index.esm.js` ([ADR-0007](docs/adr/0007-root-entry-stays-esm-js.md)). Each
  starts with `"use client"`, as the root does. They have no type
  declarations: import types from the root.

`sideEffects` in `package.json` lets a bundler drop a file whose exports go
unused. Only `dist/esm/cart-provider/swr-cart-cache.js` does work when it is
imported: it registers the cart cache that cart writes update. A module that
does work when it is imported must be listed there too, or a bundler can drop
it. `dist/index.esm.js` imports every listed module, so any import of the root
still runs that work, as it did when the root was one bundle. The root files
and the `/server` builds are listed too, so bundlers treat them as before.
`./src/**` is listed so that this package's own root build treats the source
files as before.
