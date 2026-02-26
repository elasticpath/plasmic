# STRAP Tool Consolidation

## Jobs to Be Done
- As a Claude Code skill author, I want fewer MCP tools with clear domain grouping so that LLM tool selection is reliable and context window usage is minimized
- As a developer maintaining the MCP server, I want a scalable tool architecture so that new features don't require adding new top-level tools

## Background

The server currently has 98 individual tools. The STRAP pattern (Structured Tool Resource Action Pattern) consolidates these into 8 domain tools, each with an `action` discriminator and flat parameters. This is a breaking change -- old tool names are removed entirely.

### Design rationale

The original 6-domain proposal mapped 34 tools. Scaling to 97 tools exposed a critical flaw: the `component` domain would absorb ~50+ actions covering tokens, mixins, animations, themes, assets, data-tokens, splits, global variants, and component-level config (props, states, queries). That violates the core principle of distinct responsibility per domain.

The solution adds two new domains:

1. **`design`** -- Site-level design system entities: tokens, mixins, animations, themes, assets. These are all "shared resources" that exist at the site level and can be referenced from any component. The mental model is "things a designer manages globally."

2. **`data`** -- Data flow: queries, data-tokens, data repetition, conditional rendering, splits, custom functions, code component meta. The mental model is "things that connect to external data or runtime logic."

This yields **8 domains** with clear boundaries:

| Domain | Responsibility | Action count |
|--------|---------------|-------------|
| `project` | Session lifecycle, persistence, batch, undo | 8 |
| `inspect` | All read-only queries on component trees | 8 |
| `component` | Component/page lifecycle, props, states | 18 |
| `node` | Element mutations (structure, style, text, attrs, images, mixins, animations) | 15 |
| `variant` | Variant management (component, global, style) | 12 |
| `design` | Site-level design system (tokens, mixins, animations, themes, assets) | 22 |
| `data` | Data flow (queries, data-tokens, data-rep, data-cond, splits, code meta) | 16 |
| `interaction` | Event handlers | 4 |
| **Total** | | **103 actions across 8 tools** |

### Decision: where does `set-image` live?

`set-image` operates on a node (it sets the src attr or background-image on a TplTag element), so it belongs in `node`, not `design`. The `design` domain manages site-level asset CRUD; `node` applies assets to elements.

### Decision: where do `apply-mixin` and `detach-mixin` live?

These operate on nodes (adding/removing mixin refs from a VariantSetting), so they belong in `node`. The `design` domain manages mixin CRUD; `node` applies/detaches mixins on elements.

### Decision: where do `add-node-animation` and `remove-node-animation` live?

These operate on nodes (adding/removing Animation objects from a VariantSetting), so they belong in `node`. The `design` domain manages animation sequence CRUD; `node` applies/removes animations on elements.

## Domain Mapping

### 1. `project` -- Session, persistence, batch operations (8 actions)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `set` | set-project | projectId |
| `list` | list-projects | (none) |
| `get-meta` | get-project-meta | (none) |
| `save` | save-project | (none) |
| `refresh` | refresh-project | (none) |
| `begin-batch` | begin-batch | (none) |
| `end-batch` | end-batch | batchId? |
| `undo` | undo | (none) |

### 2. `inspect` -- All read-only queries on component trees (8 actions)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `tree` | get-component-tree | componentUuid, maxDepth?, excludeStyles?, summaryOnly? |
| `summary` | get-component-summary | componentUuid, maxDepth? |
| `node` | get-node-details | componentUuid, nodeRef |
| `subtree` | get-subtree | componentUuid, nodeRef, maxDepth?, excludeStyles? |
| `export` | export-component-tree | componentUuid |
| `style-properties` | list-style-properties | filter? |
| `preview-url` | get-preview-url | componentUuid |
| `page-meta` | get-page-meta | componentUuid |

