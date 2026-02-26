# Component Props (Definition)

## Jobs to Be Done
- As a Claude Code user creating reusable components, I want to define props (parameters) on components so that instances can be customized
- As a Claude Code user, I want to manage slot params so that components accept child content in named areas

## Background

Studio components have `params: Param[]` with types: StateParam, PropParam, SlotParam, GlobalVariantGroupParam, StateChangeHandlerParam. TplMgr provides: `renameParam()`, `getUniqueParamName()`. Params are created when adding states, slots, or explicitly via the properties panel.

Currently the MCP can set props on component instances (via `add-child` with ComponentElement `props` field) but cannot define new props on a component definition.

## Implementation

Prop definition CRUD integrates into the `component` domain.

### `component({ action: "add-prop" })`
- **Parameters**: `componentUuid`, `name`, `type` (text | number | boolean | object | slot | href | eventHandler), `defaultValue?`, `description?`
- Creates a Param on the component
- For `type: "slot"`, also creates a TplSlot in the tree
- Returns: `{ paramUuid, name, type }`

### `component({ action: "list-props" })`
- **Parameters**: `componentUuid`
- Returns: Array of `{ paramUuid, name, type, defaultValue?, isSlot, isState }`

### `component({ action: "remove-prop" })`
- **Parameters**: `componentUuid`, `propRef` (name or UUID)
- Removes param + cleanup from instances

### `component({ action: "update-prop" })`
- **Parameters**: `componentUuid`, `propRef`, `name?`, `defaultValue?`, `description?`
- Updates prop properties (type cannot be changed)

## Acceptance Criteria
- [x] Can define text prop on component: `add-prop({ name: "title", type: "text", defaultValue: "Untitled" })`
- [x] Can define boolean prop: `add-prop({ name: "showIcon", type: "boolean", defaultValue: "true" })`
- [x] Can define slot prop: `add-prop({ name: "footer", type: "slot" })` — creates TplSlot
- [x] Can list all props on a component
- [x] Can remove a prop with instance cleanup
- [x] Can rename a prop (instances update automatically via TplMgr)
- [x] Props are usable in dynamic text: `$props.title`
- [x] Props are usable in data-cond: `$props.showIcon`
- [x] Slot props are targetable by `add-child` with `slot` field
- [x] Undo support
- [x] Batch mode support
- [x] Integration test: add prop → set on instance → read back → verify
- [x] Unit tests for all CRUD operations

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Duplicate prop name | Auto-deduplicate |
| Remove slot prop | Remove TplSlot + all instance slot overrides |
| Add prop with reserved name (children, key, ref, className) | Error: "Prop name 'children' is reserved" |
| Prop name with special chars | Sanitize to valid JS identifier |
| eventHandler type prop | Creates callback prop for interaction forwarding |

## Out of Scope
- Complex prop types (arrays of objects, discriminated unions)
- Prop validation rules (min/max, patterns)
- Default value expressions (only literal defaults)
