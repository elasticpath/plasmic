# ADR-0001: One origin trust list — the proxy derives CORS from `trustedOrigins`

## Status

Accepted (2026-08-04)

## Context

Two independent origin allowlists gated browser access:

- better-auth's `trustedOrigins` — validates the `Origin` header on every
  auth endpoint (including internal synthetic requests such as
  `persistCartId`'s hop to `/ep/cart`). Secure default: the app's `baseURL`.
- The proxy route's `allowedOrigins` — a hand-rolled CORS reflection list
  with an insecure production default (`localhost:3003`), added in PR #289
  for Plasmic Studio's cross-origin preview panel.

Both lists express the same fact — "this origin may act as the shopper" —
but were maintained separately. Divergence produced a known silent failure:
Studio's origin passed the proxy's CORS check, then the mutation's cart-id
persistence died on a swallowed 403 at the better-auth boundary because
`trustedOrigins` did not include Studio. It also left a localhost default
shippable to production (security finding #279 MEDIUM-1).

## Decision

`trustedOrigins` is the single origin trust list. The proxy derives its
CORS allowlist from the auth instance's resolved `trustedOrigins`; the
`allowedOrigins` option is removed outright (no deprecation alias — the
package is pre-1.0 and the removal rides the 0.2.0 hardening release).

"Resolved" means what better-auth itself resolves, not merely what the
caller passed: the configured list, plus the `baseURL` origin, plus
`BETTER_AUTH_TRUSTED_ORIGINS`. Exposing only the caller's array would make
`config.trustedOrigins` a strict subset of what the auth endpoints accept,
so an origin added by env var would pass better-auth and be rejected by the
proxy and the origin gate — the same split-brain this ADR removes.
The proxy's matcher honors the same wildcard-pattern semantics better-auth
uses (e.g. `https://*.vercel.app`), implemented in-package because
better-auth's matcher is not public API.

Cross-origin Studio use is therefore one knob: add the Studio origin to
`trustedOrigins`.

## Consequences

- The insecure proxy default is deleted, not guarded — #279 MEDIUM-1
  dissolves; production inherits better-auth's secure default (own origin).
- The proxy/auth allowlist mismatch class (silent cart-id loss from Studio)
  is structurally impossible: any origin the proxy accepts is an origin
  better-auth trusts.
- Coupling accepted: an origin trusted for auth is automatically
  CORS-readable on the proxy. We judge the two meanings identical; a future
  need to split them would require reintroducing a second list with an
  explicit rationale.
- Wildcard entries in `trustedOrigins` widen both surfaces at once — the
  deployment-hardening docs must say so.
- The origin gate keeps Go's `CrossOriginProtection` behaviour of comparing
  the `Origin` against the request's own `Host` before consulting the list.
  An explicit `trustedOrigins` replaces the defaults rather than extending
  them, so without that check a deployment that lists only a Studio origin
  would reject its own storefront's mutations from any client that omits
  `Sec-Fetch-Site`.
