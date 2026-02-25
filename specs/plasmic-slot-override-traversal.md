# Slot Override Traversal

## Jobs to Be Done
- As a Claude Code user building nested UIs, I want to edit text, styles, and structure inside code component slot overrides so that I can style and compose components without switching to Studio

## Background

When a page uses a TplComponent (e.g., `<Card>`), the page-level slot overrides are stored in `vsettings[0].args[].expr.tpl[]`. These nodes are **owned by the consumer** (the page), not the child component. Studio's `tplChildren()` function traverses them via `getSlotArgs()`:

```ts
// Studio pattern (tpls.ts:1165-1188)
.when(TplComponent, (_node) =>
  getSlotArgs(_node)
    .filter((slot) => childrenOnly ? slot.param.variable.name === "children" : true)
    .flatMap((arg) => (isKnownRenderExpr(arg.expr) ? arg.expr.tpl : []))
)
```

The MCP's `getChildren()` in both `node-resolver.ts` and `tree-reader.ts` currently returns `[]` for TplComponent, making override nodes invisible to mutation tools (update-text, update-styles, add-child, remove-child, move-child).

## Acceptance Criteria

- [ ] `node-resolver.ts` `getChildren()` traverses TplComponent slot overrides via `getSlotArgs()` → `RenderExpr.tpl[]`, matching Studio's `tplChildren()` pattern
- [ ] `tree-reader.ts` `getTplChildren()` uses the same traversal so `get-component-tree` output includes override nodes
- [ ] Slot override nodes are resolvable by UUID, name, and path (path should include the slot name as a segment, e.g., `Card.children.Title`)
- [ ] `update-text` works on text nodes inside slot overrides
- [ ] `update-styles` works on nodes inside slot overrides
- [ ] `add-child` can add children to container nodes inside slot overrides
- [ ] `remove-child` can remove nodes from inside slot overrides
- [ ] `move-child` can move nodes within slot overrides
- [ ] Tree output groups override nodes by slot name (e.g., `slot: "children"` or `slot: "header"`)
- [ ] Integration tests verify traversal with real TplComponent + slot args from fixture

## Happy Path
1. User calls `get-component-tree` on a page containing `<Card>` with slot overrides
2. Tree output shows override nodes nested under the TplComponent, grouped by slot name
3. User gets a UUID of a text node inside the `children` slot override
4. User calls `update-text` with that UUID — text updates successfully
5. User calls `update-styles` on a container inside the override — styles apply

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| TplComponent with no slot overrides (empty args) | Returns `[]` children — same as current |
| TplComponent with non-RenderExpr args (e.g., CustomCode slot) | Skip non-RenderExpr args, only traverse RenderExpr.tpl |
| Deeply nested overrides (TplComponent inside TplComponent override) | Recursive traversal works to any depth |
| Node inside override has no base variant setting | `ensureBaseVariantSetting()` creates one (existing behavior) |
| Slot param name collides with child node name in path resolution | Slot name takes precedence in path segment |

## Out of Scope
- Editing the child component's own `tplTree` through the consumer page
- Creating new slot override args (only traversing existing ones)
- Editing slot params or slot definitions on the child component
