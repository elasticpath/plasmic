# Implementation Plan

_Last updated: 2026-03-04_

## Priority 1 — Hostless Package Management (spec: PROJECT-PACKAGE-MANAGEMENT.md)

**Branch:** `feat/hostless-package-management`
**Status:** P1.1–P1.5 complete. All 1,778 tests pass (33 files).

### P1.1 — New API client methods in `api-client.ts` ✓
- **Completed:** 2026-03-04
- **What:** Add 4 new HTTP methods to `PlasmicApiClient` that the package management actions need
- **Methods:**
  - `getPkgByProjectId(projectId: string)` → GET `/api/v1/pkgs/projectId/{projectId}`
  - `getPkgVersion(pkgId: string, version?: string)` → GET `/api/v1/pkgs/{pkgId}/versions/{version}`
  - `getPkgVersionMeta(pkgId: string)` → GET `/api/v1/pkgs/{pkgId}/versions/meta`
  - `getAppAuthPubConfig(projectId: string)` → GET `/api/v1/projects/{projectId}/app-auth-pub-config`
- **Files modified:**
  - `packages/plasmic-mcp/src/api-client.ts` — added 4 methods
  - `packages/plasmic-mcp/src/__tests__/api-client.test.ts` — added unit tests for each method
- **Reference:** Studio calls these via `this._sc.appCtx.api.*` in `platform/wab/src/wab/client/ProjectDependencyManager.ts:334-370`
- **Verification:** Confirm exact URL patterns by checking `platform/wab/src/wab/client/api.ts` proxy list (lines 478-496) and server routes

### P1.2 — WAB shared imports: type declarations + mocks ✓
- **Completed:** 2026-03-04
- **What:** Declare WAB shared functions in `wab-externals.d.ts` and create corresponding mocks for unit tests
- **Declarations added to `wab-externals.d.ts`:**
  - `@/wab/shared/core/tagged-unbundle`: `unbundleProjectDependency`
  - `@/wab/shared/core/project-deps`: `extractTransitiveDepsFromComponentDefaultSlots`, `extractTransitiveHostLessPackages`, `syncGlobalContexts`, `upgradeProjectDeps`
  - `@/wab/shared/core/sites`: `isHostLessPackage`, `getNonTransitiveDepDefaultComponents`, `isReusableComponent`
- **Mock files created:**
  - `packages/plasmic-mcp/src/__mocks__/wab-tagged-unbundle.ts`
  - `packages/plasmic-mcp/src/__mocks__/wab-project-deps.ts`
  - `packages/plasmic-mcp/src/__mocks__/wab-sites.ts`
- **Updated:** `vitest.config.unit.ts` — added resolve aliases for new mock modules
- **Reference:** Source locations:
  - `platform/wab/src/wab/shared/core/tagged-unbundle.ts:32` — `unbundleProjectDependency`
  - `platform/wab/src/wab/shared/core/project-deps.ts:270,300,523` — deps utilities
  - `platform/wab/src/wab/shared/core/sites.ts:1420,2219` — site utilities
- **Note:** esbuild `build.mjs` already resolves `@/wab/shared/*` to real WAB source — no build config changes needed

### P1.3 — New `package-manager.ts` module ✓
- **Completed:** 2026-03-04
- **What:** Create `packages/plasmic-mcp/src/package-manager.ts` with clean exported functions that wrap WAB shared imports
- **Exports:**
  - `listPackages(site, apiClient?)` — reads `site.projectDependencies`, optionally fetches latest versions via `getPkgVersionMeta`
  - `addPackage(site, bundler, tplMgr, apiClient, projectId, ownProjectId)` — full flow: getPkgByProjectId → validate → getPkgVersion → unbundle → canAddDependency checks → addDependency
  - `removePackage(site, tplMgr, pkgIdOrName)` — validate no dependents → `tplMgr.removeProjectDep(dep)`
  - `upgradePackage(site, bundler, tplMgr, apiClient, pkgId?)` — single or batch upgrade via `upgradeProjectDeps`
- **Validation logic replicated from `ProjectDependencyManager`:**
  - Self-import check (line 336-338)
  - No published versions check (line 344-346)
  - Already imported check (line 349-351)
  - Auth-enabled dependency check (line 353-359)
  - Circular dependency check (`canAddDependency` line 240-284)
  - Version conflict check (line 276-283)
  - Hostless dependent check for removal (`getHostLessPackageDependents` line 407-420)
- **Files created:**
  - `packages/plasmic-mcp/src/package-manager.ts`
  - `packages/plasmic-mcp/src/__tests__/package-manager.test.ts`

