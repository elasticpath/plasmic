# Style Token CRUD

> **Note**: Domain assignments updated to reflect STRAP consolidation (Tier 6.1).

## Jobs to Be Done
- As a Claude Code user building a design system, I want to create, rename, and delete style tokens so that I can manage the project's design system programmatically
- As a Claude Code user, I want to organize tokens by type so that colors, spacing, and typography are consistently defined

## Background

The MCP can currently read tokens (`get-tokens`) and reference them in styles (`token:Name`). Studio additionally supports full token lifecycle via TplMgr: `addStyleToken()`, `renameStyleToken()`, `duplicateStyleToken()`, and removal.

Token types: Color, Spacing, Opacity, LineHeight, FontFamily, FontSize.

## Implementation

Token CRUD integrates into the `design` domain (site-level design system entities).

### `design({ action: "create-token" })`
- **Parameters**: `name`, `tokenType` (Color | Spacing | Opacity | LineHeight | FontFamily | FontSize), `value`
- Creates a StyleToken on the site
- Returns: `{ tokenUuid, name, type, value }`

### `design({ action: "update-token" })`
- **Parameters**: `tokenRef` (name or UUID), `value?`, `name?`
- Updates token value and/or name

### `design({ action: "remove-token" })`
- **Parameters**: `tokenRef` (name or UUID)
- Removes token from site + cleans up references in styles

### `design({ action: "duplicate-token" })`
- **Parameters**: `tokenRef` (name or UUID), `newName?`
- Duplicates token with optional new name

## Acceptance Criteria
- [x] Can create Color token: `create-token({ name: "Primary Blue", type: "Color", value: "#0066FF" })`
- [x] Can create Spacing token: `create-token({ name: "Space MD", type: "Spacing", value: "16px" })`
- [x] Can create FontFamily token
- [x] Can update token value (changes propagate to all usages)
- [x] Can rename token (references update automatically via TplMgr)
- [x] Can remove token (cleaned up from all style references)
- [x] Can duplicate token
- [x] `design({ action: "list-tokens" })` shows created tokens
- [x] Token reference syntax `token:Name` works with newly created tokens
- [x] Undo support for all token operations
- [x] Batch mode support
- [x] Integration test: create token → apply to element → update token → verify propagation
- [x] Unit tests for all CRUD operations

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Duplicate token name | Auto-deduplicate: "Primary Blue" → "Primary Blue 2" |
| Remove token used in styles | Clean up all references, set styles to resolved literal value |
| Invalid value for type | Accept as-is (Studio doesn't validate token values strictly) |
| Token referencing another token | Allowed (token chains) — value resolves through chain |
| Token from dependency project | Read-only, cannot modify |

## Out of Scope
- Varianted token values (variant-specific token overrides — advanced theme feature)
- Token grouping/organization beyond type
