# Context-Efficient Tree Queries

## Jobs to Be Done

- As a developer editing pages via Claude Code, I want the MCP server to return compact summaries instead of full tree dumps, so that my conversation context isn't flooded with 15KB+ of JSON per tree query.
- As a developer inspecting project structure, I want to see a compact outline first and drill into specific nodes on demand, so that I can explore large components without filling my context window.
- As a developer doing complex restructuring, I want to export the full tree to a file and selectively Read sections, so that I have full accuracy available without context cost.

## Architecture

### Current Problem

The `get-component-tree` tool serializes the entire in-memory Tpl model to JSON and returns it as a tool response. This enters the LLM's conversation context and never leaves. For a 50-node page:

- Full tree with styles: ~15KB per call
- Edit workflow calls it twice (before + after): ~30KB per edit cycle
- This is the dominant context consumer in Plasmic MCP interactions

### Solution: Server-Side Intelligence

The project model already lives in the MCP server's Node.js process memory (the `Site` object from `FastBundler.unbundle()`). Edit tools already query it server-side via `node-resolver`. The read/inspect tools should do the same — return targeted, small responses instead of bulk dumps.

### New Query Pattern

```
Common case (90%):
  get-component-summary → compact outline (~2KB)
  get-node-details → one node's full info (~300B)

Fallback for complex work:
  get-component-tree --file → full tree written to temp file
  Claude uses Read tool with offset/limit to inspect sections
```

## New MCP Tools

### `get-component-summary`

Returns a compact outline of a component's node tree.

- **Params**: `componentUuid`, optional `maxDepth`
- **Returns**: Indented tree outline with type, tag, name, uuid, and childCount per node. No styles, no attrs, no text content.
- **Context cost**: ~2KB for a 50-node component (vs ~15KB for full tree)

Output format:
```json
{
  "name": "Homepage",
  "uuid": "abc-123",
  "path": "/",
  "tree": {
    "type": "tag", "tag": "div", "uuid": "n1", "name": "Root", "childCount": 3,
    "children": [
      { "type": "tag", "tag": "section", "uuid": "n2", "name": "Hero", "childCount": 2,
        "children": [
          { "type": "tag", "tag": "h1", "uuid": "n3", "name": "Hero Title", "childCount": 0 },
          { "type": "tag", "tag": "p", "uuid": "n4", "name": "Hero Subtitle", "childCount": 0 }
        ]
      },
      { "type": "component", "uuid": "n5", "componentName": "ProductGrid", "childCount": 0 },
      { "type": "tag", "tag": "footer", "uuid": "n6", "name": "Footer", "childCount": 4 }
    ]
  }
}
```

### `get-node-details`

Returns full details for a single node, with immediate children shown as summaries.

- **Params**: `componentUuid`, `nodeRef` (UUID, name, path, or index)
- **Returns**: Full node info (styles, attrs, text, tag, layout) + 1 level of children as summary nodes
- **Context cost**: ~300B per call
- **Uses**: `resolveNode()` + `requireSingleNode()` from `node-resolver.ts` (already exists server-side)

Output format:
```json
{
  "path": "Root.Hero.Hero Title",
  "name": "Hero Title",
  "uuid": "n3",
  "node": {
    "type": "tag",
    "tag": "h1",
    "uuid": "n3",
    "name": "Hero Title",
    "styles": { "fontSize": "48px", "fontWeight": "700", "textAlign": "center" },
    "text": "Welcome to My Store",
    "layoutType": "box",
    "children": []
  }
}
```

### `export-component-tree`

Writes the full tree JSON to a temporary file and returns the file path + compact summary.

- **Params**: `componentUuid`
- **Returns**: File path to the full tree JSON + compact tree outline (same as `get-component-summary`)
- **File location**: Write to a temp directory (e.g., OS temp dir or project `.claude/tmp/`)
- **File format**: Pretty-printed JSON (indented) so `Read` with line-based offset/limit works well
- **Context cost**: ~2KB (summary only). Full data accessible via `Read` tool.

