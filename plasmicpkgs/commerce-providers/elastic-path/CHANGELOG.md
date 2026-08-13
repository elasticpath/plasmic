# Changelog

## Unreleased

### Breaking

The shopper's Elastic Path access token no longer reaches the browser. It was
previously serialized into page HTML as `globalContextsProps.serverToken`,
readable by any script on the page.

Cart and checkout now always run through the server routes. The browser-direct
Elastic Path SDK cart path, and the `serverCartMode` toggle that selected
between them, are gone.

**Removed hooks** — all four called the Elastic Path SDK directly from the
browser using the leaked token:

| Removed | Replacement |
| --- | --- |
| `cart/use-cart` | `useCart` from `shopper-context` |
| `cart/use-add-item` | `useAddItem` from `shopper-context`, or `EPAddToCartButton` |
| `cart/use-update-item` | `useUpdateItem` from `shopper-context` |
| `cart/use-remove-item` | `useRemoveItem` from `shopper-context` |

**Removed provider surface** — `getElasticPathProvider` and
`getCommerceProvider` no longer take a `serverToken` argument, and the returned
provider no longer carries `cart`. `initElasticPathClient` takes credentials
only; its client serves catalog reads and mints its own anonymous token from
the public `clientId`.

**Removed from the storefront** — drop the `globalContextsProps` entry that fed
`session.providerProps()` into `PlasmicClientRootProvider`. `providerProps()`
now returns `{}`.

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
