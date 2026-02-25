# Border Support and CSS Validation

## Jobs to Be Done
- As a Claude Code user styling components, I want to set border properties (border, borderRadius, borderWidth, etc.) so that I can create cards, pills, dividers, and outlined elements
- As a Claude Code user, I want clear error messages listing valid CSS property names so that I can fix mistakes without trial-and-error

## Background

### Border Shorthand
`sanitizeStyles()` already expands `borderRadius`, `borderWidth`, `borderStyle`, and `borderColor` into their four longhands. However, the combined `border` shorthand (e.g., `"1px solid black"`) is NOT handled — it falls through to default and gets rejected by site-invariants.

### CSS Property Discovery
When `update-styles` rejects a property, the error says "bad style prop X" without suggesting valid alternatives. Users must guess property names. The `css-initials` package defines the valid property list, but it's not surfaced.

## Acceptance Criteria

- [ ] `border` shorthand (e.g., `"1px solid #FCA5A5"`) is parsed and expanded to 12 longhands: `border-{top,right,bottom,left}-{width,style,color}`
- [ ] `border-top`, `border-right`, `border-bottom`, `border-left` shorthands are parsed and expanded to their 3 longhands each
- [ ] `outline` shorthand is handled similarly (outline-width, outline-style, outline-color)
- [ ] When a property name is invalid, the error message includes: (a) the rejected property name, (b) a suggestion of valid alternatives (fuzzy match or "did you mean?"), (c) a hint about shorthand expansion
- [ ] A new tool `list-style-properties` (or parameter on existing tool) returns the full list of valid CSS property names accepted by `update-styles`
- [ ] `backgroundColor` mapping to `background` is documented in the tool description (or the tool accepts both names transparently)
- [ ] All border longhand properties pass validation: `border-top-width`, `border-top-style`, `border-top-color`, `border-top-left-radius`, etc.
- [ ] Unit tests cover `border` shorthand parsing with 1-value, 2-value, and 3-value forms
- [ ] Integration test verifies border properties apply to real TplTag

## Happy Path
1. User calls `update-styles` with `{ border: "1px solid #ccc", borderRadius: "8px" }`
2. `sanitizeStyles()` expands to 16 longhands (12 border + 4 radius)
3. All properties pass validation and apply to the node
4. Response shows the applied properties

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| `border: "1px solid"` (2 values, no color) | Expand width + style, skip color |
| `border: "1px"` (width only) | Expand to border-*-width only |
| `border: "solid"` (style only) | Expand to border-*-style only |
| `border: "none"` | Expand to border-*-style: none for all 4 sides |
| `border: "inherit"` | Apply inherit to all 12 longhands |
| `borderTop: "2px dashed red"` | Expand to border-top-width, border-top-style, border-top-color |
| Invalid property name `bordr` | Error: "Unknown style property 'bordr'. Did you mean 'border'?" |
| Property not in css-initials | Error lists closest valid properties |

## Out of Scope
- Full CSS shorthand parser for every CSS property (only border family + outline)
- CSS custom properties (var(--custom))
- Animation/transition shorthands