### 3. `component` -- Component/page lifecycle and configuration (18 actions)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list` | list-components | (none) |
| `create-page` | create-page | name, path, body? |
| `create` | create-component | name, body? |
| `clone` | clone-component | sourceUuid, name, path? |
| `rename` | rename-component | componentUuid, newName, newPath? |
| `delete` | delete-component | componentUuid, force? |
| `convert-to-page` | convert-to-page | componentUuid, path? |
| `convert-to-component` | convert-to-component | componentUuid |
| `update-page-meta` | update-page-meta | componentUuid, title?, description?, openGraphImage?, canonical?, path? |
| `extract` | extract-to-component | componentUuid, nodeRef, name |
| `list-props` | list-props | componentUuid |
| `add-prop` | add-prop | componentUuid, name, type, defaultValue?, description?, dryRun? |
| `update-prop` | update-prop | componentUuid, propRef, name?, defaultValue?, description?, dryRun? |
| `remove-prop` | remove-prop | componentUuid, propRef, dryRun? |
| `list-states` | list-states | componentUuid |
| `add-state` | add-state | componentUuid, name, variableType, accessType?, initialValue?, dryRun? |
| `update-state` | update-state | componentUuid, stateRef, name?, accessType?, initialValue?, dryRun? |
| `remove-state` | remove-state | componentUuid, stateRef, dryRun? |

Note: `component` has 18 actions including `extract` (added post-STRAP) plus props and states (list/add/update/remove for each = 7 extra). This is acceptable because props, states, and extract are intrinsic to component definition -- they define the component's interface, internal state, and structure. They do not exist independently at the site level.

### 4. `node` -- Element mutations (15 actions)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `add` | add-child | componentUuid, parentRef, child, position?, slot?, dryRun? |
| `remove` | remove-child | componentUuid, nodeRef, dryRun? |
| `move` | move-child | componentUuid, nodeRef, newParentRef, position?, slot?, dryRun? |
| `clone` | clone-child | componentUuid, nodeRef, newName?, parentRef?, position?, slot?, dryRun? |
| `reorder` | reorder-children | componentUuid, parentRef, childRefs, dryRun? |
| `update-styles` | update-styles | componentUuid, nodeRef, styles, variant?, dryRun? |
| `update-text` | update-text | componentUuid, nodeRef, text, variant?, dynamic?, fallback?, html?, dryRun? |
| `update-rich-text` | update-rich-text | componentUuid, nodeRef, text, marks, variant?, dryRun? |
| `update-attrs` | update-attrs | componentUuid, nodeRef, attrs, variant?, dryRun? |
| `set-visibility` | set-visibility | componentUuid, nodeRef, visible, variant?, dryRun? |
| `set-image` | set-image | componentUuid, nodeRef, assetRef?, src?, variant?, dryRun? |
| `apply-mixin` | apply-mixin | componentUuid, nodeRef, mixinRef, dryRun? |
| `detach-mixin` | detach-mixin | componentUuid, nodeRef, mixinRef, dryRun? |
| `add-animation` | add-node-animation | componentUuid, nodeRef, seqRef, duration?, delay?, timingFunction?, iterationCount?, direction?, fillMode?, playState?, dryRun? |
| `remove-animation` | remove-node-animation | componentUuid, nodeRef, seqRef?, animationIndex?, dryRun? |

### 5. `variant` -- Variant management (12 actions)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list` | list-variants | componentUuid |
| `create-style` | create-style-variant | componentUuid, selector, nodeRef? |
| `create-group` | create-variant-group | componentUuid, name, type?, initialVariants? |
| `list-global-groups` | list-global-variant-groups | (none) |
| `create-global-group` | create-global-variant-group | name, type?, initialVariants? |
| `add-global` | add-global-variant | groupRef, name |
| `remove-global-group` | remove-global-variant-group | groupRef |
| `rename-global` | rename-global-variant | variantRef, newName |
| `create-screen` | (new) | name, minWidth?, maxWidth? |
| `update-screen` | (new) | variantUuid, minWidth?, maxWidth? |
| `rename` | (new) | componentUuid?, variantUuid, newName |
| `remove` | (new) | componentUuid?, variantUuid |

