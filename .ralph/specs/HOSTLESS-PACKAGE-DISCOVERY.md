# Hostless Package Discovery & Gap Fixes

Addresses gaps #22 and #23 from the MCP Server Gaps tracker, plus a new
`project.list-available-packages` action for browsing the installable package
catalog the same way Studio's Insert Panel does.

---

## Jobs to Be Done

- As an MCP user, I want to **fix `add-package` so it doesn't crash** (gap #22)
  so that I can actually install hostless packages without HTTP 500 errors.
- As an MCP user, I want to **list components provided by installed packages**
  (gap #23) so that I know what components are available to place on pages after
  installing a package.
- As an MCP user, I want to **browse the catalog of installable hostless packages**
  so that I can discover what packages exist and get their `projectId` before
  calling `add-package`.

---

## Background / Investigation Findings

### Gap #22 Root Cause

`package-manager.ts` calls the API client's `getPkgVersion` with the string
literal `"latest"` as the version.  The WAB server route does:

```typescript
const version = req.query.version ? JSON.parse(req.query.version) : undefined;
```

So it expects the query param to be a JSON-encoded string (e.g. `"\"latest\""`).
Passing the raw string `"latest"` causes `SyntaxError: Unexpected token 'l'`.

**Fix (MCP only — never touch WAB code):** When the MCP wants the latest version,
omit the `version` query parameter entirely (pass `undefined`).  The server
defaults to the latest version when `version` is not supplied.  If a specific
version is needed, it must be JSON-stringified before being sent as a query param.

### Package Discovery API

Studio's Insert Panel reads installable packages from `GET /api/v1/app-config`,
which returns a `config` object containing:

```typescript
config.hostLessComponents: HostLessPackageInfo[]
config.installables: Installable[]
```

`HostLessPackageInfo` shape (from `platform/wab/shared/devflags.ts`):

```typescript
interface HostLessPackageInfo {
  type: "hostless-package";
  name: string;              // Display name
  sectionLabel: string;      // Category label
  projectId: string | string[];  // One or more project IDs to add
  items: HostLessComponentInfo[]; // Components shipped by this package
  codeName?: string;
  codeLink?: string;
  imageUrl?: string;
  hidden?: boolean;
  showInstall?: boolean;
  hiddenWhenInstalled?: boolean;
  isInstallOnly?: boolean;
  whitelistDomains?: string[];
  whitelistTeams?: string[];
  onlyShownIn?: "old" | "new";
}
```

`HostLessComponentInfo` shape (investigate definition in devflags.ts during
implementation — expected fields: name, displayName, description, imageUrl,
thumbnailUrl, and any prop/slot metadata needed for downstream MCP tool calls).

### Gap #23: Listing Components from Installed Packages

Installed packages are `site.projectDependencies`.  Each is a
`ProjectDependency` whose `.site` contains the component tree of the upstream
package.  Components there are `TplComponent` instances accessible through the
embedded WAB engine already used by the MCP.

The discovery data (`hostLessComponents` from app-config) also contains
`items: HostLessComponentInfo[]` for each package, which is what Studio shows
in the Insert Panel.  The implementation should cross-reference both sources:

- Use `hostLessComponents.items` for rich metadata (descriptions, images)
- Use installed `ProjectDependency` site components for the authoritative list
  of what is actually available at runtime

---

## Acceptance Criteria

### Fix: `add-package` (gap #22)
- [ ] Calling `project.add-package` with a valid hostless package `projectId`
  no longer returns HTTP 500.
- [ ] The `api-client.ts` method that calls `GET /api/v1/pkgs/:pkgId` sends no
  `version` query param when requesting the latest version (not the raw string
  `"latest"`).
- [ ] If a specific version string must be passed, it is JSON-stringified before
  encoding into the query string.
- [ ] Existing unit tests for `addPackage` continue to pass.
- [ ] New unit test covers the "omit version → latest" code path.

### New action: `project.list-available-packages`
- [ ] Action calls `GET /api/v1/app-config` and extracts `hostLessComponents`.
- [ ] Returns an array of package records with at minimum:
  - `name` (display name)
  - `projectId` (string or string[]) — the value to pass to `add-package`
  - `sectionLabel` (category)
  - `isInstalled` boolean (cross-referenced against current project deps)
  - `items` array of component summaries (name + displayName at minimum)
  - `imageUrl`, `codeName`, `codeLink` when present
- [ ] Packages with `hidden: true` are excluded from results by default.
- [ ] Packages that are already installed are clearly marked `isInstalled: true`
  rather than omitted, so callers can check installed status.
- [ ] Action is registered on the `project` tool as action `list-available-packages`.
- [ ] Unit tests cover: empty catalog, filtering hidden packages, `isInstalled`
  flag calculation, single vs array `projectId`.

### New action: `project.list-package-components` (gap #23)
- [ ] Action accepts optional `packageName?: string` to filter to one package.
- [ ] Without a filter, returns components from ALL installed hostless packages.
- [ ] Each component record includes at minimum:
  - `packageName` — which package provides it
  - `packageProjectId` — the projectId of the providing package
  - `name` — internal component name
  - `displayName` — human-readable name
  - Plus any fields from `HostLessComponentInfo` needed for downstream tools
    (e.g. `description`, `imageUrl`, `thumbnailUrl`)
- [ ] Action is registered on the `project` tool as action `list-package-components`.
- [ ] Unit tests cover: no installed packages, single package with components,
  multiple packages, filter by package name, package name not found error.

### Integration
- [ ] `add-package` accepts a `projectId` returned by `list-available-packages`.
- [ ] After a successful `add-package`, the newly installed package appears in
  `list-package-components` output.
- [ ] All existing package-manager tests still pass.
- [ ] `npm test` passes with zero failures after changes.

---

## Happy Path

### Discovery → Install → Use

1. User calls `project.list-available-packages` → receives catalog with
   `isInstalled: false` for packages not yet in the project.
2. User picks a package (e.g. `{ name: "Ant Design 5", projectId: "antd5-id" }`).
3. User calls `project.add-package { projectId: "antd5-id" }` → success, no HTTP 500.
4. User calls `project.list-package-components { packageName: "Ant Design 5" }` →
   receives list of all Ant Design components available to place on pages.
5. User proceeds to use component editing tools to add those components to a page.

### Fix Verification

1. Developer calls `project.add-package` on any hostless package.
2. No HTTP 500 from server.
3. Package is added to project dependencies.

---

## Edge Cases

| Scenario | Expected behaviour |
|---|---|
| `list-available-packages` when `app-config` returns no `hostLessComponents` | Return empty array, no error |
| Package with `projectId` as array | Pass the full array (or first element) to `add-package` as appropriate |
| `list-package-components` when no packages installed | Return empty array, no error |
| `list-package-components` with unknown `packageName` | Return error: "Package not installed: {name}" |
| `add-package` called with a `projectId` already installed | Existing error: "Package already imported" (unchanged) |
| `list-available-packages` on a server that doesn't support `/api/v1/app-config` | Return empty array with a warning, don't crash |
| Version param sent as raw "latest" string | Never happens — fix ensures version param is always omitted or JSON-stringified |

---

## Implementation Notes

### Files to change

- `packages/plasmic-mcp/src/api-client.ts` — fix `getPkgVersion` call to omit
  version param (or JSON-stringify it); add `getAppConfig()` method calling
  `GET /api/v1/app-config`.
- `packages/plasmic-mcp/src/package-manager.ts` — fix the `"latest"` version
  string usage; add `listAvailablePackages()` and `listPackageComponents()`
  functions.
- `packages/plasmic-mcp/src/server.ts` — register two new actions on the
  `project` tool: `list-available-packages` and `list-package-components`.
- `packages/plasmic-mcp/src/__tests__/package-manager.test.ts` — add tests for
  all new functionality and the version-fix code path.

### Upstream merge safety

- **Do not modify** `platform/wab/` — all fixes in MCP packages only.
- New actions go on the existing `project` tool — no new tool domains.
- `getAppConfig()` is a new read-only API client method — additive, no conflicts.

### Action count impact

Current: 108 actions across 8 tools.
After this work: 110 actions (+ `list-available-packages`, + `list-package-components`).

---

## Out of Scope

- Modifying the WAB server (`platform/wab/`) for any reason.
- Adding, removing, or modifying `hostLessComponents` configuration in devflags.
- Support for `installables` (UI kits) — only `hostLessComponents` in scope.
- Filtering `list-available-packages` by category server-side (client can filter
  the returned array using `sectionLabel`).
- Gap #24 (devHost registry sync) — separate concern.
- Gap #21 (`project.list` HTTP 500) — separate concern.
