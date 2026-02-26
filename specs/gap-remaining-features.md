# Remaining Gap Features

> **Note**: Domain assignments updated to reflect STRAP consolidation (Tier 6.1).

This spec covers the smaller gap features that don't warrant individual spec files.

## Jobs to Be Done
- As a Claude Code user, I want access to all Studio capabilities so that the MCP is a complete alternative to the visual editor

---

## 1. Reorder Children

### `node({ action: "reorder" })`
- **Parameters**: `componentUuid`, `parentRef`, `childRefs` (ordered array of UUID/name refs), `dryRun?`
- Reorders the children of a container to match the given order
- Uses TplMgr's `reorderChildren()`

### Acceptance Criteria
- [x] Can reorder children by providing new order
- [x] Missing children from list are appended at end
- [x] Unknown refs produce error
- [x] Undo support
- [x] Integration + unit tests

---

## 2. Convert Page <-> Component

### `component({ action: "convert-to-page" })`
- **Parameters**: `componentUuid`, `path`
- Converts a component to a page with the given URL path
- Uses TplMgr's `convertComponentToPage()`

### `component({ action: "convert-to-component" })`
- **Parameters**: `componentUuid`
- Converts a page to a regular component (removes pageMeta)
- Uses TplMgr's `convertPageToComponent()`

### Acceptance Criteria
- [x] Can convert component to page with path
- [x] Can convert page back to component
- [x] Path conflicts produce error
- [x] Undo support
- [x] Integration + unit tests

---

## 3. A/B Testing (Splits)

### `data({ action: "create-split" })`
- **Parameters**: `name`, `slices` (array of `{ name, weight }`)
- Creates a Split with SplitSlice entries

### `data({ action: "list-splits" })`
- **Parameters**: (none)
- Returns: Array of `{ splitUuid, name, slices }`

### `data({ action: "remove-split" })`
- **Parameters**: `splitRef` (name or UUID)
- Removes split

### Acceptance Criteria
- [x] Can create A/B test with weighted slices
- [x] Can list all splits
- [x] Can remove a split
- [x] Undo support
- [x] Integration + unit tests

---

## 4. Data Tokens

### `data({ action: "create-data-token" })`
- **Parameters**: `name`, `value` (JSON string), `type?` (default "Data")
- Creates a DataToken on the site

### `data({ action: "list-data-tokens" })`
- **Parameters**: (none)
- Returns: Array of `{ tokenUuid, name, value }`

### `data({ action: "update-data-token" })`
- **Parameters**: `tokenRef`, `value?`, `name?`

### `data({ action: "remove-data-token" })`
- **Parameters**: `tokenRef`

### Acceptance Criteria
- [x] Can create JSON data token
- [x] Can list, update, and remove data tokens
- [x] Usable in expressions: `$ctx.tokenName`
- [x] Undo support
- [x] Integration + unit tests

---

## 5. Extract to Component

### `component({ action: "extract" })`
- **Parameters**: `componentUuid`, `nodeRef`, `newName`
- Extracts a subtree into a new component, replacing the subtree with a component instance
- Returns: `{ newComponentUuid, instanceUuid }`

### Acceptance Criteria
- [x] Can extract subtree to new component
- [x] Original location has component instance
- [x] Styles and children preserved
- [x] Undo support
- [x] Integration + unit tests

---

## 6. Global Variant Groups

### `variant({ action: "create-global-group" })`
- **Parameters**: `name`, `type?` (single | multi | toggle), `initialVariants?`
- Creates a GlobalVariantGroup on the site

### `variant({ action: "create-screen" })` -- Deferred -- not included in STRAP consolidation
- **Parameters**: `name`, `minWidth?`, `maxWidth?`
- Creates a screen variant (responsive breakpoint)

### `variant({ action: "update-screen" })` -- Deferred -- not included in STRAP consolidation
- **Parameters**: `variantUuid`, `minWidth?`, `maxWidth?`
- Updates breakpoint media query

### `variant({ action: "rename" })` -- Deferred -- not included in STRAP consolidation
- **Parameters**: `componentUuid?`, `variantUuid`, `newName`
- Renames a variant

### `variant({ action: "remove" })` -- Deferred -- not included in STRAP consolidation
- **Parameters**: `componentUuid?`, `variantUuid`
- Removes a variant with cleanup

### Acceptance Criteria
- [x] Can create global variant group (e.g., "Dark Mode")
- [ ] Can create screen variant with media query (Deferred -- not included in STRAP consolidation)
- [ ] Can update screen variant breakpoint (Deferred -- not included in STRAP consolidation)
- [ ] Can rename any variant (Deferred -- not included in STRAP consolidation)
- [ ] Can remove any variant with cleanup (Deferred -- not included in STRAP consolidation)
- [x] Undo support
- [x] Integration + unit tests

---

## 7. Code Component Meta

### `data({ action: "get-code-meta" })`
- **Parameters**: `componentUuid`
- Returns code component metadata if present: `{ codeComponentMeta, subComponents, trapsFocus }`

### Acceptance Criteria
- [x] Can read code component metadata
- [x] Returns null/empty for non-code components
- [x] Unit tests

---

## 8. Custom Functions

### `data({ action: "list-functions" })`
- **Parameters**: (none)
- Returns: Array of `{ name, args, returnType }`

### Acceptance Criteria
- [x] Can list custom functions in project
- [x] Unit tests

---

## Edge Cases (All Features)
| Scenario | Expected behaviour |
|----------|-------------------|
| Operation on dependency project entity | Error: "Cannot modify entities from dependency projects" |
| Unknown ref for any operation | Error: "'{ref}' not found. Available: [list]" |
| Undo after batch | Error: "Cannot undo during active batch" |

## Out of Scope
- Arena/frame management (Studio-specific canvas management, not relevant for programmatic use)