Note: 12 actions. This is a clean split: component-level variant listing/creation, global variant group CRUD, screen variant management, and general variant rename/remove.

### 6. `design` -- Site-level design system (22 actions)

#### Tokens (5)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list-tokens` | get-tokens | tokenType? |
| `create-token` | create-token | name, tokenType, value, dryRun? |
| `update-token` | update-token | tokenRef, value?, name?, dryRun? |
| `remove-token` | remove-token | tokenRef, dryRun? |
| `duplicate-token` | duplicate-token | tokenRef, newName?, dryRun? |

#### Mixins (4)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list-mixins` | list-mixins | (none) |
| `create-mixin` | create-mixin | name, styles?, dryRun? |
| `update-mixin` | update-mixin | mixinRef, newName?, styles?, dryRun? |
| `remove-mixin` | remove-mixin | mixinRef, dryRun? |

#### Animation sequences (4)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list-animations` | list-animation-sequences | (none) |
| `create-animation` | create-animation-sequence | name, keyframes?, dryRun? |
| `update-animation` | update-animation-sequence | seqRef, newName?, keyframes?, dryRun? |
| `remove-animation` | remove-animation-sequence | seqRef, dryRun? |

#### Themes (5)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list-themes` | list-themes | (none) |
| `create-theme` | create-theme | defaultStyles?, themeStyles?, setActive?, dryRun? |
| `update-theme` | update-theme | themeIndex, defaultStyles?, themeStyles?, dryRun? |
| `remove-theme` | remove-theme | themeIndex, dryRun? |
| `set-active-theme` | set-active-theme | themeIndex, dryRun? |

#### Assets (4)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list-assets` | list-assets | assetType? |
| `upload-asset` | upload-asset | name, assetType, url?, dataUri?, width?, height?, dryRun? |
| `rename-asset` | rename-asset | assetRef, newName, dryRun? |
| `remove-asset` | remove-asset | assetRef, dryRun? |

Total: 22 actions.

### 7. `data` -- Data flow and runtime logic (16 actions)

#### Data conditions and repetition (2)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `set-data-cond` | set-data-cond | componentUuid, nodeRef, condition, variant?, dryRun? |
| `set-data-rep` | set-data-rep | componentUuid, nodeRef, collection, elementVariable?, indexVariable?, variant?, dryRun? |

#### Queries (4)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list-queries` | list-queries | componentUuid |
| `add-query` | add-query | componentUuid, name, queryType?, dryRun? |
| `update-query` | update-query | componentUuid, queryRef, name, dryRun? |
| `remove-query` | remove-query | componentUuid, queryRef, dryRun? |

#### Data tokens (4)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list-data-tokens` | list-data-tokens | (none) |
| `create-data-token` | create-data-token | name, value? |
| `update-data-token` | update-data-token | tokenRef, name?, value? |
| `remove-data-token` | remove-data-token | tokenRef |

#### Splits / A/B testing (4)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list-splits` | list-splits | (none) |
| `create-split` | create-split | name, splitType, slices |
| `update-split` | update-split | splitRef, name?, status? |
| `remove-split` | remove-split | splitRef |

#### Code introspection (2)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `get-code-meta` | get-code-component-meta | componentUuid |
| `list-functions` | list-custom-functions | (none) |

Total: 16 actions.

### 8. `interaction` -- Event handlers (4 actions)

| Action | Replaces | Parameters |
|--------|----------|------------|
| `list` | list-interactions | componentUuid, nodeRef |
| `add` | add-interaction | componentUuid, nodeRef, event, actionName, args, interactionName?, condition?, dryRun? |
| `update` | (new) | componentUuid, nodeRef, event, interactionIndex, actionName?, args?, condition?, interactionName?, dryRun? |
| `remove` | remove-interaction | componentUuid, nodeRef, event, interactionIndex?, dryRun? |

## Verification: Complete tool coverage (103 tools)

Every old tool is mapped exactly once. Here is the exhaustive cross-reference sorted alphabetically by old tool name:

