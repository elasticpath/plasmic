# Variant-Aware Editing

## Jobs to Be Done

- As a developer, I want to set responsive styles (e.g., mobile breakpoint overrides) via Claude Code so that pages are responsive without manual Studio editing.
- As a developer, I want to set interaction styles (hover, focus, pressed) via Claude Code so that components have interactive states.
- As a developer, I want to see what variants exist in my project (breakpoints, interaction states, custom variants) so I can target them in edits.

## Architecture

### Current Problem

All edit tools (`update-text`, `update-styles`) in `edit-tools.ts` operate exclusively on the base variant. The code explicitly calls `tplMgr.ensureBaseVariantSetting(tpl)` — there is no way to target a different variant. This means:

- All styles are desktop-only (no responsive breakpoints)
- No hover/focus/pressed states
- No custom variant overrides (e.g., theme variants)

### WAB Model Background

Every `TplNode` has `vsettings: VariantSetting[]`. Each `VariantSetting` has:
- `variants: Variant[]` — the variant combo this setting applies to
- `rs: RuleSet` — CSS rules for this variant
- `text: RichText | null` — text override for this variant

Variants are organized in groups:
- **Screen variants** (`GlobalVariantGroup` with `type: "global-screen"`) — responsive breakpoints with `mediaQuery` strings
- **Style variants** — hover/focus/pressed states with `selectors` arrays (e.g., `[":hover"]`)
- **Component variants** — custom variant groups defined per component
- **Global user-defined** (`type: "global-user-defined"`) — theme variants, A/B test variants

The base variant is `component.variants[0]` and is identified by `isBaseVariant(vs.variants)`.

### Solution

Add an optional `variant` parameter to `update-text` and `update-styles`. Add a `list-variants` tool. Resolve variants by name, UUID, or selector string.

### New Tool: `list-variants`

Returns all variants for a component and the project's global variants.

```typescript
// Input
{ componentUuid: string }

// Output
{
  globalVariants: [
    { group: "Screen", type: "global-screen", variants: [
      { uuid: "...", name: "Mobile", mediaQuery: "(max-width: 768px)" },
      { uuid: "...", name: "Tablet", mediaQuery: "(max-width: 1024px)" }
    ]},
    { group: "Theme", type: "global-user-defined", variants: [
      { uuid: "...", name: "Dark" }
    ]}
  ],
  componentVariants: [
    { group: "Size", variants: [
      { uuid: "...", name: "Small" },
      { uuid: "...", name: "Large" }
    ]}
  ],
  styleVariants: [
    { uuid: "...", name: "hover", selectors: [":hover"], forTpl: "uuid-of-element" }
  ]
}
```

### Enhanced `update-styles` and `update-text`

Add optional `variant` parameter:

```typescript
// Current (base variant — unchanged behavior when variant omitted)
{ componentUuid, nodeRef, styles: { color: "red" } }

// New: target a screen variant by name
{ componentUuid, nodeRef, styles: { fontSize: "14px" }, variant: "Mobile" }

// New: target a style variant by selector
{ componentUuid, nodeRef, styles: { color: "blue" }, variant: ":hover" }

// New: target by UUID
{ componentUuid, nodeRef, styles: { opacity: "0.5" }, variant: "uuid-of-variant" }
```

### Variant Resolution

Resolve the `variant` string parameter to a `Variant` object:

1. **By UUID** — exact match in all variant groups
2. **By name** — search global variant groups, then component variant groups (case-insensitive)
3. **By selector** — search style variants matching `v.selectors.includes(variant)` (e.g., `":hover"`)
4. **Ambiguous** — if multiple matches, return error listing all matches with UUIDs

Once resolved, use `ensureVariantSetting(tpl, [variant])` to get or create the `VariantSetting`, then apply edits to its `rs` or `text`.

### Files to Modify

1. **`packages/plasmic-mcp/src/edit-tools.ts`** — Add `variant` parameter to `updateStyles()` and `updateText()`. Add variant resolution logic. Replace `tplMgr.ensureBaseVariantSetting(tpl)` with conditional: if variant provided, use `ensureVariantSetting(tpl, [resolvedVariant])`, else base.

2. **`packages/plasmic-mcp/src/server.ts`** — Add `list-variants` tool. Add optional `variant` Zod parameter to `update-text` and `update-styles` tool schemas.

3. **`packages/plasmic-mcp/src/wab.d.ts`** — Add type declarations for `ensureVariantSetting`, `isScreenVariant`, `isStyleVariant`, `isBaseVariant`, and related functions from `@/wab/shared/Variants`.

4. **`.claude/commands/plasmic-edit.md`** — Document variant-aware editing workflow: list-variants → update-styles with variant parameter.

5. **`.claude/commands/plasmic-inspect.md`** — Document `list-variants` tool.

6. **`.claude/commands/plasmic.md`** — Add routing for "make it responsive" / "add hover state" → `/plasmic-edit` with variant guidance.

### Files to Create

None — all changes are additions to existing files.

## Acceptance Criteria

### Must Have

- [x] `list-variants` tool registered in server.ts, returns global + component + style variants
- [x] `update-styles` accepts optional `variant` parameter (backward compatible — omit for base)
- [x] `update-text` accepts optional `variant` parameter (backward compatible — omit for base)
- [x] Variant resolution by UUID, name, and selector string
- [x] Descriptive error when variant not found (lists available variants)
- [x] Descriptive error when variant is ambiguous (lists matches with UUIDs)
- [x] Unit tests: update-styles with variant targets correct VariantSetting
- [x] Unit tests: update-styles without variant still targets base (backward compatible)
- [x] Unit tests: list-variants returns correct structure
- [x] Unit tests: variant resolution by name, UUID, selector
- [x] Skill file updates documenting variant workflow
- [x] All existing tests continue to pass

### Nice to Have

- [x] `create-style-variant` tool — create a new hover/focus/pressed variant for an element
- [x] `create-variant-group` tool — create a new component variant group
- [ ] Support variant combos (e.g., "Mobile" + ":hover" simultaneously)
- [ ] `get-node-details` includes variant-specific overrides in output

## Happy Path

### Responsive styles
1. Developer asks: "Make the hero text smaller on mobile"
2. `/plasmic-edit` calls `list-variants` to find screen variants
3. Finds "Mobile" variant with `mediaQuery: "(max-width: 768px)"`
4. Calls `update-styles` with `{ variant: "Mobile", styles: { fontSize: "18px" } }`
5. Style is applied to the Mobile variant's VariantSetting, not the base

### Hover state
1. Developer asks: "Add a hover effect to the button"
2. `/plasmic-edit` calls `list-variants` to find style variants
3. Finds ":hover" variant (or creates one if not present — nice-to-have)
4. Calls `update-styles` with `{ variant: ":hover", styles: { backgroundColor: "#0056b3" } }`

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Variant parameter omitted | Base variant (backward compatible — no behavior change) |
| Variant name matches both global and component variant | Return ambiguity error with UUIDs |
| Screen variant group empty (no breakpoints defined) | `list-variants` returns empty screen variants array |
| Style variant doesn't exist for element | Error: "No :hover variant found for this element. Use create-style-variant to add one." |
| Component has no custom variant groups | `list-variants` returns empty componentVariants array |

## Out of Scope

- Creating responsive breakpoint groups (these are project-level Studio settings)
- Variant-aware `add-child` (always adds to base variant)
- Variant-aware `remove-child` or `move-child` (structural edits are variant-independent)
- Real-time preview of variant changes
