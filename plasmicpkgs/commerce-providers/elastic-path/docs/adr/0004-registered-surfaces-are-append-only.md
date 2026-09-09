# ADR-0004: Registered surfaces are append-only, and breaks are concentrated

## Status

Accepted (2026-09-07)

Split out of ADR-0003, which decides the token architecture. This is the
constraint every removal hits, whatever the reason for it, so it is recorded on
its own.

## Context

This package is published as a hostless bundle, so Plasmic's `publish-hostless`
step is a gate that a normal npm package does not have. It rejects a package that
removes a registered component or a published prop, and the repair path exists
only in Studio's client.

The failure is in the publish step, not in anyone's project, so **customer count
is irrelevant to it**. That matters, because the token-architecture work started
from "no external customers, so prefer clean removal over deprecation shims" —
a premise that does not reach this guard at all.

The package has already paid for this twice, in the same release:

- 0.5.0 removed a component outright and could not be published as a hostless
  bundle. 0.5.1 re-registered it as deprecated.
- 0.5.0 also removed a prop and a ref action, and 0.5.2 re-registered both as
  deprecated and **inert** — the prop hidden in Studio and not threaded into the
  query, the ref action a no-op so an interaction already wired to it does not
  throw.

Two recovery releases for a much smaller mistake than the one this rule now
guards against.

## Decision

### Three classes, not two

- **Internal modules — delete freely.** Nothing enforces them.
- **Registered components, global contexts, slots and props — append-only,
  enforced.** Hard asserts in the publish step. This is what 0.5.0 hit twice.
- **Registered custom functions and code libraries — append-only by *our
  policy*, not by enforcement.** The equivalent asserts are commented out
  upstream since December 2024, and a registered function's signature counts as
  an update rather than a break.

We treat the third class as append-only anyway. Removal being *permitted* there
makes it worse rather than better: the failure moves out of the publish step,
where 0.5.0 caught it loudly, and into a designer's project as a silently broken
data query that nothing checks. This ADR records both the enforcement and the
choice, so a maintainer who later finds the commented-out assert knows we saw it.

### Inert registration

An **inert registration** is a registered surface kept alive solely because
hostless publishing forbids its removal — hidden or marked deprecated, doing
nothing. A husk that still threads props into a context nobody reads looks live
to the next reader, so the body is emptied, not just the behaviour.

House style, following upstream where it has a convention and keeping ours where
it does not:

- **Components and global contexts** take `"X (deprecated)"` in `displayName`.
  For a global context that is the only lever available.
- **Props** take `hidden: () => true` plus a description leading
  `"Deprecated — ignored."` Upstream has no prop convention, and its one example
  leaves a live-sounding description on a dead prop, which is worse than nothing.
- **Ref actions** take the same lead word, description-only; they cannot be
  hidden.

The description is part of the deprecation, not an afterthought. Leaving copy
that advertises a working feature is the failure this rule exists to prevent.

`hideFromContentCreators` **hides nothing from designers** — it feeds
content-editor mode only. Keep it on deprecated components, but its presence must
never be read as "designers cannot reach this".

### Breaks are concentrated, not spread

**Expand-then-contract.** Additive and internal changes ship in ordinary
non-breaking releases; the breaking set lands together in one release, last.

Slicing by feature area would put several breaks in flight at once against a
package where a bad break cannot be published at all and the repair path is
Studio-only. Concentrating them makes the risky release the *small* one, arriving
after the additive work is proven.

**Every intermediate version must be independently publishable as a hostless
bundle, with its consumer lockfiles bumped in the same commit** — the publish
pipeline installs with `--frozen-lockfile`, so bumping a manifest alone moves
nothing.

## Consequences

- A surface that turns out to be a mistake cannot be withdrawn. The cost of
  registering one is therefore higher than the cost of writing one, and new
  registered props are worth resisting on that ground alone.
- Deprecated surfaces accumulate. The package carries several already, and the
  token-architecture work adds more. There is no cleanup release that removes
  them.
- A newly **required** prop is a break, so validation that tightens an existing
  prop has to be a warning rather than an error.
- Documentation cannot use deprecation as a signal for "do not use this path",
  because a path may be undeprecatable while still not being the recommendation.
  ADR-0003's listing-path recommendation is stated in prose for exactly this
  reason: neither path can be removed, so neither carries a deprecation marker.
- The version number falls out of the issue set rather than being picked in
  advance. The package stays in 0.x until the architecture ADR-0003 locks is
  fully built and there is a first external customer.
