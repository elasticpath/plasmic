# Hostless Component Discovery

Covers gap #22 (partial — status clarification) and gap #23 (hostless component discovery via MCP).

## Context

### Gap #22 Status (add-package HTTP 500)
The MCP implementation of `project.add-package` is correct. The HTTP 500 is a server-side
failure on the EP Plasmic instance — no recent PR has fixed it. Workaround remains: add packages
via Studio UI (Project Settings → Packages). No MCP code change is needed for the 500 itself.

`list-available-packages` and a basic `list-package-components` (names only) were implemented
in PR #163 on `feat/prod-bootstrap` but have **not** been merged to `master` or the current
branch (`feat/mcp-design-enhancements`). This spec covers bringing those in and extending
`list-package-components` to return full inspect-style output.

### Gap #23 — What Was Missing
Once a hostless package is installed, there was no MCP action to discover which components it
provides or what props those components accept. The only workaround was to place a component
manually in Studio and then read the tree.

## Jobs to Be Done

- As a developer using the MCP, I want to discover which packages are available to install so I
  can know what to add without opening Studio.
- As a developer using the MCP, I want to list the components a package provides — with prop
  schemas — so I can call `node.add` and `node.update-props` correctly without guessing names or
  types.

## New Actions

### `project.list-available-packages`

Lists packages available in the Plasmic catalog (reads from `/api/v1/app-config`
`hostLessComponents`). Marks each package as installed or not based on current
`site.projectDependencies`.

**Input**: none (uses current project session)

**Output** (array of `AvailablePackage`):
```
{
  name: string           // Display name, e.g. "Elastic Path Commerce"
  projectId: string | string[]  // Source project ID(s) for add-package
  sectionLabel: string   // Catalog section, e.g. "Commerce"
  isInstalled: boolean
  items: [{
    componentName: string  // Exact name for node.add
    displayName: string
    description?: string
    imageUrl?: string
  }]
  codeName?: string
  codeLink?: string
  imageUrl?: string
}
```

**Error**: if app-config endpoint unavailable, return empty array (not an error).

### `project.list-package-components`

Lists components from installed hostless packages with full prop schemas. Reads from the
already-bundled `site.projectDependencies` — no extra server round-trip required.

**Input**:
- `packageName?: string` — if provided, filter to a single package by name

**Output** (array of `PackageComponent`):
```
{
  packageName: string
  packageProjectId: string
  name: string           // Exact name for node.add
  displayName: string
  description?: string
  props: [{
    name: string         // Prop name for node.update-props
    type: string         // "string" | "number" | "boolean" | "slot" | "object" | "array" | ...
    required: boolean
    defaultValue?: string  // serialised default (omit if none)
    description?: string
    isSlot: boolean      // true if this is a slot param (accept PlasmicElement)
  }]
}
```

The `props` array is derived from `component.params` on the bundled component object.
For each param:
- `name`: `param.variable?.name ?? param.name`
- `type`: inferred from `param.typeTag` or `param._type` or `param.type?._type`
- `required`: `param.required ?? false`
- `defaultValue`: serialise `param.defaultExpr` if present (CustomCode → code string)
- `description`: `param.description ?? param.displayName`
- `isSlot`: `!!param.tplSlot || param.typeTag === "SlotParam"`

**Error**: if `packageName` is provided but not installed, throw descriptive error with hint
to check `project.list-packages`.

## Acceptance Criteria

- [ ] `project.list-available-packages` returns catalog entries with `isInstalled` correct
- [ ] `project.list-available-packages` returns empty array (not error) when app-config unavailable
- [ ] `project.list-package-components` with no filter returns all components from all installed packages
- [ ] `project.list-package-components` with `packageName` filter returns only that package's components
- [ ] Each component entry includes `props` array with `name`, `type`, `required`, `isSlot`
- [ ] `project.list-package-components` with unknown `packageName` throws descriptive error
- [ ] Both actions are registered in `server.ts` under the `project` tool domain
- [ ] Both actions have unit tests (mocked WAB)
- [ ] Both actions appear in the `project` tool description/few-shot examples

## Happy Path — Component Discovery

1. Developer calls `project.list-packages` — confirms `commerce-elastic-path` is installed
2. Developer calls `project.list-package-components` (no filter) — sees `plasmic-commerce-cart`
   with props `{ name: "children", isSlot: true }`, etc.
3. Developer calls `node.add` with `componentName: "plasmic-commerce-cart"` — succeeds
4. Developer calls `node.update-props` using prop names from step 2 — succeeds

## Happy Path — Catalog Discovery

1. Developer calls `project.list-available-packages` — sees all catalog packages with
   `isInstalled: false` for those not yet added
2. Developer notes the `projectId` for the desired package
3. Developer calls `project.add-package` with that `projectId`

## Edge Cases

| Scenario | Expected behaviour |
|----------|--------------------|
| No packages installed | `list-package-components` returns `[]` |
| Package has no reusable components | That package does not appear in results |
| app-config endpoint returns 500 | `list-available-packages` returns `[]` silently |
| `packageName` filter with wrong casing | Case-insensitive match, or throw with message listing installed names |
| Param has no type info | `type: "unknown"`, `isSlot: false` |
| `add-package` returns HTTP 500 (server bug) | Error surfaces as-is with message "add-package failed — try adding via Studio UI (Project Settings → Packages)" |

## Implementation Notes

- Port `listAvailablePackages` from `feat/prod-bootstrap:packages/plasmic-mcp/src/package-manager.ts`
- Port `PackageComponent` and `AvailablePackage` types from `feat/prod-bootstrap:packages/plasmic-mcp/src/types.ts`
- Port basic `listPackageComponents` from `feat/prod-bootstrap`, then **extend** to include `props`
- Register both in `server.ts` `project` tool handler, alongside existing `list-packages`

## Out of Scope

- Fixing the server-side `add-package` HTTP 500 (server issue, not MCP)
- Listing components from packages not yet installed (catalog browsing without installation)
- Fetching prop metadata from a remote endpoint (must use bundled data only)
