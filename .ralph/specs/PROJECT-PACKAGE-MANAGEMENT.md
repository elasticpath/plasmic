# Hostless Package Management — Consumer Flow

## Jobs to Be Done

- As an MCP user (AI agent or developer), I want to list which hostless packages are installed in my project so that I know what code components are available
- As an MCP user, I want to add a hostless package to my project by projectId so that its code components become available for `node.add` without manual Studio intervention
- As an MCP user, I want to remove a hostless package from my project so that I can clean up unused dependencies
- As an MCP user, I want to upgrade an installed package to its latest published version so that I get bug fixes and new components
- As an MCP user, I want to upgrade all outdated packages at once so that my project stays current

## Acceptance Criteria

### list-packages
- [x] New `list-packages` action on the `project` tool
- [x] Returns all direct dependencies from `site.projectDependencies`
- [x] Each entry includes: `name`, `pkgId`, `projectId`, `version`, `isHostLess` (boolean)
- [x] Optionally fetches latest available version from server to show which packages have updates (`latestVersion` field)

### add-package
- [x] New `add-package` action on the `project` tool
- [x] Accepts `projectId` (the source project of the published package) — matches Studio's `addByProjectId`
- [x] Calls `getPkgByProjectId(projectId)` to get published package info
- [x] Calls `getPkgVersion(pkgId)` to download full PkgVersion + transitive dep bundles
- [x] Calls `unbundleProjectDependency(bundler, latest, depPkgs)` to deserialize into ProjectDependency model
- [x] Validates: not self-import, not already imported, no circular deps, no version conflicts, no auth-enabled deps — mirrors the same validation logic Studio uses
- [x] Pushes to `site.projectDependencies`, extracts transitive deps, syncs global contexts, copies default components — reuses `addDependency` logic from Studio
- [x] Returns: package name, pkgId, version, number of components made available

### remove-package
- [x] New `remove-package` action on the `project` tool
- [x] Accepts `pkgId` (or package name for convenience)
- [x] Validates no hostless packages depend on it — mirrors Studio's `getHostLessPackageDependents` check
- [x] Calls `tplMgr.removeProjectDep(dep)` — matches Studio's `removeByPkgId`
- [x] Returns confirmation of removal

### upgrade-package
- [x] New `upgrade-package` action on the `project` tool
- [x] Accepts `pkgId` (single package) OR no pkgId (upgrade all outdated)
- [x] For single: downloads new PkgVersion, unbundles, validates, calls `upgradeProjectDeps([targetDep])` — mirrors Studio's per-dependency upgrade
- [x] For batch: identifies all packages with newer versions, downloads all, calls `upgradeProjectDeps(allTargetDeps)` — mirrors Studio's "Update all"
- [x] `upgradeProjectDeps` handles component/token/mixin/asset/variant remapping — reuse from WAB shared `project-deps.ts`
- [x] Pre-flight `ensureCanUpgradeDeps` check detects transitive version conflicts before mutating the model — mirrors Studio's guard
- [x] Returns: list of packages upgraded with old→new version

### Shared
- [x] All new API client methods added: `getPkgByProjectId`, `getPkgVersion`, `getPkgVersionMeta`, `getAppAuthPubConfig`
- [x] Uses `FastBundler` + `unbundleProjectDependency` from WAB shared code (direct import, not recreated)
- [x] Validation logic mirrors Studio's `ProjectDependencyManager` — `canAddDependency` and `ensureCanUpgradeDeps` are reimplemented locally because the Studio versions live in the client-only class (`wab/client/ProjectDependencyManager.ts`), not in `@/wab/shared/*`
- [x] Changes are saved via the existing save mechanism (auto-save or explicit `project.save`)

## Happy Path

### Adding a package
1. User has a project loaded via `project.set`
2. User calls `project.add-package` with `projectId` of the desired hostless package
3. MCP fetches the published package info → downloads the full PkgVersion bundle
4. Unbundles into a ProjectDependency, validates, pushes to site
5. Returns success: `Added "EP Commerce" (v1.2.3) — 15 components now available`
6. User can now use `node.add` with component names from the package

### Listing packages
1. User calls `project.list-packages`
2. Returns: `[{ name: "EP Commerce", pkgId: "pkg-123", projectId: "proj-456", version: "1.2.3", isHostLess: true, latestVersion: "1.3.0" }]`

