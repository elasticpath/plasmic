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

**Studio behavior (researched):** Studio does NOT route visual styles to the component root. TplComponent instances only accept a fixed set of properties known as `TPL_COMPONENT_PROPS` — positioning (`position`, `top`, `left`, etc.), sizing (`width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`), margins (`margin*`), opacity, transform, and a few others. All other CSS properties (padding, background, border, color, fontSize, etc.) are silently ignored by codegen when applied to a TplComponent wrapper. There is no "visual vs layout" split — the wrapper simply cannot express most visual styles.

### Gap #37 (Medium) — Default 8px padding on box elements

Plasmic's `makeDefaultStylesFromElementType` sets `padding: 8px` on free boxes (`box`, `vbox`, `hbox`). When the LLM creates a box with `height: 2px` (e.g., a hamburger bar), it renders at 18px due to the default padding + border-box sizing. The LLM must discover and explicitly override this.

**Studio behavior:** Studio shows the default 8px padding in the style panel when a box is selected. There's no auto-zeroing — the default is intentional for general-purpose containers. But the MCP should communicate this clearly.

## Acceptance Criteria

### Gap #36: Component instance styling
- [x] Investigate how Studio applies styles to component instances — does it style the wrapper or the root?
  - **Finding:** Studio only allows `TPL_COMPONENT_PROPS` on TplComponent wrappers. All other properties are silently ignored by codegen. There is no routing to the component root.
- [x] When `update-styles` is called on a TplComponent with inapplicable properties, return an informational `note` listing the ignored properties and explaining that only TPL_COMPONENT_PROPS are effective
- [x] `TPL_COMPONENT_PROPS`-compatible styles are applied normally to the wrapper (current behavior, unchanged)
- [x] Unit tests: style TplComponent instance with mixed props, verify note lists inapplicable ones

### Gap #37: Box default padding
- [x] When `node.add-child` creates a box-type element (`box`, `vbox`, `hbox`) with an explicit `height` or `width` below a threshold (e.g., <= 16px), include a note in the response about default padding
- [x] Include default styles information in the `add-child` response: `{ defaults: { padding: "8px" } }` for box types
- [x] No auto-zeroing — the 8px default is intentional and matches Studio; the fix is informational only
- [x] Unit tests: add box with small height, verify note/defaults in response; add box without height, verify no special note

## Happy Path

### Component instance styling
1. LLM calls `node.update-styles({ componentUuid: "homepage", nodeRef: "scent-spotlight-instance", styles: { paddingLeft: "1.5rem", width: "100%" }, variant: "mobile" })`
2. MCP detects nodeRef is a TplComponent instance
3. MCP checks each property against `TPL_COMPONENT_PROPS`
4. Applies `width: 100%` to the wrapper (it is a valid TplComponent prop)
5. Skips `paddingLeft` (not in `TPL_COMPONENT_PROPS`)
6. Returns `{ ..., note: "Component instances only support positioning/sizing/margin/opacity/transform styles. These properties were not applied: paddingLeft. To style the component's internals, open the component and style its root element directly." }`
7. LLM learns which styles work on component instances and which require editing the component itself

### Box default padding
1. LLM calls `node.add-child({ ..., child: { type: "box", styles: { width: "20px", height: "2px" } } })`
2. MCP creates the box element (with Plasmic's default 8px padding)
3. Returns `{ ..., note: "Box elements have default padding: 8px. Your height (2px) will render larger due to padding + box-sizing. Set padding: '0px' to get exact dimensions.", defaults: { padding: "8px" } }`
4. LLM learns to include `padding: "0px"` in future calls

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| `update-styles` on TplTag (not component) | Current behavior — styles applied directly to the element |
| `update-styles` on TplComponent with `TPL_COMPONENT_PROPS` only (width, margin, etc.) | Applied to wrapper normally, no note |
| `update-styles` on TplComponent with inapplicable props (padding, background, border, etc.) | Inapplicable props skipped; informational `note` returned listing them |
| `update-styles` on TplComponent with mixed props | Valid props applied to wrapper; inapplicable props skipped with note |
| `add-child` with box and height: "auto" | No special note (auto height won't be affected by padding in the same way) |
| `add-child` with box and height: "100px" | No special note (100px is large enough that 8px padding is negligible) |
| `add-child` with vbox/hbox | Same behavior as box (all three have the 8px default) |

## Implementation Notes

### Component instance styling (edit-tools.ts)

In the `updateStyles` function, after resolving the TplNode:
1. Check if node is a TplComponent (`isKnownTplComponent(tpl)`)
2. If yes, partition the requested styles into two sets:
   - **Applicable:** Properties in `TPL_COMPONENT_PROPS` (position, top/right/bottom/left, width, height, minWidth, maxWidth, minHeight, maxHeight, margin*, opacity, transform, flex*, alignSelf, justifySelf, gridColumn, gridRow, etc.)
   - **Inapplicable:** Everything else (padding, background, border, color, fontSize, etc.)
3. Apply applicable styles to the wrapper's variant setting (current behavior, unchanged)
4. Skip inapplicable styles entirely — codegen would ignore them anyway
5. If any inapplicable styles were requested, add an informational `note` to the `UpdateStylesResult` listing them and explaining that component instances only support TPL_COMPONENT_PROPS

**Research conclusion:** Studio does not route visual styles to the component root. TplComponent wrappers only support `TPL_COMPONENT_PROPS`; all other properties are silently dropped by codegen. The implementation matches Studio by skipping inapplicable properties and informing the LLM.

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
