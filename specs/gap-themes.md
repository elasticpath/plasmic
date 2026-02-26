# Themes

> **Note**: Domain assignments updated to reflect STRAP consolidation (Tier 6.1).

## Jobs to Be Done
- As a Claude Code user building multi-brand sites, I want to read and manage themes so that the same components can have different visual treatments
- As a Claude Code user, I want to apply theme-specific token values so that design tokens change per theme

## Background

Studio's theme model: `Theme` has `defaultStyle` (Mixin) + named `ThemeStyle` entries. Themes override token values per variant, enabling multi-brand or dark/light mode support. Site has `themes: Array<Theme>` and `activeTheme`.

## Implementation

Theme management in the `design` domain (site-level design system entities).

### `design({ action: "list-themes" })`
- **Parameters**: (none)
- Returns: Array of `{ themeUuid, name, isActive, styles: string[] }`

### `design({ action: "create-theme" })`
- **Parameters**: `name`, `defaultStyles?` (Record<string, string>)
- Creates a Theme on the site

### `design({ action: "update-theme" })`
- **Parameters**: `themeRef` (name or UUID), `name?`, `defaultStyles?`
- Updates theme properties

### `design({ action: "remove-theme" })`
- **Parameters**: `themeRef` (name or UUID)
- Removes theme from site

### `design({ action: "set-active-theme" })`
- **Parameters**: `themeRef` (name or UUID)
- Sets the active theme for the project

## Acceptance Criteria
- [x] Can list all themes in project
- [x] Can create a new theme with default styles
- [x] Can update theme name and default styles
- [x] Can remove a theme
- [x] Can set the active theme
- [x] `design({ action: "list-tokens" })` reflects active theme overrides
- [x] Undo support
- [x] Batch mode support
- [x] Integration test: create theme → set active → read tokens → verify override
- [x] Unit tests for all operations

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Remove active theme | Error: "Cannot remove the active theme. Set a different theme first." |
| Duplicate theme name | Auto-deduplicate |
| Project with no themes | list-themes returns empty array |
| Theme from dependency project | Read-only |

## Out of Scope
- Theme inheritance (theme extending another theme)
- Theme preview (rendering with specific theme)
- Per-variant theme overrides