### P1.4 — Wire 4 new actions into `server.ts` (project tool) ✓
- **Completed:** 2026-03-04
- **What:** Add `list-packages`, `add-package`, `remove-package`, `upgrade-package` to the project tool's action enum and switch cases
- **Zod schema extensions:**
  - `action: z.enum([...existing, "list-packages", "add-package", "remove-package", "upgrade-package"])`
  - `projectId: z.string().optional()` — for `add-package` (source project of the package)
  - `pkgId: z.string().optional()` — for `remove-package`, `upgrade-package`
- **Switch cases:** Delegated to `package-manager.ts` functions, formatted responses
- **Files modified:**
  - `packages/plasmic-mcp/src/server.ts` — action enum, Zod schema, switch cases
  - `packages/plasmic-mcp/src/__tests__/project.test.ts` — added unit tests for all 4 actions
- **Action count:** 104 → 108 actions across 8 tools
- **Updated:** `README.md`, `FEATURE_REFERENCE.md`, `index.ts` header comment — action counts

### P1.5 — Integration test coverage ✓
- **Completed:** 2026-03-04
- **What:** Integration tests that use real WAB shared code (via `vitest.config.integration.ts`) to verify package management operations against actual MobX-observed WAB model instances
- **Design:** Only `unbundleProjectDependency` and `upgradeProjectDeps` are mocked (fixtures provide project revision bundles, not PkgVersion bundles). All other WAB functions run for REAL: `isHostLessPackage`, `isReusableComponent`, `TplMgr`, `extractTransitiveHostLessPackages`, `syncGlobalContexts`, `getNonTransitiveDepDefaultComponents`.
- **Scenarios covered (22 tests):**
  - listPackages: returns PackageInfo, populates latestVersion, graceful failure, real `isHostLessPackage`
  - addPackage: self-import error, no published versions error, already-imported error (real model comparison), auth-enabled error, success with real MobX mutation, real transitive extraction, circular dependency detection, version conflict detection
  - removePackage: real MobX removal, case-insensitive name removal, not-found error, hostless dependent error (real `isHostLessPackage`)
  - upgradePackage: not-installed error, already-at-latest error, batch all-current, single upgrade, batch upgrade
- **Files created/modified:**
  - `packages/plasmic-mcp/src/__tests__/package-manager.integration.test.ts` — 22 integration tests
  - `packages/plasmic-mcp/vitest.config.integration.ts` — added to include list
  - `packages/plasmic-mcp/vitest.config.unit.ts` — added to exclude list

---

## Completed Items (previous branch work)

### P1.4 (prev) — Fix `project.list` HTTP 500 (query param encoding) ✓
- **Completed:** 2026-03-04

### P1.3 (prev) — `packages/plasmic-mcp/FEATURE_REFERENCE.md` ✓
- **Completed:** 2026-03-04

### P1.2 (prev) — Fix `project.list` HTTP 500 — SUPERSEDED by P1.4 (prev)

### P1.1 (prev) — `node.update-props` action ✓
- **Completed:** 2026-03-04

---

## Known Limitations (non-blocking)

| Limitation | Location | Notes |
|-----------|----------|-------|
| Mixin-inherited styles not resolved in inspect output | `tree-reader.ts:14` | MVP limitation — inspect shows only direct VariantSetting styles, not resolved mixin styles |
| Rich text marks cannot combine with dynamic text | `edit-tools.ts:1743` | Use `update-text` with `dynamic:true` instead of `update-rich-text` for dynamic content |
| No interactive/OAuth auth | `auth.ts:6` | Pre-configured credentials only (env vars or `.plasmic.auth` file) |
| `component.create-page/create/clone` don't support dryRun | `server.ts` | Server-side API operations that cannot be previewed |

## Notes

- **Branch context:** `feat/hostless-package-management`
- **Action count:** 108 actions across 8 tools
- **Scope:** This plan is scoped to `packages/plasmic-mcp/` only. EP commerce gaps are tracked separately.
- **Spec:** `.ralph/specs/PROJECT-PACKAGE-MANAGEMENT.md`
- **Key WAB reference:** `platform/wab/src/wab/client/ProjectDependencyManager.ts` — the Studio implementation this feature replicates
- **Build mechanism:** esbuild `build.mjs` already resolves `@/wab/shared/*` to real WAB source files. Unit tests use mocks via Vite aliases. Integration tests use real WAB source.
- **No TODOs/FIXMEs/skipped tests** found in existing `packages/plasmic-mcp/src/`
