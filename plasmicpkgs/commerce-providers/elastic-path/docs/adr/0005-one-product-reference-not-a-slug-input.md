# ADR-0005: A single-product read takes one product reference, not a separate slug input

## Status

Accepted (2026-09-25)

## Context

EP Search Hits builds each product link as `prefix + "/" + (slug || id)`. EP
Product Provider and `ep.getProduct` read a product by id only, and the
provider's own prop description told designers to bind its product ID to
`$ctx.params.slug`. On a store whose products carry slugs, every product page
rendered "Product not found". On a store with no slugs the link fell back to
the id and everything worked, which is why this survived development.

Consumers wrote the slug-to-id conversion themselves. The Next.js app host did,
and minted its own anonymous token to run the lookup — a second path to Elastic
Path identity, which ADR-0003 rules out.

The original issue asked for a new `slug` input on `ep.getProduct` and a new
`slug` prop on EP Product Provider.

## Options

1. **Add explicit `slug` inputs** beside the existing `id` / `productId`.
2. **Widen the existing inputs** to accept a *product reference*: the
   product's slug when it has one, otherwise its id.

## Decision

Option 2. The provider's `productId` prop and `ep.getProduct`'s `id` param
keep their registered names and accept a product reference. Only the display
name ("Product ID or slug") and the descriptions change, and neither is a
break.

- Under ADR-0004 every registered surface is permanent. A `slug` input would
  be a second way to say the same thing, forever.
- The value arriving at the boundary is already "slug or id" by construction —
  the link builder emits either, and the page param carries whatever the link
  held. A designer binding one param cannot know which it will be, so asking
  them to pick an input asks a question they cannot answer.
- Every project that followed the old prop description (`productId` bound to
  `$ctx.params.slug`) starts working on upgrade with no rebinding.

**Lookup order.** A UUID-shaped reference is read by id, and by slug only when
no product has that id. Any other reference is read by slug only. A slugless
store and a slug store both pay one request; only a UUID-shaped slug pays two,
and a merchant would have to author one by hand. A slug equal to a different
product's id is accepted as pathological and not guarded.

The slug read is the filtered list read `eq(slug,…)` with the same `include`
set as the single read; it returns the same `included` block and per-product
`meta`, so the rest of the loader cannot tell which lookup found the product.
The shopper catalog's filter syntax has no quoting, so a reference outside
`A-Z a-z 0-9 - _ .` names no product and sends no request rather than drawing a
400 from the filter parser that would read as a failed store.

**Not found is not "could not fetch".** A reference that names no product
resolves to `null`. A read that could not run is a failure. At runtime the
provider renders Empty Content for one and Error Content for the other. On the
Studio canvas a reference that finds nothing renders Empty Content, while the
sample product remains for no reference and for a failed read.
`ep.getProduct` keeps the fail-soft contract every `ep.*` read has and returns
`null` for both; telling them apart across the server functions is #478.

The resolution lives in one helper that both the server function and the
client hook call for their first read, so moving the hook onto the server
function (#540) removes a caller rather than a second copy.

## Consequences

The registered name `productId` now accepts something that is not an id. The
display name and the CONTEXT.md term carry the meaning; the name does not.

The app host's own slug lookup, page-param rewrite and bundle-config extraction
become deletable once this is published and its Studio project is rebound to
`$ctx.params.slug`.
