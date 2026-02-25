# Node Cloning

## Jobs to Be Done
- As a Claude Code user building repetitive layouts (lists, grids, card sets), I want to duplicate an existing node so that I can quickly create similar elements without rebuilding from scratch

## Background

`clone-component` duplicates entire components/pages via the REST API. There is no tool to duplicate a single node within a component tree. Studio supports copy-paste of nodes internally via deep cloning of TplTag/TplComponent with all children, styles, and variant settings.

## Acceptance Criteria

- [ ] New `clone-child` tool accepts `{ componentUuid, nodeRef, newName? }`
- [ ] Clones the target node and all its descendants (deep clone)
- [ ] Clone is inserted as a sibling immediately after the original node (same parent, next position)
- [ ] Optionally accept `parentRef` and `position` to insert the clone elsewhere
- [ ] Cloned nodes get new UUIDs (not duplicates of originals)
- [ ] All variant settings (base + non-base) are copied to the clone
- [ ] Text content is preserved on cloned nodes
- [ ] Styles are preserved on cloned nodes
- [ ] Slot override content in cloned TplComponent instances is preserved
- [ ] `clone-child` supports dry-run mode
- [ ] `clone-child` supports batch mode (accumulated, not saved immediately)
- [ ] `clone-child` returns the new root node's UUID
- [ ] Undo support: cloned subtree is removed on undo
- [ ] Integration test verifies clone → verify in tree → undo → verify removed

## Happy Path
1. User builds a `<Card>` element with text, styles, and children
2. User calls `clone-child` with `{ nodeRef: "card-uuid" }`
3. A copy of the card (with new UUIDs) appears as the next sibling
4. User modifies the clone's text/styles independently
5. Original card is unchanged

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Clone the root node of a component | Error: "Cannot clone the root node" |
| Clone a TplComponent instance | Deep clone including slot override args |
| Clone a node with children that reference component instances | Clone the references (new TplComponent pointing to same component) |
| `newName` provided | Clone's `name` field is set to newName |
| `newName` not provided | Clone's name is `"Original Name (copy)"` or auto-generated |
| Clone into a different parent | Valid — parentRef + position respected |

## Out of Scope
- Cross-component cloning (copying a node from one component to another)
- Template/snippet library
- Clipboard support