Output format:
```json
{
  "name": "Homepage",
  "uuid": "abc-123",
  "path": "/",
  "filePath": "/tmp/plasmic-tree-abc-123.json",
  "nodeCount": 50,
  "tree": { ...compact summary same as get-component-summary... }
}
```

### Enhanced `get-component-tree` (backward compatible)

Add optional parameters to the existing tool:

- `maxDepth` (number, optional) — Stop recursing after N levels. Deeper children replaced with `childCount`.
- `excludeStyles` (boolean, optional) — Strip styles from output to reduce size.
- `summaryOnly` (boolean, optional) — Return compact outline (same as `get-component-summary`).

Default behavior (no params) is unchanged — full tree returned. This preserves backward compatibility.

## Tree Reader Changes

### `TreeReadOptions` interface

```
maxDepth?: number        // stop recursing after N levels
excludeStyles?: boolean  // strip styles from output
summaryOnly?: boolean    // compact: type/tag/name/uuid/childCount only
```

- `readComponentTree(component, options?)` — pass options through
- `readTplNode(tpl, options, depth)` — respect depth limit and summary mode
- When `summaryOnly`: return only `{ type, tag, uuid, name, childCount }` — no styles, attrs, text
- When `maxDepth` reached: set `childCount` instead of recursing children
- New `readNodeDetails(tplNode)` — full details for one node, children as 1-level summaries

### `TreeNode` type extension

Add `childCount?: number` to `TreeNode` in `types.ts`. Present when depth-truncated or in summary mode. Backward compatible.

## Node Resolver Caching

### Current Problem

Every call to `resolveNode()` flattens the entire Tpl tree into an array of `ResolvedNode` objects. For a 50-node component, this is O(n) per edit tool call. In a batch of 10 edits, the tree is flattened 10 times.

### Solution

Cache the flattened node list in the session after first resolve for a given component. Invalidate on:
- Model mutation (any edit tool call that changes the tree structure: `add-child`, `remove-child`, `move-child`)
- `refresh-project` (full model reload)
- `set-project` (new project loaded)

Text/style edits (`update-text`, `update-styles`) do NOT invalidate the cache since they don't change tree structure.

### Implementation

Add to session state:
```
nodeResolverCache: Map<componentUuid, ResolvedNode[]>
```

- `resolveNode()` checks cache first, flattens only on miss
- Edit tools that change structure (`add-child`, `remove-child`, `move-child`) clear the cache entry for the affected component
- `refresh-project` and `set-project` clear the entire cache

## Skill Updates

### `/plasmic-edit` workflow change

Before (current):
1. Call `get-component-tree` (full tree → 15KB in context)
2. Identify node from tree output
3. Call edit tool
4. Call `get-component-tree` again (another 15KB)

After:
1. Call `get-component-summary` (compact outline → 2KB in context)
2. If needed, call `get-node-details` for specific node (300B)
3. Call edit tool
4. Call `get-node-details` on edited node to confirm (300B)
5. Only call `get-component-tree` or `export-component-tree` if full picture needed (rare)

### `/plasmic-inspect` workflow change

Before: Call `get-component-tree` for any component the user asks about.

After:
1. Call `get-component-summary` for structure overview
2. Call `get-node-details` for specific nodes the user asks about
3. Only use `export-component-tree` if user wants the complete detailed tree

### `/plasmic` router update

Add new tools to the available tools list so routing can direct to them.

## File Cleanup Strategy

For `export-component-tree` temp files:
- Overwrite per component UUID (same component → same file path, e.g., `/tmp/plasmic-tree-{uuid}.json`)
- This naturally prevents accumulation — at most one file per component ever inspected
- Files are small (15-50KB) and in the OS temp directory (cleaned on reboot)
- No explicit cleanup needed

## Acceptance Criteria

