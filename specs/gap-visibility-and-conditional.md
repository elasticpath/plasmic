# Visibility & Conditional Rendering

> **Note**: Domain assignments updated to reflect STRAP consolidation (Tier 6.1).

## Jobs to Be Done
- As a Claude Code user building responsive pages, I want to hide/show elements per variant so that layouts adapt to screen sizes
- As a Claude Code user building dynamic UIs, I want to set data conditions on elements so that content renders conditionally

## Background

Studio uses `TplVisibility` enum and `dataCond` (CustomCode/ObjectPath) on VariantSetting. The MCP currently has no way to control element visibility.

## Implementation

Two new actions split across the `node` domain (visibility) and `data` domain (conditional rendering):

### `set-visibility`
- **Parameters**: `componentUuid`, `nodeRef`, `visible` (boolean | "displayNone"), `variant?`, `dryRun?`
- `visible: true` — element is shown (removes visibility override for variant)
- `visible: false` — element is hidden for this variant (not rendered)
- `visible: "displayNone"` — sets visibility to CSS display:none (hidden but occupies no space)
- Uses `setTplVisibility()` from WAB's tpls module, or equivalent VariantSetting mutation

### `set-data-cond`
- **Parameters**: `componentUuid`, `nodeRef`, `condition` (string | null), `variant?`, `dryRun?`
- `condition: "$ctx.user.isLoggedIn"` — creates CustomCode expression on VariantSetting.dataCond
- `condition: null` — removes data condition
- The condition string is a JavaScript expression evaluated at render time

## Acceptance Criteria
- [x] `node({ action: "set-visibility", visible: false, variant: "Mobile" })` hides element on mobile
- [x] `node({ action: "set-visibility", visible: true })` restores default visibility
- [x] `data({ action: "set-data-cond", condition: "$ctx.showBanner" })` sets conditional rendering
- [x] `data({ action: "set-data-cond", condition: null })` removes condition
- [x] `inspect({ action: "node" })` output includes `visibility` and `dataCond` fields when set
- [x] Undo support for both actions
- [x] Batch mode support
- [x] Variant-aware (can set per-variant visibility)
- [x] Integration test: set visibility → read back → undo → verify restored
- [x] Integration test: set data-cond → read back → verify expression
- [x] Unit tests for all happy/edge paths

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| set-visibility on component root | Allowed — root can be conditionally hidden |
| set-visibility without variant | Applies to base variant |
| set-data-cond with invalid JS expression | Accept as-is (server doesn't validate JS) — Studio does the same |
| Reading visibility when not explicitly set | Output omits field (implicit "visible") |

## Out of Scope
- Direct CSS display manipulation (the `displayNone` visibility value handles this through the visibility API)
- Visibility animations/transitions
