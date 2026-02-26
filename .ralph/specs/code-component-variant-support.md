# Code Component Variant Support

## Jobs to Be Done
- As an MCP user, I want `variant.list` to show code component variants (e.g., "Selected", "Hovered", "Pressed") so that I can see all available variant types on a component, matching what Plasmic Studio shows as "Registered Variants"
- As an MCP user, I want to resolve code component variants by key, display name, or UUID so that I can target them with `node.update-styles` to apply variant-specific styles
- As an MCP user, I want `variant.create-style` to accept code component variant CSS selectors (e.g., `[data-selected]`) when the target component has those variants registered, so that I can create new style variants scoped to code component states

## Background

Plasmic has two variant systems:
- **Style variants**: Created by users in Studio, use CSS pseudo-classes (`:hover`, `:focus`). Already supported by MCP.
- **Code component variants**: Created by component registration via `ComponentMeta.variants`, use attribute selectors (`[data-selected]`). NOT supported by MCP.

Code component variants are stored as `Variant` objects with `codeComponentName` (string) and `codeComponentVariantKeys` (string[]). Their display names and CSS selectors come from `CodeComponentVariantMeta` on the code component's `codeComponentMeta.variants` map, resolved via `siteCCVariantsToInfos()` and `getStyleOrCodeComponentVariantDisplayNames()`.

Studio shows code component variants only when the code component is the root of a Plasmic component (checked via `isTplRootWithCodeComponentVariants()`).

## Acceptance Criteria

### Gap 1: `variant.list` includes code component variants
- [x] `listVariants()` returns code component variants in a `codeComponentVariants` array field on `ListVariantsResult`
- [x] Each entry includes: `uuid`, `key` (from `codeComponentVariantKeys`), `displayName` (from `CodeComponentVariantMeta.displayName`), `cssSelector` (from `CodeComponentVariantMeta.cssSelector`), `codeComponentName`
- [x] Invalid code component variants (keys not in component meta) are included with an `invalid: true` flag, matching Studio's behavior
- [x] Only components whose root TplNode is a code component with variants produce code component variants (matching Studio's `isTplRootWithCodeComponentVariants()` check)

### Gap 2: `resolveVariant()` finds code component variants
- [x] Resolution by UUID works (already does, verify with test)
- [x] Resolution by variant key (e.g., `"selected"`) matches `codeComponentVariantKeys` entries (case-insensitive)
- [x] Resolution by display name (e.g., `"Selected"`) matches `CodeComponentVariantMeta.displayName` (case-insensitive)
- [x] When a code component variant is resolved, it can be used with `node.update-styles` to apply variant-specific styles

### Gap 3: `variant.create-style` accepts code component selectors
- [x] When the target component's root is a code component with variants, `createStyleVariant()` accepts CSS selectors from the component's registered `CodeComponentVariantMeta.cssSelector` values (e.g., `[data-selected]`)
- [x] Non-registered attribute selectors are still rejected (only selectors present in the component's variant meta are allowed)
- [x] The existing `VALID_STYLE_SELECTORS` whitelist for pseudo-classes remains unchanged for non-code-component targets

### Type declarations
- [x] `wab.d.ts` declares `codeComponentName` and `codeComponentVariantKeys` on the Variant type if not already present
- [x] `wab.d.ts` declares `CodeComponentVariantMeta` with `cssSelector` and `displayName` fields
- [x] `wab.d.ts` declares the `variants` field on `CodeComponentMeta`

### Tests
- [x] Unit tests for `listVariants()` with code component variants present
- [x] Unit tests for `resolveVariant()` with key, displayName, and UUID resolution
- [x] Unit tests for `createStyleVariant()` accepting registered code component selectors
- [x] Unit tests for invalid code component variants (stale keys)
- [x] Integration tests verifying end-to-end variant listing and resolution with real WAB classes

### Skill documentation
- [x] `/plasmic-edit` skill doc updated to mention code component variants as targetable
- [x] `/plasmic-inspect` skill doc updated to mention code component variants in variant listing

## Happy Path
1. User calls `variant.list` on a component whose root is a code component with registered variants
2. Response includes `codeComponentVariants: [{ uuid: "...", key: "selected", displayName: "Selected", cssSelector: "[data-selected]", codeComponentName: "EPBundleOptionTrigger" }]`
3. User calls `node.update-styles` with `variant: "selected"` (or `variant: "Selected"`)
4. `resolveVariant()` matches the code component variant by key/displayName
5. Styles are applied to the variant setting (the correct `VariantSetting` is targeted)
6. User calls `variant.create-style` with `selector: "[data-selected]"` on a component with that registered variant
7. A new style variant is created with the attribute selector

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Component root is NOT a code component | No code component variants returned; `codeComponentVariants` is empty array |
| Code component variant key no longer in meta | Variant listed with `invalid: true` flag |
| Multiple variant keys on one variant | All keys included in the entry; display name joined (matching `makeStyleOrCodeComponentVariantName`) |
| `resolveVariant` matches both a code component variant and a regular variant by name | Code component variant takes precedence (matches Studio behavior where registered variants are prominent) |
| `create-style` with `[data-foo]` but component doesn't register `foo` | Rejected with error listing valid selectors from the component's meta |
| `create-style` with `[data-selected]` on a non-code-component | Rejected by existing `VALID_STYLE_SELECTORS` whitelist (no change) |
| Variant key contains special characters | Match exactly as stored in `codeComponentVariantKeys` |

## Out of Scope
- Creating new code component variants (these come from component registration code, not MCP)
- Modifying code component variant metadata (displayName, cssSelector)
- Tree reader changes to show code component variant info in `inspect.tree`/`inspect.node` output
- Supporting code component variants on non-root TplNodes (matches Studio limitation)

## Platform Reference Files
| File | Purpose |
|------|---------|
| `platform/wab/src/wab/shared/code-components/variants.ts` | `isCodeComponentVariant()`, `isTplRootWithCodeComponentVariants()`, `getCodeComponentVariantMeta()` |
| `platform/wab/src/wab/shared/cached-selectors.ts` | `siteCCVariantsToInfos()`, `componentCCVariantsToInfos()` |
| `platform/wab/src/wab/shared/Variants.ts` | `getStyleOrCodeComponentVariantDisplayNames()`, `makeStyleOrCodeComponentVariantName()`, `isCodeComponentVariant()` |
| `platform/wab/src/wab/shared/model/classes.ts` | `Variant.codeComponentName`, `Variant.codeComponentVariantKeys`, `CodeComponentVariantMeta` |
