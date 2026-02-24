# Plasmic MCP Incremental Writes (Milestone 2)

## Jobs to Be Done

- As a developer using Claude Code, I want to say "change the hero heading to Welcome Back" and have the MCP modify the existing page in-place, so that I can iterate on pages without recreating them.
- As a developer, I want to make multiple edits (add sections, tweak styles, rearrange layout) in a conversational loop and have each change persist, so that I can refine pages incrementally.
- As a developer, I want to update text or images across multiple pages from the terminal, so that I can do batch content updates (rebrand, copy changes) without opening Studio.
- As a developer, I want to edit shared components (Header, ProductCard), so that changes propagate everywhere the component is used.

## Architecture

### How Incremental Writes Work

M1's `create-page` tool uses a full round-trip: POST to REST API, then reload the entire project bundle. M2 introduces **in-memory editing** using the same mechanism as Plasmic Studio:

```
Developer: "change the hero title to Welcome Back"
    |
    v
Claude Code skill (interprets natural language)
    |
    v
MCP tool: update-text(componentUuid, nodeRef, "Welcome Back")
    |
    v
MCP server (in-memory):
    1. Locate TplTag node in the live Site model
    2. Mutate the model (MobX tracks the change)
    3. fastBundle() serializes only changed IIDs
    4. POST /api/v1/projects/{id}/revisions/{N+1} with incremental: true
    5. Server merges into stored bundle via Object.assign()
    |
    v
Server responds with new revision number
```

### Save Flow (mirrors Studio)

1. **MobX Change Tracking**: Call `observeModel(site, ...)` after unbundling. MobX records every field mutation as a `ChangeNode { inst, field }`.
2. **fastBundle()**: Pass recorded `changedInsts` to `FastBundler.fastBundle(site, uuid, changedInsts)`. Returns a partial Bundle containing only the changed IIDs and fields.
3. **HTTP POST**: `POST /api/v1/projects/{projectBranchId}/revisions/{N+1}` with:
   - `data`: stringified partial Bundle
   - `incremental: true`
   - `revisionNum`: current revision + 1
   - `toDeleteIids`: IIDs of removed nodes
   - `modifiedComponentIids`: component IIDs that changed
4. **Server Merge**: Server loads latest full bundle, applies `Object.assign(existing[iid], partial[iid])` for each changed IID, validates references, stores merged full bundle.
5. **Revision Update**: MCP server stores the new revision number for the next save.

### Optimistic Concurrency

The server enforces strict sequential revision numbers:
- MCP sends `revisionNum = lastKnownRevision + 1`
- If another user saved in between, server returns HTTP 412 `ProjectRevisionError`
- MCP detects this, reloads the project bundle, and warns the developer

### New Module Structure

All new code in new files within `packages/plasmic-mcp/src/` (upstream merge safety):

```
packages/plasmic-mcp/src/
├── change-tracker.ts      # MobX observation setup, change collection
├── model-editor.ts        # High-level edit operations on Tpl model
├── save-manager.ts        # fastBundle() + HTTP save + revision tracking
├── node-resolver.ts       # Find nodes by UUID, name, path, or description
└── undo-manager.ts        # Operation history and rollback
```

## New MCP Tools

### `update-text`
Update the text content of a node.
- **Params**: `componentUuid`, `nodeRef` (UUID or name), `text` (new content)
- **Behavior**: Finds the TplTag, updates its base variant text (RawText or creates new), triggers save.

### `update-styles`
Update CSS styles on a node.
- **Params**: `componentUuid`, `nodeRef`, `styles` (object of camelCase CSS properties)
- **Behavior**: Finds the TplTag, updates `vsettings[0].rs.values` entries, triggers save.

