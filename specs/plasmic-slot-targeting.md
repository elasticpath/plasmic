# Slot Content Targeting in add-child

## Jobs to Be Done
- As a Claude Code user composing components, I want to add children to slot content areas of component instances so that I can build complete UIs by populating component slots

## Background

When a page uses a TplComponent (e.g., `<Card>`), the component defines slot params (e.g., `children`, `header`, `footer`). Content placed in these slots is stored as `RenderExpr.tpl[]` inside `VariantSetting.args[]`. Currently `add-child` rejects slot params with: "Prop 'X' is a slot. Use the 'children' field instead." But the `children` field in PlasmicElement only supports the default slot.

After the slot-override-traversal spec is implemented, these nodes will be visible in the tree. This spec adds the ability to mutate them.

## Acceptance Criteria

- [ ] `add-child` accepts a new optional `slot` field: `{ componentUuid, parentRef, slot: "slotName", child: PlasmicElement }`
- [ ] When `slot` is specified and `parentRef` points to a TplComponent, the child is added to the named slot's RenderExpr.tpl array
- [ ] If the slot has no existing RenderExpr (no override yet), a new Arg + RenderExpr is created
- [ ] If the slot already has content, the new child is appended (or inserted at `position`)
- [ ] `remove-child` can remove nodes from inside slot override content
- [ ] Error if slot name doesn't exist on the target component: "Slot 'X' not found on component 'Y'. Available slots: [list]"
- [ ] Default behavior (no `slot` field): `add-child` to TplTag containers works as before
- [ ] `add-child` with `parentRef` pointing to a TplComponent WITHOUT `slot` field: adds to "children" slot by default
- [ ] Undo support for slot content additions
- [ ] Batch mode support
- [ ] Integration test verifies add-child to named slot → read → verify → undo

## Happy Path
1. User sees a `<Card>` component with slots: `children`, `header`, `actions`
2. User calls `add-child` with `{ parentRef: "card-uuid", slot: "header", child: { type: "text", text: "Card Title" } }`
3. A text node is added to the Card's `header` slot override
4. `get-component-tree` shows the text node nested under the Card's header slot

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Slot param is not a RenderExpr (e.g., CustomCode slot) | Error: "Slot 'X' contains a code expression, not renderable content" |
| `slot: "children"` (default slot) | Works — same as omitting `slot` field |
| TplComponent has no slot params | Error: "Component 'X' has no slots" |
| `parentRef` is a TplTag (not TplComponent) with `slot` field | Error: "Slot targeting only applies to component instances" |
| Removing the last child from a slot | RenderExpr.tpl becomes empty array (slot override remains but empty) |

## Out of Scope
- Creating new slot params on a component
- Slot forwarding or composition
- Conditional slot content
