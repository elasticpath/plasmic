# Mixins (Reusable Style Collections)

## Jobs to Be Done
- As a Claude Code user building a design system, I want to create reusable style collections (mixins) so that consistent styling is applied across elements without duplication
- As a Claude Code user, I want to apply and remove mixins from elements so that style changes propagate automatically

## Background

Studio's mixins are site-level reusable style bundles. A mixin has a name and a RuleSet (CSS properties). Elements reference mixins in their VariantSetting's `rs.mixins[]`. When a mixin is updated, all elements using it reflect the change.

TplMgr provides: `addMixin()`, `removeMixin()`, `renameMixin()`, `duplicateMixin()`, `extractToMixin()`.

## Implementation

Mixin CRUD integrates into the `component` domain (site-level operations) and mixin application into the `node` domain.

### `component({ action: "create-mixin" })`
- **Parameters**: `name`, `styles` (Record<string, string>)
- Creates a Mixin with the given CSS properties
- Returns: `{ mixinUuid, name, styles }`

### `component({ action: "list-mixins" })`
- **Parameters**: (none)
- Returns: Array of `{ mixinUuid, name, styles }`

### `component({ action: "update-mixin" })`
- **Parameters**: `mixinRef` (name or UUID), `styles` (Record<string, string>), `name?`
- Updates mixin CSS properties and/or name

### `component({ action: "remove-mixin" })`
- **Parameters**: `mixinRef` (name or UUID)
- Removes mixin from site + from all element references

### `node({ action: "apply-mixin" })`
- **Parameters**: `componentUuid`, `nodeRef`, `mixinRef`, `variant?`, `dryRun?`
- Adds mixin to element's VariantSetting rs.mixins[]

### `node({ action: "remove-mixin" })`
- **Parameters**: `componentUuid`, `nodeRef`, `mixinRef`, `variant?`, `dryRun?`
- Removes mixin from element's rs.mixins[]

## Acceptance Criteria
- [x] Can create a mixin with CSS properties
- [x] Can list all mixins in the project
- [x] Can update mixin styles (changes propagate to all elements using it)
- [x] Can rename a mixin
- [x] Can remove a mixin (cleaned up from all element references)
- [x] Can apply a mixin to an element
- [x] Can remove a mixin from an element
- [x] `inspect({ action: "node" })` output includes `mixins` array when element uses mixins
- [x] `inspect({ action: "tokens" })` or new action lists available mixins
- [x] Undo support for all mixin operations
- [x] Batch mode support
- [x] Integration test: create mixin → apply to element → read back → update mixin → verify change propagated
- [x] Unit tests for all CRUD operations

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Duplicate mixin name | Auto-deduplicate: "Card Style" → "Card Style 2" |
| Remove mixin used by elements | Remove from all elements, then delete mixin |
| Apply same mixin twice to element | No-op (already applied) |
| Mixin with shorthand CSS | Expanded to longhands (same as update-styles) |
| Reference mixin from dependency project | Allow read, disallow mutation |

## Out of Scope
- extractToMixin (extracting element styles into a new mixin) — convenience feature for later
- Mixin inheritance (mixin referencing another mixin)