| # | Old tool name | Domain | Action |
|---|--------------|--------|--------|
| 1 | add-child | node | add |
| 2 | add-global-variant | variant | add-global |
| 3 | add-interaction | interaction | add |
| 4 | add-node-animation | node | add-animation |
| 5 | add-prop | component | add-prop |
| 6 | add-query | data | add-query |
| 7 | add-state | component | add-state |
| 8 | apply-mixin | node | apply-mixin |
| 9 | begin-batch | project | begin-batch |
| 10 | clone-child | node | clone |
| 11 | clone-component | component | clone |
| 12 | convert-to-component | component | convert-to-component |
| 13 | convert-to-page | component | convert-to-page |
| 14 | create-animation-sequence | design | create-animation |
| 15 | create-component | component | create |
| 16 | create-data-token | data | create-data-token |
| 17 | create-global-variant-group | variant | create-global-group |
| 18 | create-mixin | design | create-mixin |
| 19 | create-page | component | create-page |
| 20 | create-split | data | create-split |
| 21 | create-style-variant | variant | create-style |
| 22 | create-theme | design | create-theme |
| 23 | create-token | design | create-token |
| 24 | create-variant-group | variant | create-group |
| 25 | delete-component | component | delete |
| 26 | detach-mixin | node | detach-mixin |
| 27 | duplicate-token | design | duplicate-token |
| 28 | end-batch | project | end-batch |
| 29 | export-component-tree | inspect | export |
| 30 | extract-to-component | component | extract |
| 31 | get-code-component-meta | data | get-code-meta |
| 32 | get-component-summary | inspect | summary |
| 33 | get-component-tree | inspect | tree |
| 34 | get-node-details | inspect | node |
| 35 | get-page-meta | inspect | page-meta |
| 36 | get-preview-url | inspect | preview-url |
| 37 | get-project-meta | project | get-meta |
| 38 | get-subtree | inspect | subtree |
| 39 | get-tokens | design | list-tokens |
| 40 | list-animation-sequences | design | list-animations |
| 41 | list-assets | design | list-assets |
| 42 | list-components | component | list |
| 43 | list-custom-functions | data | list-functions |
| 44 | list-data-tokens | data | list-data-tokens |
| 45 | list-global-variant-groups | variant | list-global-groups |
| 46 | list-interactions | interaction | list |
| 47 | list-mixins | design | list-mixins |
| 48 | list-projects | project | list |
| 49 | list-props | component | list-props |
| 50 | list-queries | data | list-queries |
| 51 | list-splits | data | list-splits |
| 52 | list-states | component | list-states |
| 53 | list-style-properties | inspect | style-properties |
| 54 | list-themes | design | list-themes |
| 55 | list-variants | variant | list |
| 56 | move-child | node | move |
| 57 | refresh-project | project | refresh |
| 58 | remove-animation-sequence | design | remove-animation |
| 59 | remove-asset | design | remove-asset |
| 60 | remove-child | node | remove |
| 61 | remove-data-token | data | remove-data-token |
| 62 | remove-global-variant-group | variant | remove-global-group |
| 63 | remove-interaction | interaction | remove |
| 64 | remove-mixin | design | remove-mixin |
| 65 | remove-node-animation | node | remove-animation |
| 66 | remove-prop | component | remove-prop |
| 67 | remove-query | data | remove-query |
| 68 | remove-split | data | remove-split |
| 69 | remove-state | component | remove-state |
| 70 | remove-theme | design | remove-theme |
| 71 | remove-token | design | remove-token |
| 72 | rename-asset | design | rename-asset |
| 73 | rename-component | component | rename |
| 74 | rename-global-variant | variant | rename-global |
| 75 | reorder-children | node | reorder |
| 76 | save-project | project | save |
| 77 | set-active-theme | design | set-active-theme |
| 78 | set-data-cond | data | set-data-cond |
| 79 | set-data-rep | data | set-data-rep |
| 80 | set-image | node | set-image |
| 81 | set-project | project | set |
| 82 | set-visibility | node | set-visibility |
| 83 | undo | project | undo |
| 84 | update-animation-sequence | design | update-animation |
| 85 | update-attrs | node | update-attrs |
| 86 | update-data-token | data | update-data-token |
| 87 | update-mixin | design | update-mixin |
| 88 | update-page-meta | component | update-page-meta |
| 89 | update-prop | component | update-prop |
| 90 | update-query | data | update-query |
| 91 | update-rich-text | node | update-rich-text |
| 92 | update-split | data | update-split |
| 93 | update-state | component | update-state |
| 94 | update-styles | node | update-styles |
| 95 | update-text | node | update-text |
| 96 | update-theme | design | update-theme |
| 97 | update-token | design | update-token |
| 98 | upload-asset | design | upload-asset |
| 99 | (new) | interaction | update |

