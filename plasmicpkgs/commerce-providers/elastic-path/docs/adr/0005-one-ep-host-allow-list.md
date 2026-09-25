# ADR-0005: One EP host allow-list, extended not replaced, admitted at mint

## Status

Accepted (2026-09-25)

## Context

The EP API host a storefront talks to is read from the EP Provider in the
Plasmic bundle. Designers edit the bundle, so the host is untrusted input and is
checked against an allow-list before any credential is sent to it.

Three functions applied that check: `createEpAuth`, `extractEpProviderConfig`
and `buildEpCtx`. Each took its own `hostAllowlist` option and each fell back to
the defaults when it was omitted. A rejected host is logged and dropped, so an
operator who passed the list to only some of them got a different silent
partial failure at each miss: pages classified as not configured for commerce,
Server Queries ran with the host stripped, or the auth routes talked to a different host
from the pages. Nothing checked that the three agreed. Both consumers of the
package had written the same env-var parsing and the same three-way threading.

This is the split-brain ADR-0001 removed for origins.

## Decision

There is one **EP host allow-list**, and `createEpAuth` resolves it, in the same
place and the same way as `trustedOrigins` (ADR-0001): the defaults, plus the
`hostAllowlist` option, plus the comma-separated `EP_HOST_ALLOWLIST` environment
variable. It is frozen on `config.hostAllowlist`, next to `trustedOrigins`.

**Extend, not replace.** This is the one departure from ADR-0001, where an
explicit `trustedOrigins` replaces the defaults. The default hosts are all
operated by Elastic Path, so keeping them widens trust to no third party, and
"also allow my custom domain" is the only reason anyone sets the option.
Replacing has no safety net here: trusted origins fall back to the request's
own Host, and hosts have no equivalent, so a list naming only a custom domain
would lock out the real region host the moment the bundle pointed back at it.

**Admitted at mint.** A bundle-supplied host is admitted once, by the plugin,
after `resolveConfig` returns and before the token is minted. The admitted host
and client id are written into the shopper envelope, which is already the sole
input to identity (ADR-0003). `buildEpCtx` reads them from the session and takes
no bundle and no list.

**Two access paths, one value.** The plugin hands the resolved list to the
consumer's `resolveConfig` callback, so that closure never has to reference the
auth instance it is being passed into. Any other caller of
`extractEpProviderConfig`, such as page classification, reads
`epAuth.config.hostAllowlist`. The extractor's list is required, with no
default, so a missed list is a type error. The extractor keeps using the list to
tell the EP Provider apart from another commerce provider's global context.

**`createEpAuth`'s own `host` is not checked.** It comes from the operator's
environment, not from the bundle, and it is where a rejected host falls back to.

## Consequences

- An operator sets a custom domain once, in code or by `EP_HOST_ALLOWLIST`
  alone, and every check sees it. The shared app host image carries no
  allow-list parsing.
- The pages and the auth routes use the same Elastic Path host by construction,
  because both read it from the envelope.
- A rejected host still logs and falls back rather than failing the request.
  How loud a rejection should be is not decided here.
- `buildEpCtx` and `extractEpProviderConfig` changed signature. Both are server
  API, not registered surfaces, so ADR-0004 does not constrain the break.
- There is no way to narrow the defaults. A deployment that must not reach an
  Elastic Path-operated host would need a second, explicit rationale to add one.
