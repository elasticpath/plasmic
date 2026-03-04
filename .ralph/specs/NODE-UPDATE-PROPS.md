# node.update-props — Component Instance Prop Updates & Dynamic Bindings

## Jobs to Be Done

- As an MCP user (AI agent or developer), I want to update prop values on an already-placed code component instance so that I can wire data-driven integrations without manual Studio intervention
- As an MCP user, I want to bind a component prop to a dynamic expression (`$ctx.params.orderId`, `$queries.cart.data.id`, `$state.formData`) so that components react to runtime data
- As an MCP user, I want to set different prop values per variant so that component behaviour adapts to responsive breakpoints or component states
- As an MCP user, I want to remove a previously-set prop value so that the component falls back to its default

## Acceptance Criteria

- [ ] New `update-props` action added to the `node` tool in `server.ts`
- [ ] Accepts `componentUuid`, `nodeRef` (must resolve to a TplComponent), `props` object, optional `variant`
- [ ] Scalar prop values (string, number, boolean) are converted to `CustomCode` literal expressions via `createAttrExpr` (reuse existing helper)
- [ ] Dynamic bindings via `$expression` or `{{expression}}` syntax are converted to `CustomCode` with the runtime expression code (reuse `createAttrExpr`)
- [ ] Slot props: when a prop value is a PlasmicElement object (or array), convert to `RenderExpr` with `plasmicElementToTpl` and set as `Arg`
- [ ] Prop deletion: setting a prop value to `undefined` or explicit JSON `null` removes the `Arg` from the target `VariantSetting`
- [ ] Variant-specific: when `variant` parameter is provided, target that variant's `VariantSetting`; otherwise target base variant
- [ ] Strict validation: prop name must exist in `tpl.component.params`; return clear error message like `Prop "xyz" does not exist on component "CompName". Available props: a, b, c`
- [ ] Node type validation: `nodeRef` must resolve to `TplComponent`; return clear error like `Node "ref" is a TplTag, not a TplComponent. Use update-attrs for HTML elements.`
- [ ] Reuses `setTplComponentArg` from `TplMgr.ts` for the core mutation (mirrors Studio behaviour)
- [ ] Existing props not mentioned in the `props` object are left unchanged (merge semantics)
- [ ] Returns summary of props set/updated/deleted in the response

## Happy Path

1. User has a project loaded via `project.set`
2. User places a code component via `node.add` with `type: "component"` and optional initial `props`
3. Later, user calls `node.update-props` with:
   ```json
   {
     "action": "update-props",
     "componentUuid": "<page-uuid>",
     "nodeRef": "CloverPayButton",
     "props": {
       "orderId": "{{$ctx.params.orderId}}",
       "amount": "{{$queries.cart.data.total}}",
       "currency": "USD",
       "testMode": true
     }
   }
   ```
4. MCP resolves nodeRef to the TplComponent instance
5. For each prop in the `props` object:
   - Finds the matching `Param` on `tpl.component.params` by `variable.name`
   - Converts the value to the appropriate expression type (`CustomCode` for scalars/expressions, `RenderExpr` for slots)
   - Calls `setTplComponentArg(tpl, vs, param.variable, expr)` to create or update the `Arg`
6. Returns success with summary: `Updated props on "CloverPayButton": orderId (dynamic), amount (dynamic), currency (literal), testMode (literal)`

## Edge Cases

| Scenario | Expected Behaviour |
|----------|-------------------|
| Prop name doesn't exist on component | Error: `Prop "xyz" does not exist on component "CompName". Available props: a, b, c` |
| nodeRef resolves to TplTag | Error: `Node "ref" is a TplTag, not a TplComponent. Use update-attrs for HTML elements.` |
| nodeRef doesn't exist | Error: `Node "ref" not found in component "CompName"` (existing `resolveNode` behaviour) |
| Empty props object `{}` | No-op, return success with "No props updated" |
| Prop value is `null` or `undefined` | Remove the Arg from the VariantSetting (prop deletion) |
| Prop value is a PlasmicElement object | Detect object with `type` key, convert to RenderExpr for slot params |
| Prop value is a PlasmicElement but param is not a slot | Error: `Prop "xyz" is not a slot param. Pass a scalar value or expression instead.` |
| Scalar value for a slot param | Error: `Prop "xyz" is a slot param. Pass a PlasmicElement object or array instead.` |
| Variant doesn't exist | Error from existing variant resolution (consistent with other actions) |
| Multiple props, one invalid | Fail-fast on the first invalid prop before making any mutations (atomic) |
| Prop already has a value | Overwrite with new value (update semantics via `setTplComponentArg`) |

## Implementation Notes

### Key Source Locations

- **Add action handler**: `packages/plasmic-mcp/src/server.ts` — add `update-props` case to node tool switch
- **Core function**: `packages/plasmic-mcp/src/edit-tools.ts` — new `updateProps()` export
- **Expression conversion**: `packages/plasmic-mcp/src/edit-tools.ts:173` — reuse `createAttrExpr()`
- **WAB mutation**: `platform/wab/src/wab/shared/TplMgr.ts:300` — `setTplComponentArg()`
- **Type guards**: `packages/plasmic-mcp/src/wab-externals.d.ts` — `isKnownTplComponent`, `isSlot`
- **Schema**: `packages/plasmic-mcp/src/server.ts` — add `props` parameter to node tool Zod schema

### Reuse Strategy (Aligns with Studio)

- `createAttrExpr()` already handles `$expr`, `{{expr}}`, literals → `CustomCode`
- `plasmicElementToTpl()` already converts PlasmicElement → TplNode tree (used by `node.add`)
- `setTplComponentArg()` is the exact same function Studio's prop panel calls
- `resolveNode()`, `requireSingleNode()`, variant resolution — all existing

### Slot Detection

To distinguish slot params from scalar params:
```typescript
import { isSlot } from "platform/wab/src/wab/shared/SlotUtils";
// or check: isRenderableType(param.type)
```

## Out of Scope

- Nothing — this is the full feature spec including scalar props, dynamic bindings, variant-specific props, prop deletion, and slot updates
