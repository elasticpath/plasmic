# Hostless Component Reachability Fix

## Jobs to Be Done

- As an AI build loop, I want to add hostless package components (e.g. commerce, commerce-elastic-path) to any page via `node.add` so that I can build storefront pages without deleting and recreating them
- As an AI build loop, I want to set any prop on a hostless component instance at any time via `node.update-props` so that I can bind dynamic URL params, state, and context values after page creation
- As an AI build loop, I want to populate slot children on hostless component instances so that commerce collection components render custom card layouts, category links, and field labels
- As an AI build loop, I want batch failures to roll back completely (including component creations) so that I don't have to manually clean up orphaned components
- As an AI build loop, I want reliable state after batch failures so that subsequent operations don't cascade into stale-state errors

## Root Cause Analysis

### The Reachability Problem (Gaps #26 and #29)

Three MCP operations fail when touching hostless package components:

| Operation | Error | Model object |
|-----------|-------|-------------|
| `node.add` with hostless component | `Unreachable instance (Component)` | TplComponent.component ref |
| `node.update-props` creating new Arg | `Unreachable instance (PropParam)` | Arg.param ref |
| `node.add`/`update-props` slot children on hostless | `Unreachable instance (SlotParam)` | Arg.param ref for slot |

**Working path (create-page):** The body JSON is sent to the Plasmic server API, which calls `elementSchemaToTpl(site, component, body)` server-side. The server has its own Bundler that knows all dependency addresses. When it saves, the server's bundler correctly emits hostless component/param references as `__xref` (external references).

**Failing path (node.add / update-props):** The MCP calls `studioElementSchemaToTpl(site, undefined, element, opts)` client-side, creating TplComponent and Arg instances locally. When `FastBundler.fastBundle()` runs to save, it must classify every referenced instance as either `__ref` (internal, must be reachable) or `__xref` (external, lives in a dependency bundle). The failing path produces `__ref` for hostless Component/PropParam instances instead of `__xref`, causing them to appear in the bundle without a strong parent -- triggering the `assertFastBundleInvariants()` check at `platform/wab/src/wab/shared/bundler.ts:1258`.

**How Studio avoids this:** Studio's `StudioCtx` initializes the `FastBundler` with full knowledge of all dependency instance addresses (via `unbundle()` of the complete project + dependency graph). When Studio creates TplComponent nodes via `mkTplComponentX()` and Arg objects via `setTplComponentArg()`, the bundler already has every hostless Component and PropParam registered in `_uid2addr` with the correct dependency uuid. `mkRefAndMaybeVisit()` compares `addr.uuid === projectUuid` and correctly emits `__xref` for dependency instances.

**Why the MCP fails:** The MCP's bundler initialization or instance registration does not correctly track hostless package instances from the dependency tree. When `fastBundle()` encounters a reference to a hostless Component/PropParam, it either (a) doesn't find the instance in `_uid2addr` and assigns it to the project uuid, or (b) has the instance registered with the wrong uuid. Either way, it emits `__ref` instead of `__xref`.

### Key Code Paths

| File | Function | Role |
|------|----------|------|
| `packages/plasmic-mcp/src/edit-tools.ts:2628` | `plasmicElementToTpl()` | Calls `studioElementSchemaToTpl(site, undefined, ...)` for node.add |
| `packages/plasmic-mcp/src/edit-tools.ts:2497` | `updateProps()` | Calls `setTplComponentArg()` which creates new Arg with hostless PropParam |
| `packages/plasmic-mcp/src/save-manager.ts:72` | `saveChanges()` | Calls `fastBundle(site, projectId, changedInsts)` |
| `platform/wab/src/wab/shared/bundler.ts:963` | `mkRefAndMaybeVisit()` | Decides `__ref` vs `__xref` based on `_uid2addr` lookup |
| `platform/wab/src/wab/shared/bundler.ts:1258` | `assertFastBundleInvariants()` | Throws "Unreachable instance" error |
| `platform/wab/src/wab/shared/core/tpls.ts:440` | `mkTplComponentX()` | Creates TplComponent with component reference |
| `platform/wab/src/wab/shared/TplMgr.ts:300` | `setTplComponentArg()` | Creates Arg with param reference to hostless PropParam |
| `platform/wab/src/wab/shared/code-components/code-components.ts:2703` | `elementSchemaToTpl()` | Server-side working path for create-page |
| `packages/plasmic-mcp/src/model-loader.ts:115` | model loading | Initializes bundler parent tracking for fastBundle |

### Silent Slot Child Dropping

`component.create-page` with hostless components in the body tree accepts slot children without error but `childCount: 0` on inspection. The server-side `elementSchemaToTpl` likely resolves slot children correctly for project-local components but drops them for hostless components because the slot Param lives in the dependency tree.

