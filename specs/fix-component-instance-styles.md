# Fix: Widen updateStyles Gate to Accept TplComponent

## Jobs to Be Done
- As a Claude Code user, I want to style component instances (TplComponent) via the MCP so that I can customize Cards, Headers, etc. after placing them on a page
- As a developer, I want MCP gates to match what Studio's UI allows — no more restrictive, no less

## Background

WAB functions (RSH, ensureBaseVariantSetting, etc.) do NOT validate node types — they accept anything silently. In Studio, the **UI itself** prevents invalid operations (you can't drag a child onto a TplSlot, you can't type HTML attributes onto a component instance). Since the MCP bypasses the UI, it needs its own validation gates — but only where WAB would **silently corrupt** the model.

**The principle: match what Studio's UI allows.** Not "remove all gates and let WAB handle it" (WAB doesn't handle it — it silently accepts everything). Not "keep all gates" (some are more restrictive than Studio).

### Why updateStyles is the only gate to change

| Operation on TplComponent | WAB behavior | Studio allows? | Gate correct? |
|---------------------------|-------------|----------------|---------------|
| `updateStyles` | RSH treats as `forTag="div"`, styles ARE meaningful and rendered | **Yes** — Studio styles component instances | **Gate too restrictive — widen** |
| `updateAttrs` | `vs.attrs` stored but **codegen ignores** them. Component props go through `args`, not HTML attrs | **No** — Studio uses component props UI | **Gate correct — keep** |
| `addChild` (direct) | `insertChild` silently creates `.children` property that doesn't exist in schema | **No** — Studio uses slot UI | **Gate correct — keep** (TplComponent handled by slot path above) |
| `moveChild` (direct) | Same as addChild | **No** | **Gate correct — keep** (TplComponent handled by slot path above) |
| `reorderChildren` | `TplMgr.reorderChildren` typed as `tpl: TplTag`. Would crash or corrupt | **No** | **Gate correct — keep** |

## Implementation

### 1. Widen `updateStyles()` gate to accept TplComponent

Change line 1956 from:
```typescript
if (!isKnownTplTag(resolved.node)) {
  throw new Error(`Node "${nodeRef}" is not a TplTag and cannot have styles updated.`);
}
```
To:
```typescript
if (!isKnownTplTag(resolved.node) && !isKnownTplComponent(resolved.node)) {
  throw new Error(
    `Node "${nodeRef}" is a ${resolved.node.constructor?.name ?? "non-element"} and cannot have styles updated. ` +
    `Only HTML elements and component instances support styling.`
  );
}
```

This matches the pattern already used by `setVisibility()`, `setDataCond()`, and `setDataRep()`.

### 2. Keep all other gates as-is

- `updateAttrs()` — TplTag only. Component props are set via `args`, not HTML attrs.
- `addChild()` / `moveChild()` — TplComponent is already handled by the slot path above the gate. The gate correctly catches TplSlot and other non-container types.
- `reorderChildren()` — TplTag only. TplComponent children are in slot args, not `.children`.
- `updateText()` / `updateRichText()` — TplTag only. TplComponent doesn't have text content.
- `setImage()` — TplTag only. Only `<img>` tags have image sources.
- Interaction tools — TplTag only. Only HTML elements have EventHandler attrs.
- `createStyleVariant()` — Keep TplTag-only until tested in Studio.

## Acceptance Criteria
- [ ] `updateStyles` works on TplComponent instances (the original bug)
- [ ] `updateStyles` still rejects TplSlot with clear error message
- [ ] All other mutation tool gates unchanged
- [ ] Unit tests: updateStyles on TplComponent node succeeds
- [ ] Unit tests: updateStyles on TplSlot node fails with clear error
- [ ] Integration test: add component instance → style it → read back → verify styles applied
- [ ] All existing tests still pass

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Style a TplComponent | Works — RSH handles it (defaults to "div") |
| Style a TplSlot | Rejected with clear error: "only HTML elements and component instances support styling" |
| Set attrs on TplComponent | Rejected (existing gate) — use component props instead |
| Add child to TplComponent without slot | Handled by slot path — defaults to "children" slot |

## Out of Scope
- Changing WAB/Studio code — only MCP-layer validation is modified
- Removing gates where WAB would silently corrupt the model
- `updateAttrs` on TplComponent (would need codegen support first)