### Must Have
- [ ] `get-component-summary` tool returns compact outline (type, tag, name, uuid, childCount per node, no styles/attrs/text)
- [ ] `get-node-details` tool returns full details for a single resolved node with immediate children as summaries
- [ ] `export-component-tree` tool writes full tree JSON to temp file and returns file path + compact summary
- [ ] `get-component-tree` accepts optional `maxDepth`, `excludeStyles`, `summaryOnly` parameters (backward compatible)
- [ ] `TreeReadOptions` interface in `tree-reader.ts` with depth limiting, style exclusion, summary mode
- [ ] `readNodeDetails()` function in `tree-reader.ts`
- [ ] `childCount` field added to `TreeNode` type
- [ ] Node resolver caches flattened node list per component in session
- [ ] Cache invalidated on structure-changing edits (`add-child`, `remove-child`, `move-child`), `refresh-project`, `set-project`
- [ ] Cache NOT invalidated on `update-text`, `update-styles` (no structural change)
- [ ] `/plasmic-edit` skill updated to use `get-component-summary` → `get-node-details` pattern instead of full tree dumps
- [ ] `/plasmic-inspect` skill updated to prefer summary + drill-down
- [ ] `/plasmic` router updated with new tools
- [ ] Measured context reduction: before/after token count comparison for a typical edit workflow (target: 80%+ reduction)
- [ ] Unit tests for tree-reader summary mode, depth limiting, readNodeDetails
- [ ] Unit tests for node resolver caching and invalidation
- [ ] Integration tests for new MCP tools
- [ ] All new code in new files or additive changes to existing files (upstream merge safe)

### Nice to Have
- [ ] `get-subtree(componentUuid, nodeRef, maxDepth?)` — return full tree from a specific node downward
- [ ] Node resolver cache hit/miss metrics in tool response metadata

## Happy Path

### Edit workflow (context-efficient)
1. Developer: `get-component-summary(Homepage)` → receives 2KB outline
2. Developer: `get-node-details(Homepage, "Hero Title")` → receives 300B with styles/text
3. Developer: `update-text(Homepage, "Hero Title", "Welcome Back")` → 200B confirmation
4. Developer: `get-node-details(Homepage, "Hero Title")` → 300B confirming new text
5. Total context: ~3KB (vs ~30KB before — 90% reduction)

### Inspect workflow (context-efficient)
1. Developer: `get-component-summary(Homepage)` → 2KB outline
2. Developer: "tell me about the Hero section" → `get-node-details(Homepage, "Hero")` → 300B
3. Developer: "what styles does the title have?" → `get-node-details(Homepage, "Hero Title")` → 300B
4. Total context: ~3KB (vs ~15KB before — 80% reduction)

### Complex restructuring (file fallback)
1. Developer: `export-component-tree(Homepage)` → 2KB summary + file path
2. Developer: Claude uses `Read /tmp/plasmic-tree-abc.json offset=10 limit=30` to inspect specific sections
3. Developer: Makes edits based on targeted file reads
4. Only the specific Read sections enter context, not the whole tree

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| `get-component-summary` on component with 200+ nodes | Return full summary (still compact without styles). Consider default `maxDepth: 5` for very large trees. |
| `get-node-details` with ambiguous nodeRef | Same as existing node-resolver: return all candidates with UUIDs, ask developer to specify |
| `get-node-details` on component node (not tag) | Return component name, UUID, props. No styles (components don't have direct styles). |
| `export-component-tree` file already exists from earlier call | Overwrite — same UUID always maps to same file path |
| `get-component-tree` called with no params (backward compat) | Returns full tree exactly as before. No regression. |
| Node resolver cache stale after `add-child` | Cache entry for that component is cleared. Next resolve rebuilds. |
| Node resolver cache after `update-text` | Cache remains valid — text edits don't change tree structure. |
| Multiple components inspected in one session | Each component gets its own cache entry and (if exported) its own temp file. |

## Out of Scope

- Incremental update queries (`getModelUpdates` endpoint) — separate optimization for refresh flow
- Changes to edit tool behavior (they already use server-side node resolution)
- Changes to save flow, batch/undo, or other M2 functionality
- Real-time sync (M3)
- Variant-aware querying
- Design token query optimization