### Batch Rollback Incompleteness

When a batch fails mid-operation, `component.create` side effects (new Component added to `site.components`) persist because batch rollback only undoes the failed operation's changes, not prior successful operations in the batch. Studio's undo system handles this via a full undo log; the MCP's batch manager may not capture component creation as an undoable operation.

## Acceptance Criteria

### Core Reachability Fix

- [ ] `node.add` with `{type: "component", name: "<hostless-component-name>"}` succeeds for any installed hostless package component
- [ ] `node.update-props` can set a prop for the first time (create new Arg) on a hostless component instance
- [ ] `node.update-props` can set dynamic expressions (`{{$ctx.params.slug}}`) on hostless component props
- [ ] `node.update-props` continues to work for updating existing props on hostless components (regression guard)
- [ ] `component.create-page` with hostless components in body tree continues to work (regression guard)
- [ ] After any hostless component operation, `fastBundle()` produces a valid incremental bundle that the server accepts
- [ ] The fix does not modify any upstream WAB files (or modifies them minimally per merge strategy)

### Slot Children

- [ ] `node.add` with `slot: "children"` populates slot content on hostless component instances
- [ ] `node.update-props` with PlasmicElement value for a slot prop populates the slot on hostless instances
- [ ] `component.create-page` body tree with hostless components containing children results in `childCount > 0` on inspection
- [ ] Slot children on project-local components continue to work (regression guard)

### Batch Rollback

- [ ] When a batch fails mid-operation, all prior component creations in that batch are rolled back (deleted from `site.components`)
- [ ] After a failed batch, `component.list` does not include components that were part of the failed batch
- [ ] After a failed batch, subsequent operations work without requiring `project.refresh`

### Stale State

- [ ] After a batch failure and automatic rollback, the in-memory model state is consistent -- no `project.refresh` required
- [ ] If automatic state recovery is not possible, the error message explicitly instructs the user to call `project.refresh`

## Happy Path

1. `project.set({projectId: "..."})` -- load project with installed hostless packages
2. `project.list-package-components({packageName: "commerce"})` -- discover available hostless components
3. `node.add({componentUuid: "<page>", parentRef: "<container>", child: {type: "component", name: "plasmic-commerce-product-collection"}})` -- add hostless component to existing page
4. `node.update-props({componentUuid: "<page>", nodeRef: "<product-collection>", props: {count: 8, category: "{{$ctx.params.slug}}"}})` -- set props including dynamic bindings
5. `node.add({componentUuid: "<page>", parentRef: "<product-collection>", slot: "children", child: {type: "component", name: "plasmic-commerce-product-box"}})` -- populate slot with another hostless component
6. Save succeeds, page renders correctly with live commerce data

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Hostless component not installed | Clear error: "Component X not found. Install the package first via project.add-package or Plasmic Studio." |
| Hostless component prop name doesn't exist | Clear error listing available props (already works) |
| Nested hostless components in slot (e.g. product-link > product-field) | Both components instantiated correctly with proper parent-child references |
| Mixed tree: hostless + project-local components in same add | All components instantiated correctly |
| Hostless component added to another hostless component's slot | Works -- cross-package references handled |
| Batch with mix of hostless and local operations | All operations succeed or all roll back atomically |
| update-props setting slot prop with PlasmicElement containing hostless component | Slot populated with hostless component instance |
| Removing a hostless component instance via node.remove | Works (already works -- regression guard) |
| update-props with `null` to remove a prop on hostless component | Arg removed successfully |

## Implementation Guidance

### Approach: Match Studio's Bundler Initialization

The fix should ensure the MCP's `FastBundler` has the same knowledge of dependency instance addresses that Studio's does. Investigate:

1. **model-loader.ts** (`packages/plasmic-mcp/src/model-loader.ts`): How does unbundle register dependency instances? Compare with Studio's `StudioCtx` initialization.
2. **`FastBundler.initFastBundleParentTracking()`**: Is this called with all dependency instances, or only project-local ones?
3. **`_uid2addr` population**: After unbundle, do all hostless Component, PropParam, and SlotParam instances have correct addresses with their dependency uuids?

### Upstream Merge Strategy

Per project conventions, prefer new files over modifying existing upstream WAB files. If the fix requires changes to `bundler.ts` or other WAB files, keep them minimal. Consider adding a wrapper or helper in `packages/plasmic-mcp/src/` that ensures proper bundler state before operations that create cross-dependency references.

### Testing Strategy

- Unit tests: Mock a site with hostless package dependencies, create TplComponent/Arg instances referencing hostless objects, verify fastBundle produces valid bundles
- Integration tests: Use real WAB engine with a test site containing hostless packages, exercise node.add and update-props for hostless components
- Regression tests: Ensure create-page with hostless body, node.add for local components, and update-props for existing args all continue working
