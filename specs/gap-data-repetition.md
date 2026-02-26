# Data Repetition (Collection Rendering)

## User Story
- As a Claude Code user building data-driven pages, I want to repeat an element for each item in a collection (e.g., product cards, blog posts, table rows) so that I can create dynamic lists without manual duplication.

## Background
Studio's data repetition model: `VariantSetting.dataRep` is a `Rep` object with:
- `element: Var` — loop variable name (e.g., `currentItem`) accessible in child expressions as `$ctx.currentItem`
- `index: Var | null` — optional index variable (e.g., `currentIndex`) accessible as `$ctx.currentIndex`
- `collection: CustomCode | ObjectPath` — JS expression evaluating to an array (e.g., `$queries.products.data`, `$ctx.items`, `[1,2,3]`)

Data repetition is set on a VariantSetting, making it variant-aware. When set, the element and all its children are rendered once per item in the collection. The loop variables are available in child scopes for dynamic text, data-cond, styles, etc.

Data repetition auto-creates implicit component states (tracked by `states.ts`). When a rep is set, child state references are scoped to each repeated instance.

## New MCP Actions

### `set-data-rep` (data domain)
Sets or clears data repetition on an element.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `componentUuid` | string | yes | Component containing the element |
| `nodeRef` | string | yes | Target element (UUID, name, path, index) |
| `collection` | string | yes* | JS expression for the array (e.g., `$queries.products.data`). Pass `null` to remove repetition. |
| `elementVariable` | string | no | Loop variable name (default: `currentItem`). Accessible as `$ctx.<name>`. |
| `indexVariable` | string | no | Index variable name (default: `currentIndex`). Pass `null` to omit. |
| `variant` | string | no | Target variant (name, UUID, or selector) |
| `dryRun` | boolean | no | Preview without persisting |

*Required unless removing repetition.

**Behavior:**
- When `collection` is a non-null string: creates a `Rep` object with `Var` for element/index variables and a `CustomCode` expr for the collection, sets it on the target node's VariantSetting.
- When `collection` is `null`: removes the `dataRep` from the VariantSetting.
- Loop variables must be valid JS identifiers.
- The element variable is available in descendant scopes as `$ctx.<elementVariable>`.

## WAB Backing

- **Model type**: `Rep` from `shared/model/classes.ts` — fields: `element: Var`, `index: Var | null`, `collection: CustomCode | ObjectPath`
- **Setting**: Direct mutation of `VariantSetting.dataRep`
- **Variable creation**: `Var` from model classes, with unique variable names
- **Implicit state**: `addComponentState` in `states.ts` may auto-create implicit states for repeated elements
- **Reference locations**: `shared/core/tpls.ts`, `shared/core/states.ts`, `shared/effective-variant-setting.ts`

## Tree Reader Extension

`inspect({ action: "node" })` / `get-node-details` must include:
```json
{
  "dataRep": {
    "collection": "$queries.products.data",
    "elementVariable": "currentProduct",
    "indexVariable": "currentIndex"
  }
}
```

Only present when `dataRep` is set on the base (or queried) variant.

## Acceptance Criteria

- [x] `set-data-rep` with collection expression enables element repetition
- [x] `set-data-rep` with custom element/index variable names
- [x] `set-data-rep` with `collection: null` removes repetition
- [x] Loop variables usable in descendant dynamic text (`$ctx.currentItem.name`)
- [x] Loop variables usable in descendant data-cond (`$ctx.currentItem.isActive`)
- [x] `inspect` / `get-node-details` includes `dataRep` field when set
- [x] Variant-aware (per-variant repetition)
- [x] Undo support
- [x] Batch mode support
- [x] Integration test: set rep → use loop var in child dynamic text → read back → verify
- [x] Unit tests for all happy/edge paths

## Cross-Tool Integration

- **Data Queries** (`gap-data-queries.md`): Collection expression typically references `$queries.queryName.data`
- **Dynamic Text** (`update-text` with `dynamic: true`): Descendant text can use `$ctx.currentItem.field`
- **Conditional Visibility** (`gap-visibility-and-conditional.md`): `set-data-cond` can use `$ctx.currentItem.isActive`
- **State Management** (`gap-state-management.md`): Implicit states auto-created for repeated elements

## Effort Estimate

Low-medium — single action (set/clear) with Rep object construction. Main complexity is Var creation and ensuring implicit state integration works correctly.
