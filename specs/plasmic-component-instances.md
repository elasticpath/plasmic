# Component Instance Support in `add-child`

## Jobs to Be Done

- As a developer using Claude Code, I want to insert instances of existing reusable components (e.g., a `Card` or `Header`) into a page via `add-child` so that I can compose pages from my component library without recreating HTML from scratch.
- As a developer, I want the `{ type: "component", name: "Card" }` PlasmicElement syntax to work in `add-child` the same way it already works in `create-page` (where the server handles it), so the API is consistent.

## Architecture

### Current Problem

`PlasmicElement` in `types.ts` defines `ComponentElement` (`type: "component"`) and `DefaultComponentElement` (`type: "default-component"`), but `plasmicElementToTpl()` in `edit-tools.ts` has no case for either type. Both fall through to `default: tag = "div"`, silently creating an empty `<div>` instead of a `TplComponent` node.

This only affects `add-child` (which calls `plasmicElementToTpl` client-side). `create-page` is unaffected because it delegates to the Plasmic server's own `elementSchemaToTpl`, which handles component types natively.

### Solution

Add `"component"` and `"default-component"` cases to the `switch` statement in `plasmicElementToTpl()`. Use the WAB model's `mkTplComponentX()` to create real `TplComponent` instances.

### Implementation Details

**Component resolution:** Look up the target component in the Site model:
```typescript
const site = requireSession().site;
const comp = site.components.find(
  (c: any) => c.name === element.name || c.uuid === element.name
);
if (!comp) throw new Error(`Component "${element.name}" not found`);
```

**TplComponent creation:** Use `mkTplComponentX` from `@/wab/shared/core/tpls`:
```typescript
import { mkTplComponentX, getBaseVariant } from "@/wab/shared/core/tpls";

// The baseVariant is the base variant of the OWNING component (the one being edited)
const owningComponent = /* resolved from componentUuid */;
const baseVariant = getBaseVariant(owningComponent);

const tplComponent = mkTplComponentX({
  component: comp,
  baseVariant,
});
```

**Default component:** For `type: "default-component"`, create the instance with default slot contents pre-filled (same as `mkTplComponentWithDefaults` in VariantTplMgr).

**Slot arguments:** If the `ComponentElement` includes `children`, convert them to `Arg` objects for the component's default slot. Each child goes through `plasmicElementToTpl` recursively, then is wrapped in a slot `Arg`.

### Files to Modify

1. **`packages/plasmic-mcp/src/edit-tools.ts`** — Add `"component"` and `"default-component"` cases to `plasmicElementToTpl()`. The function signature needs access to the owning component's base variant (may need to thread it through as a parameter or resolve from session + componentUuid).

2. **`packages/plasmic-mcp/src/wab.d.ts`** — Add type declarations for `mkTplComponentX`, `getBaseVariant`, and related types if not already present.

3. **`packages/plasmic-mcp/src/types.ts`** — No changes needed (types already defined).

4. **`.claude/commands/plasmic-edit.md`** — Document component instance insertion in the `add-child` section.

5. **`.claude/commands/plasmic-patterns.md`** — Add a "Component Reference" pattern showing how to use `{ type: "component", name: "..." }` in PlasmicElement trees.

### Files to Create

None — all changes are additions to existing files.

## Acceptance Criteria

### Must Have

- [x] `plasmicElementToTpl()` handles `type: "component"` — resolves by name or UUID, creates `TplComponent`
- [x] `plasmicElementToTpl()` handles `type: "default-component"` — creates `TplComponent` with default slot contents
- [x] Throws descriptive error if component name/UUID not found in Site model
- [x] Recursive children of `ComponentElement` are converted and placed in the default slot
- [x] Unit tests in `edit-tools.test.ts`: add-child with `{ type: "component", name: "ExistingComp" }` creates a TplComponent (not a div)
- [x] Unit test: add-child with unknown component name throws descriptive error
- [x] Unit test: add-child with `{ type: "default-component" }` creates TplComponent with default slot contents
- [x] Integration test (in real-integration.test.ts once P0.1 exists): add-child with component type → get-node-details → verify component instance
- [x] Skill file `plasmic-edit.md` documents component insertion syntax
- [x] All existing tests continue to pass

### Nice to Have

- [x] Support `props` field on `ComponentElement` for setting component prop overrides
- [ ] Support nested component references (component inside component's children slot)

## Happy Path

1. User has a `Card` component in their Plasmic project
2. User asks Claude: "Add a Card component to the hero section"
3. `/plasmic-edit` skill calls `list-components` to find "Card" component
4. Skill calls `add-child` with `{ type: "component", name: "Card" }` targeting the hero section
5. `plasmicElementToTpl()` resolves "Card" from `site.components`, calls `mkTplComponentX()`
6. Real `TplComponent` node is inserted into the parent's children
7. `get-node-details` on the new node shows it as a component instance with the correct component name

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Component name not found | Throw `Error: Component "Foo" not found. Available: Card, Header, Footer` |
| Component UUID used instead of name | Resolve by UUID from `site.components` |
| Component has required props | Create instance without props (same as Studio drag-drop) — props can be set later |
| Component from a dependency project | Search `site.projectDependencies` components as well |
| Circular reference (component referencing itself) | WAB model prevents this at the Site level — no special handling needed |

## Out of Scope

- Creating new component definitions (use `create-component` tool for that)
- Setting component prop values beyond slot children (future: `props` field support)
- Component variant overrides (future: variant editing spec)
