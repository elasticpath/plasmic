# ADR-0001: Implicit credentials only — the designer names the Custom API

## Status

Accepted (2026-08-13)

## Context

Every comparable connector in this repo — `@plasmicpkgs/cms`, `@plasmicpkgs/contentful`,
`@plasmicpkgs/strapi` — offers a dropdown of the remote collections and a typed
filter builder driven by fetched schema. A reader will reasonably ask why this
package makes the designer type a Custom API slug instead, and why its filter is
a raw string.

Both come from the same measured constraint. Populating a dropdown means reading
`/v2/settings/extensions/custom-apis`, which refuses an implicit token with 403
`gateway.scopes.authorise` — the detail names the *grant type*, not a permission,
and passing the store id header changes nothing. No store configuration lifts it:
the Custom API role policy resource carries only entry-level `create`/`list`/
`read`/`update`/`delete` booleans, so it cannot grant access to definition
endpoints, and the permissions API exposes standard roles read-only with no
endpoint binding a narrowed role to an application key.

That leaves `client_credentials` as the only credential that can read them — a
pair with full read and write across catalogue, orders, customers and payments,
which cannot be scoped down. Studio runs a registered query function and its
`fnContext` fetcher in the designer's browser, and the bundle carrying query
arguments is handed to a client component in this repo's own app-router example.
A secret in a query parameter must therefore be assumed to reach both designers
and shoppers.

Entry reads need none of this: probed against the integration store, an implicit
token reads `/v2/extensions/{slug}` and honours `filter`, `sort` and paging.

## Decision

The package holds no secret. It authenticates with an implicit token minted from
the client id, addresses entries at the slug-based extension endpoint, and the
designer names the Custom API. Filters are passed through verbatim as Elastic
Path filter expressions rather than built from fetched schema.

## Consequences

A designer gets no list of Custom APIs and no field metadata, so a mistyped slug
or field name surfaces as a runtime error rather than being unavailable to type.
Two mitigations follow from that: the 404 message names the slug and says where
to find the right one, and the 400 message carries Elastic Path's own filter
parse error verbatim, position and offending token included.

Only Custom APIs whose entries are readable by shoppers can be used. Where a
store has not granted that, the 403 message names the role policy to create.

Restoring the dropdown is not a package change but a decision about where an
admin credential lives — the app host's server environment behind its proxy
route, or a CMS backend route with per-store credential storage. Neither exists
today, and both are larger than the feature they would serve.
