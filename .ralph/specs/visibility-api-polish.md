# Visibility API Polish

## Jobs to Be Done
- As an LLM hiding elements on mobile, I want `node.set-visibility` to accept `visible: false` (boolean) as a natural way to hide elements, so I don't need to discover the undocumented `"displayNone"` string.

## Context

**Gap #34 (Major).** The Zod schema in `server.ts:2594` is:
```typescript
visible: z.union([z.boolean(), z.literal("displayNone")])
```

This technically accepts booleans, but the implementation in `edit-tools.ts:4017-4120` treats `false` as "notRendered" (removes from DOM entirely via `dataCond = false`) rather than "displayNone" (keeps in DOM but hidden via CSS).

The distinction matters:
- `false` (notRendered): Element is not rendered at all. No DOM node exists. Cannot be animated.
- `"displayNone"`: Element exists in DOM but has `display: none`. Can be toggled visible via CSS/JS.

For responsive design (the primary use case), `"displayNone"` is almost always what's wanted — the element should exist but be hidden on certain breakpoints. `notRendered` is for conditional rendering (e.g., show only if logged in).

## Acceptance Criteria

- [ ] `visible: false` continues to mean "notRendered" (preserving existing behavior)
- [ ] `visible: "displayNone"` continues to work as today
- [ ] New alias: `visible: "hidden"` maps to `"displayNone"` (more intuitive name)
- [ ] Tool description clearly documents all three states: `true` (visible), `false` (not rendered), `"hidden"` or `"displayNone"` (CSS hidden)
- [ ] Error messages include the valid options when an invalid value is passed
- [ ] Response includes a note explaining what "displayNone" means vs "notRendered" when `false` is used, so LLMs learn the distinction
- [ ] Unit tests cover: true, false, "displayNone", "hidden", invalid values

## Happy Path

1. LLM wants to hide desktop nav links on mobile
2. Calls `node.set-visibility({ componentUuid, nodeRef, visible: "hidden", variant: "gxy_zBgc0J-_" })`
3. MCP sets `dataCond` and `plasmic-display-none` marker on the variant setting
4. Element is hidden via CSS on mobile, visible on desktop

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| `visible: false` | "notRendered" — element removed from DOM. Response includes note: "Element will not be rendered. Use 'hidden' for CSS display:none." |
| `visible: "hidden"` | Maps to "displayNone" — CSS hidden, still in DOM |
| `visible: "displayNone"` | Same as "hidden" (backwards compatible) |
| `visible: true` | Element is visible (clears dataCond and display-none marker) |
| `visible: 0` or `visible: ""` | Reject with error listing valid values |
| `visible: "none"` | Reject with error: "Did you mean 'hidden'? Valid values: true, false, 'hidden', 'displayNone'" |

## Implementation Notes

### Zod schema change (server.ts ~2594)
```typescript
visible: z.union([
  z.boolean(),
  z.literal("displayNone"),
  z.literal("hidden"),
]).describe("Visibility: true (visible), false (not rendered), 'hidden' or 'displayNone' (CSS hidden)")
```

### setVisibility logic (edit-tools.ts ~4076)
Add early normalization:
```typescript
const normalizedVisible = visible === "hidden" ? "displayNone" : visible;
```
Then use `normalizedVisible` throughout.

### Response enhancement
When `visible === false`, include in response:
```
Note: "false" removes the element from the DOM entirely (not rendered). If you want to hide it via CSS (display:none) while keeping it in the DOM, use "hidden" instead.
```

## Out of Scope
- Adding new visibility states beyond the three Plasmic supports
- Changing the meaning of `false` (that would break existing behavior)
