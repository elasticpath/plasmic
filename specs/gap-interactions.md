# Interactions & Event Handlers

## Jobs to Be Done
- As a Claude Code user building functional pages, I want to attach click-to-navigate interactions so that buttons and links work
- As a Claude Code user building interactive UIs, I want to attach state mutations and custom actions to events so that pages respond to user input

## Background

Studio's interaction model: `EventHandler` contains `Interaction[]`. Each Interaction has `interactionName` (event), `actionName` (what to do), `args: NameArg[]` (parameters), `condExpr` (conditional execution), `conditionalMode`.

Supported events: onClick, onDoubleClick, onMouseEnter, onMouseLeave, onFocus, onBlur, onChange, onSubmit, onKeyDown, onKeyUp, onScroll, onLoad.

Supported actions: navigateTo, setState, runCode, scrollTo, showElement, hideElement, toggleElement, openUrl, closeOverlay, invokeEventHandler.

## Implementation

New `interaction` domain tool with 4 actions.

### `interaction({ action: "add" })`
Add an interaction to an element's event handler.
- **Parameters**:
  - `componentUuid` — component containing the element
  - `nodeRef` — target element
  - `event` — event name (onClick, onMouseEnter, etc.)
  - `actionName` — action to perform (navigateTo, setState, runCode, etc.)
  - `args` — object of named arguments:
    - navigateTo: `{ destination: "/path" }` or `{ destination: "$ctx.url" }`
    - setState: `{ state: "stateName", value: "expression" }`
    - runCode: `{ code: "console.log('clicked')" }`
    - scrollTo: `{ target: "nodeRef" }`
    - openUrl: `{ url: "https://...", newTab: true }`
  - `condition?` — JS expression for conditional execution
  - `dryRun?`

### `interaction({ action: "list" })`
List all interactions on an element.
- **Parameters**: `componentUuid`, `nodeRef`
- **Returns**: Array of `{ index, event, actionName, args, condition }`

### `interaction({ action: "update" })`
Modify an existing interaction.
- **Parameters**: `componentUuid`, `nodeRef`, `interactionIndex`, `actionName?`, `args?`, `condition?`, `dryRun?`

### `interaction({ action: "remove" })`
Remove an interaction from an element.
- **Parameters**: `componentUuid`, `nodeRef`, `interactionIndex` or `event` (remove all for event), `dryRun?`

## Acceptance Criteria
- [x] Can add onClick → navigateTo interaction
- [x] Can add onClick → setState interaction (requires state to exist)
- [x] Can add onClick → runCode interaction with custom JavaScript
- [x] Can add onMouseEnter/onMouseLeave interactions
- [x] Can list all interactions on a node
- [x] Can update an existing interaction's action or args
- [x] Can remove a specific interaction by index
- [x] Can remove all interactions for an event
- [x] Conditional interactions: `condition: "$ctx.isEnabled"`
- [x] Multiple interactions on same event (e.g., onClick → setState + navigateTo)
- [x] `inspect({ action: "node" })` output includes `interactions` array when present
- [x] Undo support
- [x] Batch mode support
- [x] Integration test: add onClick → navigateTo → list → verify → undo
- [x] Integration test: add onClick → setState → verify
- [x] Integration test: multiple interactions on same event
- [x] Unit tests for all action types and edge cases

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Add interaction to TplComponent instance | Allowed — components can have event handlers |
| Add interaction to TplSlot | Error: "Cannot add interactions to slots" |
| Invalid event name | Error: "Unknown event 'onBogus'. Available: onClick, ..." |
| Invalid action name | Error: "Unknown action 'doMagic'. Available: navigateTo, ..." |
| setState referencing non-existent state | Error: "State 'foo' not found on component. Available: [list]" |
| Remove by index out of range | Error: "Interaction index 5 out of range (0-2)" |
| navigateTo with page path that doesn't exist | Accept as-is (runtime resolution, not validated) |

## Out of Scope
- Animation triggers (handled by animation feature)
- Form validation interactions (would require form state patterns)
- Global event handlers (page-level onLoad, etc.) — component-scoped only
