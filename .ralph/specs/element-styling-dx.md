# Element Styling DX Improvements

## Jobs to Be Done
- As an LLM adding responsive padding to component instances, I want `node.update-styles` on a TplComponent to apply styles where they'll actually take visual effect, so I don't waste calls styling invisible wrappers.
- As an LLM creating small UI elements (icon bars, dividers, lines), I want to know (or not need to know) about default padding on box elements, so my elements render at the dimensions I specify.

## Context

### Gap #36 (Medium) — Component instance padding doesn't propagate

When `update-styles` is called on a TplComponent instance (e.g., a Scent Spotlight component placed on a Homepage), padding is applied to the invisible wrapper node. The component's internal root element renders edge-to-edge regardless. The LLM must:
1. Discover this doesn't work
2. Inspect the component's internal structure
3. Find the root element UUID
4. Style that instead

**Studio behavior:** In Plasmic Studio, when you select a component instance and add padding, Studio applies it to the component's root element within the instance's variant setting. The MCP should match this behavior.

### Gap #37 (Medium) — Default 8px padding on box elements

Plasmic's `makeDefaultStylesFromElementType` sets `padding: 8px` on free boxes (`box`, `vbox`, `hbox`). When the LLM creates a box with `height: 2px` (e.g., a hamburger bar), it renders at 18px due to the default padding + border-box sizing. The LLM must discover and explicitly override this.

**Studio behavior:** Studio shows the default 8px padding in the style panel when a box is selected. There's no auto-zeroing — the default is intentional for general-purpose containers. But the MCP should communicate this clearly.

## Acceptance Criteria

### Gap #36: Component instance styling
- [ ] Investigate how Studio applies styles to component instances — does it style the wrapper or the root?
- [ ] Match Studio's exact behavior in `update-styles` for TplComponent nodes
- [ ] If styles are applied to an internal node, the response includes a note: "Styles applied to component root element '<name>' (<uuid>) rather than the instance wrapper"
- [ ] If the component root cannot be determined, fall back to wrapper styling with a warning
- [ ] Unit tests: style TplComponent instance, verify styles land on correct node, verify response note

### Gap #37: Box default padding
- [ ] When `node.add-child` creates a box-type element (`box`, `vbox`, `hbox`) with an explicit `height` or `width` below a threshold (e.g., <= 16px), include a note in the response: "Note: box elements have default padding: 8px. Your height: Xpx may render larger. Set padding: 0px explicitly if needed."
- [ ] Include default styles information in the `add-child` response: `{ defaults: { padding: "8px" } }` for box types
- [ ] Alternatively: auto-zero padding when height/width is explicitly set below threshold (investigate whether this matches Studio)
- [ ] Unit tests: add box with small height, verify note/defaults in response; add box without height, verify no special note

## Happy Path

### Component instance styling
1. LLM calls `node.update-styles({ componentUuid: "homepage", nodeRef: "scent-spotlight-instance", styles: { paddingLeft: "1.5rem" }, variant: "mobile" })`
2. MCP detects nodeRef is a TplComponent instance
3. MCP finds the component's root TplTag within the instance
4. Applies `paddingLeft: 1.5rem` to the root element's variant setting
5. Returns `{ ..., note: "Styles applied to component root element 'Scent Spotlight Root' (abc123) rather than the instance wrapper" }`
6. The padding actually takes visual effect

### Box default padding
1. LLM calls `node.add-child({ ..., child: { type: "box", styles: { width: "20px", height: "2px" } } })`
2. MCP creates the box element (with Plasmic's default 8px padding)
3. Returns `{ ..., note: "Box elements have default padding: 8px. Your height (2px) will render larger due to padding + box-sizing. Set padding: '0px' to get exact dimensions.", defaults: { padding: "8px" } }`
4. LLM learns to include `padding: "0px"` in future calls

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| `update-styles` on TplTag (not component) | Current behavior — styles applied directly to the element |
| `update-styles` on TplComponent with layout styles (display, flex) | Apply to wrapper (these affect the instance's position in parent, not the component's internals) |
| `update-styles` on TplComponent with visual styles (padding, background, border) | Apply to component root (these affect the component's appearance) |
| Component root is a TplComponent (nested components) | Apply to the outermost component's root; don't recurse |
| Component has no identifiable root (empty or slot-only) | Fall back to wrapper styling with warning |
| `add-child` with box and height: "auto" | No special note (auto height won't be affected by padding in the same way) |
| `add-child` with box and height: "100px" | No special note (100px is large enough that 8px padding is negligible) |
| `add-child` with vbox/hbox | Same behavior as box (all three have the 8px default) |

## Implementation Notes

### Component instance styling (edit-tools.ts)

In the `updateStyles` function, after resolving the TplNode:
1. Check if node is a TplComponent (`isKnownTplComponent(tpl)`)
2. If yes, determine style category:
   - **Layout styles** (display, flexDirection, alignItems, justifyContent, width, height, margin*, position, gridColumn, gridRow, flex*): Apply to wrapper (these control the instance's placement)
   - **Visual styles** (padding*, background*, border*, color, fontSize, etc.): Apply to component root
3. Find the component root: `tpl.component.tplTree` (the root TplTag of the referenced component)
4. Apply visual styles to the root's variant setting
5. Apply layout styles to the wrapper's variant setting (current behavior)

**Important:** Investigate whether Studio actually does this split, or whether it always styles the wrapper. The implementation must match Studio exactly.

### Box default padding (edit-tools.ts)

In `addChild`, after creating the element:
1. Check if element type is `box`, `vbox`, or `hbox`
2. Check if explicit `height` or `width` is provided and is a small value (parse px/rem values)
3. If so, add `note` and `defaults` to the response

No auto-zeroing — the 8px default is intentional and matches Studio. The fix is informational.

## Out of Scope
- Changing Plasmic's default styles for box elements
- Auto-propagating ALL styles to component internals
- Modifying how Studio handles component instance styling