**Count: 98 old tools mapped to 99 actions across 8 domain tools. Row 99 is a new action with no predecessor tool. An additional 4 variant actions (create-screen, update-screen, rename, remove) bring the total to 103 actions.**

## Action count per domain (final)

| Domain | Actions |
|--------|---------|
| project | 8 |
| inspect | 8 |
| component | 18 |
| node | 15 |
| variant | 12 |
| design | 22 |
| data | 16 |
| interaction | 4 |
| **Total** | **103** |

## Acceptance Criteria
- [x] 98 old tools are removed from server.ts (99 total actions, 1 is new with no predecessor)
- [x] 8 new domain tools are registered, each with `action` as a required string enum parameter
- [x] All other parameters are flat (no nested `data` object)
- [x] Zod schema validates that action-specific required params are present (discriminated union or `.refine()`)
- [x] Each action handler delegates to the same underlying function (edit-tools.ts, tree-reader.ts, etc.) -- logic is NOT rewritten
- [x] Tool descriptions include a table of available actions for LLM discoverability
- [x] All 1026 tests pass after migration (updated to use new tool names)
- [x] `npm run build` succeeds with no new warnings

## Happy Path
1. Claude Code skill calls `node({ action: "add", componentUuid: "...", parentRef: "...", child: {...} })`
2. Server routes to `addChild()` in edit-tools.ts
3. Response format is identical to current tool response

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Unknown action value | Error: "Unknown action 'foo' for node tool. Available: add, remove, move, ..." |
| Missing required param for action | Zod validation error with clear message about which param is needed |
| Action that requires active project called without set | Same error as today: "No active project" |
| Old tool name called | MCP protocol error: tool not found |

## Implementation Notes

### Zod schema strategy

Each domain tool uses a discriminated union on `action`:

```typescript
const nodeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    componentUuid: z.string(),
    parentRef: z.string(),
    child: z.any(),
    position: z.union([z.string(), z.number()]).optional(),
    slot: z.string().optional(),
    dryRun: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("remove"),
    componentUuid: z.string(),
    nodeRef: z.string(),
    dryRun: z.boolean().optional(),
  }),
  // ... etc
]);
```

This gives per-action validation with clear error messages. MCP SDK's `server.tool()` accepts Zod schemas directly.

### Tool description format

Each domain tool's description includes a compact action reference so the LLM can select the correct action without a separate lookup:

```
"Element mutations within a component.
Actions: add, remove, move, clone, reorder, update-styles, update-text,
update-rich-text, update-attrs, set-visibility, set-image, apply-mixin,
detach-mixin, add-animation, remove-animation.
Use inspect tool for read-only queries."
```

### Migration path for skills

Skills are updated atomically: old `mcp__plasmic__add-child` becomes `mcp__plasmic__node` with `action: "add"`. The skill loader can provide a compatibility shim during transition if needed, but the recommended path is a clean cutover.

## Out of Scope
- Backward-compatible aliases for old tool names
- Changes to edit-tools.ts, tree-reader.ts, or other internal logic (only server.ts routing changes)
- Changes to response format (keep existing JSON structures)
- Nested/hierarchical domain tools (e.g., `design.token.create`) -- keep flat action strings