### `add-child`
Add a new child element to a container node.
- **Params**: `componentUuid`, `parentRef`, `child` (PlasmicElement JSON), `position` (optional: `"first"`, `"last"`, or index)
- **Behavior**: Converts PlasmicElement to TplTag (using the model's own constructors), inserts into parent's children array at position, triggers save.

### `remove-child`
Remove a child element from a container.
- **Params**: `componentUuid`, `nodeRef` (UUID or name of node to remove)
- **Behavior**: Finds the node, removes from parent's children array, triggers save. Records removed IID for `toDeleteIids`.

### `move-child`
Move a node to a different position or parent.
- **Params**: `componentUuid`, `nodeRef`, `newParentRef`, `position` (optional)
- **Behavior**: Removes from current parent, inserts into new parent at position, triggers save.

### `begin-batch`
Start a batch edit session (suppresses auto-save).
- **Params**: none
- **Behavior**: Sets a flag that accumulates changes without saving. Returns a batch ID.

### `end-batch`
End a batch session and save all accumulated changes in a single revision.
- **Params**: `batchId` (optional, for safety)
- **Behavior**: Calls `fastBundle()` with all accumulated changes, POSTs once, clears batch state.

### `undo`
Revert the most recent operation.
- **Params**: none
- **Behavior**: Pops the last operation from the undo stack, applies the inverse mutation to the model, triggers save.

### `refresh-project`
Reload the project bundle from the server.
- **Params**: none
- **Behavior**: Fetches fresh bundle, unbundles, replaces session state. Useful after a conflict or when another user has made changes.

### `save-project`
Explicitly save current in-memory changes (for manual control).
- **Params**: none
- **Behavior**: Runs `fastBundle()` on all accumulated changes and POSTs to server.

## Node Resolution

Nodes can be referenced by:
1. **UUID** — exact match (`nodeRef: "abc-123"`)
2. **Name** — component-scoped name match (`nodeRef: "Hero Title"`)
3. **Path** — dot-separated ancestor path (`nodeRef: "HeroSection.Title"`)
4. **Index** — positional within parent (`nodeRef: "#2"` for third child)

The `node-resolver.ts` module walks the Tpl tree to find matching nodes. If multiple matches are found, it returns all candidates so the skill layer can ask the developer to disambiguate.

## Acceptance Criteria

### Must Have
- [ ] `update-text` modifies text content on an existing page/component and persists via incremental save
- [ ] `update-styles` modifies CSS properties and persists via incremental save
- [ ] `add-child` inserts a new PlasmicElement into an existing container and persists
- [ ] `remove-child` removes a node and persists (with `toDeleteIids`)
- [ ] `move-child` repositions a node within or across containers and persists
- [ ] `begin-batch` / `end-batch` groups multiple edits into a single save round-trip
- [ ] `undo` reverts the last operation and persists the rollback
- [ ] `refresh-project` reloads the bundle and replaces session state
- [ ] MobX `observeModel()` is set up on the unbundled Site after `set-project`
- [ ] `fastBundle()` is called with only the changed instances (not a full re-bundle)
- [ ] Incremental save uses `POST /api/v1/projects/{id}/revisions/{N+1}` with `incremental: true`
- [ ] Revision number is tracked and incremented per save
- [ ] HTTP 412 `ProjectRevisionError` is caught and reported to the developer with guidance to `refresh-project`
- [ ] Node resolution works by UUID, name, and path
- [ ] All new code is in new files (no modifications to upstream files)
- [ ] Unit tests cover each edit operation, save flow, conflict detection, undo, and node resolution
- [ ] Existing M1 tools (`get-component-tree`, `list-components`, etc.) continue to work unchanged

### Nice to Have
- [ ] `save-project` tool for explicit manual saves
- [ ] Undo stack depth > 1 (multiple undos)
- [ ] Node resolution by CSS selector or content match ("the node containing 'Hello'")
- [ ] Dry-run mode that shows what would change without persisting

## Happy Path

### Edit a page heading
1. Developer: `set-project` (loads project, MobX observation starts)
2. Developer: `get-component-tree(Homepage)` (reads current structure)
3. Developer: `update-text(Homepage, "Hero Title", "Welcome Back")`
4. MCP: Finds "Hero Title" TplTag → mutates RawText → MobX records change → `fastBundle()` → POST incremental save
5. MCP: "Updated text on 'Hero Title' to 'Welcome Back'. Saved as revision 42."

### Batch edit multiple pages
1. Developer: `begin-batch`
2. Developer: `update-text(Homepage, "Hero Title", "New Brand Name")`
3. Developer: `update-text(AboutPage, "Page Title", "About New Brand")`
4. Developer: `update-styles(Homepage, "Hero Section", { "backgroundColor": "#1a1a2e" })`
5. Developer: `end-batch`
6. MCP: Saves all 3 changes in a single revision. "Batch saved: 3 changes across 2 components as revision 43."

### Undo a mistake
1. Developer: `remove-child(Homepage, "Newsletter Section")`
2. MCP: "Removed 'Newsletter Section' from Homepage. Saved as revision 44."
3. Developer: `undo`
4. MCP: Re-inserts the removed node at its original position. "Undone: restored 'Newsletter Section'. Saved as revision 45."

### Handle a conflict
1. Developer: `update-text(Homepage, "Hero Title", "My Title")`
2. MCP: POST returns 412 — another user saved revision 42 in Studio
3. MCP: "Save conflict: another user modified the project (expected revision 42, server has 43). Run `refresh-project` to reload, then re-apply your edit."

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Node reference matches multiple nodes | Return all candidates with UUIDs and context. Ask developer to specify by UUID. |
| Node reference matches nothing | Error: "No node named 'X' found in component Y. Use `get-component-tree` to see available nodes." |
| `update-text` on a non-text node | Error: "Node 'X' is a container (vbox), not a text element. Use `add-child` to add text inside it." |
| `add-child` on a text node | Error: "Node 'X' is a text element and cannot have children. Target a container node instead." |
| `remove-child` on the root node | Error: "Cannot remove the root node of a component. Remove its children instead." |
| `move-child` creates a cycle (move parent into child) | Error: "Cannot move 'X' into its own descendant 'Y'." |
| `end-batch` with no `begin-batch` | Error: "No batch session is active." |
| `undo` with empty history | Error: "Nothing to undo." |
| HTTP 412 on save | Report conflict, suggest `refresh-project`. Do not auto-retry (developer should review). |
| HTTP 412 `UnknownReferencesError` | Retry with full bundle automatically (same as Studio). |
| HTTP 412 `BundleTypeError` | Error: "Bundle validation failed. This may indicate a bug. Please report." |
| Session expires / server unreachable | Error with guidance to check connectivity and re-run `set-project`. |
| Editing a component used on multiple pages | Works as expected — component change propagates to all usages (server handles this). |
| Very large batch (100+ changes) | Works but may be slow. Consider splitting into multiple batches. |

## Out of Scope

- Real-time socket.io sync (Milestone 3)
- Variant-aware editing (responsive breakpoints, interaction variants) — M2 edits base variant only
- Code component wiring (event handlers, data fetching, state management)
- Creating/deleting components (only editing existing ones; `create-page` from M1 handles creation)
- Design token creation/editing (read-only via `get-tokens`)
- Multi-branch editing (always edits the main/default branch)
- Automatic conflict resolution / 3-way merge (detect and warn only)

## Technical Notes

### MobX Setup

After `FastBundler.unbundle()` returns the Site, call:
```
observeModel(site, {
  instUtil: <from bundler metadata>,
  listener: changeRecorder.onChange,
  incremental: true,
})
```

The `incremental: true` flag enables field-level tracking (not just instance-level).

### PlasmicElement to TplTag Conversion (for add-child)

`add-child` accepts a PlasmicElement JSON body (same format as `create-page`). The MCP server must convert this to a TplTag tree in memory. This should use model constructors (`new TplTag(...)`, setting up VariantSettings, RuleSet, etc.) rather than going through the REST API's `elementSchemaToTpl()`.

The conversion module (`element-to-tpl.ts`) should:
1. Map PlasmicElement `type` to TplTag `tag` and layout styles
2. Create VariantSettings with a base RuleSet for styles
3. Handle text content as RawText
4. Recursively process children
5. Assign UUIDs via the bundler's IID allocation

### Revision Tracking

The session must track:
- `revisionNum`: current known revision (from initial load or last save)
- `modelVersion`: schema version (from initial load, stays constant)
- `projectUuid`: the bundle UUID (from FastBundler, needed for `fastBundle()`)

These come from the API response when fetching the project bundle.
