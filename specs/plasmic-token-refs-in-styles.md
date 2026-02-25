# Design Token References in Styles

## Jobs to Be Done
- As a Claude Code user, I want to reference design tokens by name in `update-styles` so that my edits stay connected to the project's design system instead of using hardcoded values

## Background

`get-tokens` returns design tokens with their UUIDs, names, types, and resolved values. However, `update-styles` only accepts raw CSS values. Studio stores token references as `StyleTokenRef` expressions, but the MCP's style update path uses `RSH.merge()` which only accepts string values.

In the Plasmic model, style token references are stored specially — they're not just `var(--token-uuid)` strings. The tree reader recognizes `StyleTokenRef` in attrs but styles go through a different path.

## Acceptance Criteria

- [ ] `update-styles` accepts token references in the format `token:TokenName` or `token:uuid` as style values
- [ ] When a token reference is detected, the system looks up the token in `site.styleTokens` by name or UUID
- [ ] If found, the resolved CSS value is used for the `RSH.merge()` call (so the style applies correctly)
- [ ] The token reference is preserved as metadata so `get-component-tree` / `get-node-details` shows `"token:Primary Blue"` alongside the resolved value
- [ ] Token name lookup is case-insensitive for convenience
- [ ] Error if referenced token doesn't exist: "Token 'X' not found. Available tokens: [list by type]"
- [ ] Token type is validated against the CSS property (e.g., a Color token shouldn't be used for padding)
- [ ] Unit tests verify token resolution and application
- [ ] Integration test verifies token reference with real site.styleTokens

## Happy Path
1. User calls `get-tokens` and sees `{ name: "Primary Blue", uuid: "abc", type: "Color", value: "#0066cc" }`
2. User calls `update-styles` with `{ color: "token:Primary Blue" }`
3. System resolves "Primary Blue" to `#0066cc` and applies it
4. `get-node-details` shows `color: "#0066cc"` with `tokenRef: "Primary Blue"`

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Token name with spaces: `"token:Primary Blue"` | Matched by full name (everything after `token:`) |
| Token name ambiguous (multiple tokens with same name) | Error listing matches with their types |
| Token value is itself a reference (chain) | Resolve the full chain to the final CSS value |
| Token from a dependency (not local) | Search across all accessible tokens |
| `token:` prefix with no name | Error: "Token name required after 'token:'" |

## Out of Scope
- Creating or modifying design tokens
- Mixin/theme references
- Token aliases or grouping