### Removing a package
1. User calls `project.remove-package` with `pkgId: "pkg-123"`
2. MCP validates no dependents, removes from site
3. Returns: `Removed "EP Commerce" (v1.2.3)`

### Upgrading
1. User calls `project.upgrade-package` with `pkgId: "pkg-123"`
2. MCP fetches latest version, unbundles, validates version compatibility
3. Calls `upgradeProjectDeps` which remaps all component instances, tokens, etc.
4. Returns: `Upgraded "EP Commerce" from v1.2.3 → v1.3.0`

### Batch upgrade
1. User calls `project.upgrade-package` with no pkgId
2. MCP identifies all packages with newer versions
3. Downloads all, validates, upgrades in one pass
4. Returns: `Upgraded 3 packages: EP Commerce (1.2.3→1.3.0), Plasmic Form (2.0.0→2.1.0), ...`

## Edge Cases

| Scenario | Expected Behaviour |
|----------|-------------------|
| projectId has no published versions | Error: `Project "xyz" has no published versions.` (matches Studio) |
| Package already imported | Error: `"xyz" has already been imported.` (matches Studio) |
| Self-import (importing own project) | Error: `You cannot import the current project.` (matches Studio) |
| Circular dependency detected | Error with details about which dep is circular (matches Studio's `canAddDependency`) |
| Version conflict in transitive deps | Error with conflicting package name and versions (matches Studio) |
| Dependency has auth enabled | Error: `You cannot import "xyz" because it has auth enabled.` (matches Studio) |
| Remove package that others depend on | Error: `Cannot remove "pkg" because it is a dependency of: X, Y` (matches Studio's hostless dependent check) |
| Upgrade with version conflicts | Error from `ensureCanUpgradeDeps` with conflict details (matches Studio) |
| No packages installed | `list-packages` returns empty array |
| Upgrade when already on latest | `upgrade-package` returns: `"EP Commerce" is already at latest version (1.3.0)` |
| Upgrade all but nothing outdated | Returns: `All packages are up to date` |
| Package name used for remove instead of pkgId | Resolve name to pkgId from site.projectDependencies, or error if not found |
| No project loaded | Error: `No project loaded. Call project.set first.` (existing pattern) |

## Implementation Notes

### New API Client Methods
Add to `packages/plasmic-mcp/src/api-client.ts`:
- `getPkgByProjectId(projectId: string)` → GET `/api/v1/pkgs/projectId/{projectId}`
- `getPkgVersion(pkgId: string, version?: string)` → GET `/api/v1/pkgs/{pkgId}/versions/{version}`
- `getPkgVersionMeta(pkgId: string)` → GET `/api/v1/pkgs/{pkgId}/versions/meta`
- `getAppAuthPubConfig(projectId: string)` → GET `/api/v1/projects/{projectId}/app-auth-pub-config`

### WAB Shared Imports (direct, not recreated)
- `unbundleProjectDependency` from `@/wab/shared/core/tagged-unbundle`
- `extractTransitiveDepsFromComponentDefaultSlots`, `extractTransitiveHostLessPackages`, `syncGlobalContexts` from `@/wab/shared/core/project-deps`
- `upgradeProjectDeps` from `@/wab/shared/core/project-deps`
- `isHostLessPackage` from `@/wab/shared/core/sites`
- `getNonTransitiveDepDefaultComponents` from `@/wab/shared/core/sites`
- `FastBundler` from `@/wab/shared/bundler`

### New Module
- `packages/plasmic-mcp/src/package-manager.ts` — wraps WAB imports into clean functions: `listPackages`, `addPackage`, `removePackage`, `upgradePackage`, `upgradeAllPackages`
- `packages/plasmic-mcp/src/server.ts` — add 4 new actions to project tool switch + Zod schemas

### Zod Schema Extensions (project tool)
```
action: "list-packages" | "add-package" | "remove-package" | "upgrade-package"
projectId: string (for add-package)
pkgId: string (for remove-package, upgrade-package — optional for upgrade-all)
```

## Out of Scope

- Package publishing (creating PkgVersions from a project)
- Package search/discovery (browsing available packages)
- Version pinning (always uses latest published version)
- Creating new hostless package projects
- Insertable templates management
- Plume site management
