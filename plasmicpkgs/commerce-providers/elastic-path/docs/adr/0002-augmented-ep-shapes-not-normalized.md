# ADR-0002: Products and carts keep Elastic Path's shape and are augmented, not normalized

## Status

Accepted (2026-08-18). Amended 2026-10-15: the cart id exception. Amended
2026-10-20: `withoutShipping`.

## Context

The `Product` and `Cart` types this package publishes to `$ctx` descend from
`@plasmicpkgs/commerce`, a Shopify-lineage abstraction. They flattened Elastic
Path's response into a foreign vocabulary — `variants`, `options`, `path`,
`variantId`, `price.value`, `currency.code` — and in doing so re-derived money
(`amount / 100`, wrong for zero-decimal currencies), collapsed three distinct
cart totals into one tax-inclusive figure, and invented fields Elastic Path
does not have.

The obvious replacement was a normalized-but-EP-flavoured shape: keep flattening,
just rename to Elastic Path's words and promote the fields designers actually
bind. That was rejected. A flattened shape — however well named — still means a
designer reading Elastic Path's API documentation cannot use what they read.
Every flattening decision (which of `with_tax`/`without_tax` becomes `price`?
does `name` come from `attributes` or the root?) is a private convention that has
to be learned separately from the platform itself.

## Decision

The published types are Elastic Path's own response shapes, verbatim, augmented
with only what a Studio binding expression cannot compute:

- `images` — Elastic Path returns `relationships.main_image.data.id`; the URL is
  in `included.main_images[].link.href`. A binding cannot do that join.
- `variations` — `meta.variations`, in the merchandiser's `sort_order`.
- `childProducts` — flattened out of `meta.variation_matrix`, a recursively
  nested map of option-id combinations to child product ids.
- `priceFrom` on a base product, which carries no `display_price` of its own —
  the lowest price among its children.
- `items` on a cart — Elastic Path side-loads them under `included` — and
  `itemCount`, the quantity sum over those items. Elastic Path exposes only a
  line count (`relationships.items.data.length`); the quantity sum is what a
  cart badge shows, and both cart field pickers already publish it as a saved
  binding choice.
- `withoutShipping` on a cart — the checkout writes its shipping charge into
  the cart as a line (SKU `__ep_shipping`). `items` and `itemCount` leave that
  line out, so Elastic Path's `meta` and `promotions` include money no listed
  line explains. `withoutShipping.meta` and `withoutShipping.promotions` are
  those values less the line and what a code took off it. A binding cannot
  compute them, because the line is not in `items`. With no shipping line
  they are Elastic Path's own values; otherwise they are derived, and
  `formatted` comes from `Intl`. `meta` and `promotions` are never changed.

Money is never re-derived. Each price is a `Money` carrying Elastic Path's
integer amount, currency, display-ready `formatted` string, and a decimal
computed from the currency's real exponent — never a fixed hundredth.

Consequently there is no `raw` escape hatch, because the type *is* the raw shape.

### Exception: the cart id

`Cart` leaves out Elastic Path's `id` and `links`. `links.self` is the cart's
URL, which contains the id. The id alone grants read and write access to the
cart, so it stays on the server
([ADR-0003](0003-one-session-for-elastic-path-identity.md)). Server code that
needs the id reads it before it normalises the cart, or from the session.

`relationships` and `payment_intent_id` stay. They hold the ids of lines,
customers, accounts and promotions, and the Stripe PaymentIntent id. None of
them is the cart id.

## Consequences

Elastic Path's API documentation becomes the binding reference. `$ctx.currentProduct`
is what the docs describe, and anything the docs mention is reachable without the
package having anticipated it.

Every existing designer binding breaks. `$ctx.currentProduct.name` becomes
`.attributes.name`, `.price` becomes `.meta.display_price.without_tax`. The
`EPProductField` catalog absorbs this — saved selections store the leaf **id**,
so keeping `name`/`price`/`sku` stable while moving their paths preserves them —
but raw `$ctx` bindings across the live Studio projects need a rebinding pass.
This is paid once and was accepted deliberately.

A binding to `$ctx.cart.id` or `$ctx.cart.links` resolves to nothing. The
Elastic Path documentation describes both, so this is the one place where
`$ctx` leaves out a field the documentation describes.
