# State Management

## Jobs to Be Done
- As a Claude Code user building interactive pages, I want to create component state variables so that UI can respond to user input (toggles, form fields, counters)
- As a Claude Code user, I want to read and modify state definitions so that I can wire up interactions and dynamic expressions

## Background

Studio components have `State` objects with: `param` (prop exposure), `accessType` (private/readonly/writable), `variableType` (text/number/boolean/array/object/variant/dateString/dateRangeStrings), `onChangeParam`, `tplNode` (optional element binding), and implicit state from data reps.

State is managed via TplMgr. States auto-create variant groups when `variableType` is "variant".

## Implementation

State management integrates into the `node` domain tool (element-bound state) and `component` domain tool (component-level state).

### `component({ action: "add-state" })`
- **Parameters**: `componentUuid`, `name`, `variableType`, `accessType?` (default "private"), `initialValue?`
- Creates a State + associated Param on the component
- Returns: `{ stateUuid, paramUuid, name, variableType, accessType }`

### `component({ action: "list-states" })`
- **Parameters**: `componentUuid`
- Returns: Array of `{ stateUuid, name, variableType, accessType, initialValue?, boundTo? }`

### `component({ action: "remove-state" })`
- **Parameters**: `componentUuid`, `stateRef` (name or UUID)
- Removes state + cleanup of expressions referencing it

### `component({ action: "update-state" })`
- **Parameters**: `componentUuid`, `stateRef`, `accessType?`, `initialValue?`
- Updates state properties

## Acceptance Criteria
- [x] Can create boolean state (for toggles): `add-state({ name: "isOpen", variableType: "boolean", initialValue: "false" })`
- [x] Can create text state (for form inputs): `add-state({ name: "searchQuery", variableType: "text" })`
- [x] Can create number state: `add-state({ name: "count", variableType: "number", initialValue: "0" })`
- [x] Can list all states on a component
- [x] Can remove state with expression cleanup
- [x] Can update state access type (private → writable to expose as prop)
- [x] State is usable in interaction args: `setState({ state: "isOpen", value: "!$state.isOpen" })`
- [x] State is usable in data-cond: `set-data-cond({ condition: "$state.isOpen" })`
- [x] State is usable in dynamic text: `update-text({ text: "$state.count", dynamic: true })`
- [x] Undo support for all state operations
- [x] Batch mode support
- [x] Integration test: create state → use in interaction → verify round-trip
- [x] Integration test: create state → use in data-cond → verify
- [x] Unit tests for all CRUD operations

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Duplicate state name | Error: "State 'isOpen' already exists on component" |
| Remove state used in expressions | Cleanup expressions (set to undefined), log warning in response |
| variableType: "variant" | Auto-creates variant group linked to state |
| initialValue type mismatch | Accept as-is (runtime validation, not compile-time) |
| State name with special chars | Sanitize to valid JS identifier |

## Out of Scope
- Implicit state from data reps (auto-created by collection rendering)
- State forwarding between components (complex prop drilling)
- Computed/derived state
