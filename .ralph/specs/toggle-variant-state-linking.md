# Toggle Variant State Linking

## Jobs to Be Done
- As an LLM building interactive components (hamburger menus, modals, accordions, tabs), I want `variant.create-group` with `type: "toggle"` to produce a fully-linked implicit boolean state so that `interaction.add` with `updateVariable` can toggle the variant without requiring DOM hacks.

## Context

**Gap #33 (Critical).** Currently `createVariantGroup()` in `edit-tools.ts:3928-4015` calls `tplMgr.createVariantGroup({ component, name, optionsType: "standalone" })`. TplMgr internally creates a `StateParam`, `StateChangeHandlerParam`, and a `NamedState` linked to the variant group's implicit state. However, the MCP code:

1. Does not capture or return the created implicit state
2. Does not verify the state is linked to the variant
3. Returns only the variant group UUID and variant UUIDs

Additionally, `buildActionArgs()` in `edit-tools.ts:5698-5721` (the `updateVariable` handler) builds an `ObjectPath` to `$state.<stateName>`. When the LLM passes the variant group name instead of the implicit state variable name, the ObjectPath targets a non-existent variable, producing a silent runtime no-op.

**Root cause:** TplMgr does the right thing internally. The MCP just doesn't expose or leverage the result.

## Acceptance Criteria

- [ ] `variant.create-group` with `type: "toggle"` returns the linked implicit state name and UUID in its response
- [ ] The implicit state created by TplMgr is correctly captured from `component.states` after group creation
- [ ] `interaction.add` with `updateVariable` accepts EITHER the implicit state variable name OR the variant group name as the `variable` arg
- [ ] When a variant group name is passed as `variable`, it auto-resolves to the linked implicit state's `ObjectPath`
- [ ] The toggle interaction actually works at runtime: clicking the element toggles the variant on/off
- [ ] Unit tests cover: toggle group creation returns state, state name resolution, variant group name resolution, interaction wiring
- [ ] Integration test (if feasible): create toggle group + add interaction + verify state linkage in model

## Happy Path

1. LLM calls `variant.create-group({ componentUuid, name: "Menu Open", type: "toggle" })`
2. MCP creates the variant group via TplMgr (which internally creates the linked state)
3. MCP returns `{ groupUuid, groupName, type: "toggle", variants: [{uuid, name}], linkedState: { name: "menuOpen", uuid: "..." } }`
4. LLM calls `interaction.add({ componentUuid, nodeRef, eventName: "onClick", actionType: "updateVariable", args: { variable: "Menu Open", operation: "toggle" } })`
5. MCP resolves "Menu Open" to the linked state variable, builds correct ObjectPath, creates Interaction
6. At runtime, clicking the node toggles the "Menu Open" variant on/off

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| LLM passes state variable name (e.g., "menuOpen") | Works as today — direct ObjectPath resolution |
| LLM passes variant group name (e.g., "Menu Open") | Auto-resolves to linked implicit state's variable name |
| LLM passes variant group UUID | Auto-resolves to linked implicit state |
| Variant group has no linked state (single/multi type) | Error: "Variant group 'X' is not a toggle group. Use the state name directly." |
| State name conflicts with variant group name | State name takes priority (more specific match) |
| LLM creates state manually THEN creates toggle group | TplMgr creates its own implicit state; both exist. Document that manual state is separate. |

## Implementation Notes

### `createVariantGroup` changes (edit-tools.ts ~3928-4015)

After `tplMgr.createVariantGroup()`, scan `component.states` for the newly-created implicit state linked to this group. The state will have `implicitState` referencing the group or the state's `param` will match the group's `param`. Return `linkedState: { name, uuid }` in the response.

### `buildActionArgs` changes (edit-tools.ts ~5698-5721)

In the `updateVariable` case, before building the ObjectPath:
1. Try to find a matching state variable by name (current behavior)
2. If no match, try to find a variant group by name/UUID on the component
3. If variant group found and it's a standalone (toggle) type, resolve to its linked implicit state
4. Build ObjectPath with the resolved state variable name

### Response shape change

```typescript
// Current:
{ groupUuid, groupName, type, variants: [{uuid, name}] }

// New:
{ groupUuid, groupName, type, variants: [{uuid, name}], linkedState?: { name: string, uuid: string } }
```

`linkedState` is only present for `type: "toggle"`.

## Out of Scope
- Creating non-toggle variant groups with linked states (single/multi don't have implicit states in Studio)
- Modifying TplMgr itself (all changes in MCP layer)
- Fixing the `updateVariable` `toggle` operation requiring a `value` arg (that's gap #39, separate spec)
