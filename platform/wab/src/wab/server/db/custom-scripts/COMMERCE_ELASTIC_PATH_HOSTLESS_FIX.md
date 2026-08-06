# commerce-elastic-path hostless publish fix

## Background

The `commerce-elastic-path` hostless canvas package project (in the hostless
workspace, project id `3JZRbA6LvhK83ns6Hqj5TS`) stopped publishing. The
"Publish Hostless Packages" workflow crashed with a bare
`{"name":"AssertionError"}` (the ECS logger drops `Error.message` when
JSON-serializing an error, so the real text never made it into the logs).

Root cause: commit `9b2e5e777` ("composable EP commerce components") reworked
`plasmic-commerce-ep-add-to-cart-button` from a monolithic component into a
composable one, dropping the `enableStockCheck` prop (stock checking moved to
the new `EPStockProvider`/`EPStockField`/`EPLocationPicker` components). The
hostless project's last successful publish predates that refactor
(`2026-01-09`, pkg_version `0.1.0`), so its stored site still had the old
prop. `updateHostlessPackage()` (`server/code-components/code-components.ts`)
correctly re-syncs and removes the obsolete param, but its own trailing
"nothing existing may be removed" safety assertion then throws about that
*after* the removal already happened -- purely reactive, no corrective
effect. Since `publishHostlessProjects()` (`PublishHostless.ts`) runs every
hostless project in one shared transaction with no per-project try/catch,
this one project throwing aborts the entire batch: no hostless package
publishes at all until it's resolved.

Confirmed non-issue for existing customer projects: when a project's stale
`commerce-elastic-path` dependency is auto-upgraded (`autoUpgradeHostless`,
on by default, checked on every bundle load), the dependency-upgrade code in
`shared/core/project-deps.ts` already handles a removed param by cleanly
deleting the corresponding arg -- no crash, no corruption. Confirmed nobody
is relying on `enableStockCheck` today, so the only effect is that prop
silently disappearing from any (currently nonexistent) usage.

## Scripts

Both are read/write DB scripts, not registered in `DbCustomScripts.ts` --
run them directly.

### `diagnose-commerce-elastic-path.ts`

Read-only. Reproduces `updateHostlessPackage()` against the real unbundled
site and prints the actual caught error message (bypassing the lossy
logger serialization), so you can see exactly which component/param is
failing without publishing anything.

```
npm run run-ts -- src/wab/server/db/custom-scripts/diagnose-commerce-elastic-path.ts --dburi <uri>
```

### `migrate-commerce-elastic-path.ts`

Writes. Runs the real `publishHostlessProject()` flow end to end: retries
`updateHostlessPackage()` past the expected "Deleted param/slot" and
"Component ... has been removed" errors (the underlying mutation already
applied correctly before the assertion fired -- see root cause above), then
runs `assertSiteInvariants`, saves a new project revision, and publishes.
Does not modify any shared application code -- only calls existing,
unmodified functions.

```
npm run run-ts -- src/wab/server/db/custom-scripts/migrate-commerce-elastic-path.ts --dburi <uri>
```

If re-run against an already-fixed project it's a no-op (the "no changes
detected" bundle-diff check short-circuits before publishing).

## Status

Already run once against the non-prod DB on 2026-08-06: bumped the
project's pkg_version from `0.1.0` to `0.2.0`. Verified `0.2.0` registers
`plasmic-commerce-ep-shopper-context` and `plasmic-commerce-ep-stripe-provider`
and no longer contains `enableStockCheck`.

Whether this also needs to be run against the environment the "Publish
Hostless Packages" GitHub Action actually targets depends on whether that's
the same database -- unconfirmed as of this writing.
