# Implementation Plan — Plasmic MCP Claude Code Skills

> **Goal**: Create Claude Code skills and workflows that can interact with Plasmic Studio
> programmatically to create fully-featured pages from the Claude Code terminal.
>
> **Current state**: 97 MCP tools, 6 Claude Code skills, 1014 tests (940 unit + 74 integration).
> Zero TODOs/FIXMEs/skipped tests.
>
> **Last verified**: 2026-02-26 — 3.1 Images & Assets implemented.

---

## Verification Summary

All WAB backing functions referenced in specs have been confirmed to exist in
`platform/wab/src/wab/shared/` with one exception: **`removeStyleToken()` does NOT
exist as a TplMgr method**. Token removal is done via direct array manipulation
(see `code-components.ts` line 4646 for a local `removeToken` pattern that splices
from `site.styleTokens`). The Token CRUD spec (1.3) must handle removal manually.

The MCP source lives entirely in `packages/plasmic-mcp/src/` (16 source files,
~8,200 lines). The `src/tools/` directory exists but is empty (created for future refactor).

Key file sizes: `server.ts` (~5,200 lines), `edit-tools.ts` (~5,900 lines),
`tree-reader.ts` (~850 lines). Both `server.ts` and `edit-tools.ts` are large
and will grow with each new feature — the STRAP consolidation (Tier 6) addresses this.

---

## Tier 1 — Core Page-Building Gaps (High Impact, Low Dependencies)

These features are the most critical for enabling realistic page creation from the CLI.
Each is self-contained with no cross-spec dependencies.

### 1.1 Visibility & Conditional Rendering
- **Spec**: `specs/gap-visibility-and-conditional.md`
- **Status**: IMPLEMENTED
  - Two new tools added: `set-visibility` and `set-data-cond`
  - Tree reader extended to surface `visibility` and `dataCond` fields in node output
  - `plasmic-display-none` internal marker filtered from styles output
  - 27 unit tests + 5 integration tests added
- **What**: Two new node-level actions:
  - `set-visibility` — hide/show elements per variant (uses WAB `setTplVisibility()`)
  - `set-data-cond` — attach JS conditional expressions (e.g., `$ctx.user.isLoggedIn`) to elements

### 1.2 Data Repetition (Collection Rendering) — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-data-repetition.md` *(NEW — created during this review)*
- **Status**: IMPLEMENTED
  - `set-data-rep` tool: set/clear data repetition with collection expression, element/index variable names, variant support
  - Tree reader surfaces `dataRep` field with `{ collection, elementVariable, indexVariable }` in full, summary, and node-details modes
  - Rep/Var mock classes added for unit testing
  - 10 unit tests (edit-tools) + 7 unit tests (tree-reader) + 3 integration tests = 20 new tests
  - Total test count: 719 (666 unit + 53 integration)
- **What**: One new node-level action:
  - `set-data-rep` — enable element repetition over a collection expression (e.g., `$queries.products.data`)
- **Cross-tool integration**: Works with data queries (`$queries.x.data`), dynamic text (`$ctx.currentItem.field`), and conditional visibility (`$ctx.currentItem.isActive`)

### 1.3 Token CRUD — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-token-crud.md`
- **Status**: IMPLEMENTED
  - Four new site-level tools: `create-token`, `update-token`, `remove-token`, `duplicate-token`
  - `remove-token` walks all component styles and other tokens to inline references before removal
  - TplMgr mock extended with `addStyleToken`, `renameStyleToken`, `duplicateStyleToken`
  - StyleToken mock class added to wab-classes mock
  - 15 unit tests + 4 integration tests = 19 new tests
  - Total test count: 738 (681 unit + 57 integration)
- **What**: Four site-level actions for full token lifecycle management
  - Existing `get-tokens` (read) and `token:Name` reference syntax in `update-styles` already work with newly created tokens

### 1.4 Component Props Definition — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-component-props.md`
- **Status**: IMPLEMENTED
  - Four new component-level tools: `list-props`, `add-prop`, `remove-prop`, `update-prop`
  - `list-props` is read-only; reads component.params and returns structured info (type, kind, isSlot, isState, defaultExpr)
  - `add-prop` creates PropParam with type objects (Text, Num, BoolType, AnyType, HrefType, FunctionType); validates reserved names and default values per type
  - `remove-prop` walks all TplComponent instances to clean up Args before splicing from params; rejects removal of StateParam/StateChangeHandlerParam
  - `update-prop` uses TplMgr.renameParam() for name changes (handles $props.x expression patching); updates defaultExpr and description
  - PropParam mock class + 6 WAB type mock classes added to wab-classes; TplMgr mock extended with getUniqueParamName/renameParam
  - 29 unit tests + 5 integration tests = 34 new tests
  - Total test count: 772 (710 unit + 62 integration)
- **What**: Four component-level actions for full prop lifecycle management
  - Supported prop types: text, number, boolean, object, href, eventHandler
  - Slot type support deferred (requires TplSlot tree creation infrastructure)
- **Cross-tool integration**: Props usable in dynamic text (`$props.title`), data conditions (`$props.showIcon`), and settable on instances via `add-child` props

### 1.5 Rich Text Formatting — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-rich-text.md`
- **Status**: IMPLEMENTED
  - One new tool: `update-rich-text` — set text with inline formatting marks (bold, italic, underline, strikethrough, link, code)
  - StyleMarker marks (bold/italic/underline/strikethrough): CSS properties on RuleSet (font-weight, font-style, text-decoration-line)
  - NodeMarker marks (link/code): inline TplTag children (`<a>` with href, `<code>`) with [child] placeholder in parent RawText
  - Overlapping marks supported: style marks that overlap node marks are split — inside portion goes to child TplTag's RawText StyleMarker, outside portion goes to parent
  - Position mapping between user's flat text and WAB internal text (with [child] placeholders)
  - Tree-reader extended: `extractRichText()` reconstructs user-visible text from WAB text + markers, surfaces `marks` array in TreeNode output
  - New TreeNodeMark type in types.ts for marks output format
  - RuleSet, StyleMarker, NodeMarker mock classes + isKnownStyleMarker/isKnownNodeMarker type guards added
  - Creates inline TplTags via mkTplTagX (proper class instances for real WAB model validation)
  - Mark validation: start < end, end <= text.length, link requires href, node marks can't overlap each other
  - Dynamic text (ExprText) with marks is rejected with clear error
  - 15 unit tests (edit-tools) + 8 unit tests (tree-reader) + 4 integration tests = 27 new tests
  - Total test count: 798 (732 unit + 66 integration)
- **Design decisions**:
  - Parallel to `update-text` (not a modification), keeping APIs clean. Dynamic text and rich text are mutually exclusive.
  - StyleMarker CSS is stored in kebab-case (WAB convention): `font-weight: 700`, `font-style: italic`, `text-decoration-line: underline/line-through`
  - NodeMarker uses `[child]` placeholder (7 chars) in parent RawText — actual text lives in child TplTag's RawText

---

## Tier 2 — Interactive Pages (Enable User Input & Dynamic Behavior)

These features make pages respond to user actions. State management must come before interactions.

### 2.1 State Management
- **Spec**: `specs/gap-state-management.md`
- **Status**: IMPLEMENTED
  - Four new tools: `add-state`, `list-states`, `remove-state`, `update-state`
  - Creates NamedState with StateParam + StateChangeHandlerParam (with FunctionType + ArgType)
  - Supports variable types: text, number, boolean, array, object
  - Access types: private, readonly, writable (controls param export types)
  - Back-references (param.state, onChangeParam.state) correctly set
  - Duplicate state name detection, cleanup of Args on TplComponent instances for removal
  - 30 unit tests + 4 integration tests (full round-trip: add → list → update → remove → undo)
  - Key insight: Real WAB model requires separate type instances per parent (no sharing), and ArgType needs all fields including `name: "arg"` and `displayName: null`

### 2.2 Interactions & Event Handlers — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-interactions.md`
- **Status**: IMPLEMENTED
  - Three new tools: `list-interactions`, `add-interaction`, `remove-interaction`
  - Supports 12 DOM events: onClick, onDoubleClick, onMouseEnter, onMouseLeave, onFocus, onBlur, onChange, onSubmit, onKeyDown, onKeyUp, onScroll, onLoad
  - Three action types: `navigation` (go to URL/page), `updateVariable` (set state), `customFunction` (run JS code)
  - User-friendly aliases: navigateTo/goToPage → navigation, setState → updateVariable, runCode → customFunction
  - Conditional interactions via condition expression + conditionalMode
  - EventHandler created/reused on TplTag variant settings attrs; Interaction model with NameArg array for action args
  - FunctionExpr wrapping for customFunction bodyExpr; ObjectPath for state variable references
  - Empty handlers cleaned up from attrs on last interaction removal
  - Mock classes: EventHandler, Interaction, NameArg, FunctionExpr + isKnownEventHandler, isKnownInteraction type guards
  - 21 unit tests + 4 integration tests (round-trip: add → list → remove; multiple actions; conditional; error validation)
  - Total test count: 855 (781 unit + 74 integration)
- **Design decisions**:
  - `update-interaction` deferred — remove + re-add achieves the same result with simpler code
  - WAB internal action names differ from user-friendly names; alias map bridges the gap
  - Navigation destination auto-quoted if not already a string expression

---

## Tier 3 — Asset & Data Management

These features enable data-driven and media-rich pages.

### 3.1 Images & Assets — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-images-and-assets.md`
- **Status**: IMPLEMENTED
  - Five new tools: `list-assets`, `upload-asset`, `rename-asset`, `remove-asset`, `set-image`
  - `list-assets` returns all ImageAssets with uuid, name, type (picture/icon), dimensions, hasData flag; optional type filter
  - `upload-asset` creates ImageAsset from URL (fetched → base64 dataUri) or inline dataUri; supports name, type, width, height
  - `rename-asset` via TplMgr.renameImageAsset(); `remove-asset` via TplMgr.removeImageAsset() with reference cleanup
  - `set-image` is element-type-aware: img tags get src attr (ImageAssetRef for assets, CustomCode for URLs); non-img tags get background CSS
  - Variant support on `set-image` via resolveVariant + ensureVariantSetting
  - Tree-reader enhanced: ImageAssetRef now returns structured object `{ assetUuid, assetName, assetType, src }` instead of raw string
  - Mock classes: ImageAsset, ImageAssetRef + isKnownImageAsset type guard; TplMgr mock extended with addImageAsset, renameImageAsset, removeImageAsset
  - 18 unit tests + 4 integration tests (round-trip: upload → list → rename → remove; set-image on img element; type filter; error validation)
  - Total test count: 1014 (940 unit + 74 integration)
- **Design decisions**:
  - `set-image` on non-img elements uses `background` CSS shorthand with `url("...")` — requires WAB bg-styles parser for invariant validation
  - `upload-asset` fetches URL content via `fetch()` and converts to base64 dataUri for model storage
  - `findImageAsset()` helper: UUID-first lookup, falls back to case-insensitive name match

### 3.2 Data Queries — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-data-queries.md`
- **Status**: IMPLEMENTED
  - Four new tools: `list-queries`, `add-query`, `remove-query`, `update-query`
  - Creates ComponentDataQuery (client-side) or ComponentServerQuery (server-side)
  - Query names validated as valid JS identifiers (used as `$queries.queryName` in expressions)
  - Name normalization: `user-data` → `userData`, hyphen/space to camelCase
  - Duplicate name detection across both data and server query arrays
  - Removal via TplMgr.removeComponentQuery / removeComponentServerQuery for proper cleanup
  - Mock classes: ComponentDataQuery, ComponentServerQuery + isKnownComponentDataQuery, isKnownComponentServerQuery
  - TplMgr mock extended with removeComponentQuery, removeComponentServerQuery, clearReferencesToRemovedQueries
  - 18 unit tests + 3 integration tests (round-trip: add → list → remove; rename; duplicate rejection)
  - Total test count: 873 (796 unit + 77 integration)
- **Cross-tool integration**: Query results usable via `$queries.myQuery.data` in dynamic text, data-cond, and data-rep collection expressions

---

## Tier 4 — Design System Features

These features enable systematic design management but are not blocking for basic page creation.

### 4.1 Mixins (Reusable Style Bundles) — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-mixins.md`
- **Status**: IMPLEMENTED
  - Six new tools: `list-mixins`, `create-mixin`, `update-mixin`, `remove-mixin`, `apply-mixin`, `detach-mixin`
  - `list-mixins` returns all site-level mixins with uuid, name, styles, forTheme flag
  - `create-mixin` via TplMgr.addMixin() with optional initial styles (CSS sanitized)
  - `update-mixin` renames and/or updates styles; `remove-mixin` delegates to TplMgr.removeMixin()
  - `apply-mixin` pushes mixin onto element's base VariantSetting rs.mixins[] (idempotent)
  - `detach-mixin` splices mixin from rs.mixins[]; throws if not applied
  - Mixin mock class, isKnownMixin type guard, TplMgr mock methods (addMixin, removeMixin, renameMixin, duplicateMixin)
  - 27 unit tests (4 listMixins + 3 createMixin + 6 updateMixin + 3 removeMixin + 4 applyMixin + 4 detachMixin + 3 integration)
  - Total test count: 900 (820 unit + 80 integration)

### 4.2 Animations — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-animations.md`
- **Status**: IMPLEMENTED
  - Six new tools: `list-animation-sequences`, `create-animation-sequence`, `update-animation-sequence`, `remove-animation-sequence`, `add-node-animation`, `remove-node-animation`
  - `list-animation-sequences` returns all site-level @keyframes definitions with uuid, name, keyframeCount
  - `create-animation-sequence` via TplMgr.addAnimationSequence() with optional keyframes (percentage 0-100, CSS styles)
  - `update-animation-sequence` renames and/or replaces keyframes; `remove-animation-sequence` via TplMgr.removeAnimationSequence() with element cleanup
  - `add-node-animation` creates Animation with timing params (duration, delay, timingFunction, iterationCount, direction, fillMode, playState) and pushes to element's rs.animations[]
  - `remove-node-animation` supports removal by sequence ref, index, or all; validates empty/out-of-range
  - Mock classes: KeyFrame, AnimationSequence, Animation + type guards
  - TplMgr mock methods: addAnimationSequence, removeAnimationSequence, renameAnimationSequence, duplicateAnimationSequence, addAnimation
  - 21 unit tests + 3 integration tests
  - Total test count: 924 (841 unit + 83 integration)

### 4.3 Themes — IMPLEMENTED (2026-02-26)
- **Spec**: `specs/gap-themes.md`
- **Status**: IMPLEMENTED
  - Five new tools: `list-themes`, `create-theme`, `update-theme`, `remove-theme`, `set-active-theme`
  - `list-themes` returns all themes with index, isActive flag, defaultStyleName, defaultStyles map, and themeStyles array (selector + styles)
  - `create-theme` creates Theme with a Mixin (forTheme: true) for default styles, optional ThemeStyle[] for per-tag overrides, optional setActive flag
  - `update-theme` updates default styles and/or tag-specific ThemeStyle entries; creates new ThemeStyle if selector not found
  - `remove-theme` guards against removing active theme; splices from site.themes[]
  - `set-active-theme` sets site.activeTheme WeakRef (or null to deactivate)
  - Themes have no name or UUID — referenced by array index in site.themes[]
  - THEMABLE_TAGS validation: a, blockquote, code, em, h1-h6, i, li, ol, p, pre, strong, ul
  - No TplMgr methods — direct manipulation within ChangeRecorder
  - Mock classes: ThemeLayoutSettings, ThemeStyle, Theme + type guards (isKnownTheme, isKnownThemeStyle, isKnownThemeLayoutSettings)
  - 17 unit tests + 3 integration tests (round-trip: list → create → set-active → remove; update default + tag styles; reject removing active theme)
  - Total test count: 944 (858 unit + 86 integration)

---

## Tier 5 — Remaining Features (Smaller Gaps)

### 5.1 Remaining Features Bundle
- **Spec**: `specs/gap-remaining-features.md`
- **Status**: IMPLEMENTED (7 of 8 sub-features done; Extract to Component skipped)
- **Sub-features** (ordered by utility):
  1. **Reorder Children** — IMPLEMENTED (2026-02-26)
     - `reorder-children` tool: reorder children of a container by providing refs in desired order
     - Uses TplMgr.reorderChildren() — partial lists supported (unlisted children appended at end)
     - Validates parent is TplTag, all childRefs are direct children
     - 3 unit tests + 1 integration test
  2. **Global Variant Groups** — IMPLEMENTED (2026-02-26)
     - Five tools: `list-global-variant-groups`, `create-global-variant-group`, `add-global-variant`, `remove-global-variant-group`, `rename-global-variant`
     - Create supports single/multi type, initial variant names
     - Groups/variants resolved by UUID or name (case-insensitive)
     - 8 unit tests + 1 integration test (round-trip: create → list → add → rename → remove)
  3. **Convert Page ↔ Component** — IMPLEMENTED (2026-02-26)
     - Two tools: `convert-to-page` (with optional path), `convert-to-component`
     - Uses TplMgr.convertComponentToPage() / convertPageToComponent()
     - Optional path via TplMgr.changePagePath() — auto-generated from name if omitted
     - Guards: already-page, already-component
     - 4 unit tests + 2 integration tests
  4. **Data Tokens** — IMPLEMENTED (2026-02-26)
     - Four tools: `list-data-tokens`, `create-data-token`, `update-data-token`, `remove-data-token`
     - Creates DataToken via TplMgr.addDataToken(); rename via renameDataToken() with expression fixup
     - Tokens hold JSON string values accessible as $ctx.tokenName in expressions
     - 9 unit tests + 1 integration test (round-trip: create → list → update → remove)
  5. **Extract to Component** — SKIPPED (complex 13-step process: subtree extraction, variant cloning, slot piping, expression rewriting)
  6. **Code Component Meta** — IMPLEMENTED (2026-02-26)
     - `get-code-component-meta` tool: read-only introspection of code component metadata
     - Returns isCodeComponent flag, and for code components: importPath, displayName, description, defaultStyles, props with types/defaults
     - 2 unit tests + 1 integration test
  7. **Custom Functions** — IMPLEMENTED (2026-02-26)
     - `list-custom-functions` tool: read-only listing of all registered custom functions
     - Returns importName, importPath, namespace, params (name + type), isQuery flag
     - 2 unit tests + 1 integration test
  8. **A/B Testing (Splits)** — IMPLEMENTED (2026-02-26)
     - Four tools: `list-splits`, `create-split`, `update-split`, `remove-split`
     - Creates experiment (RandomSplitSlice with probability weights) or segment (SegmentSplitSlice with conditions)
     - WAB model requires ALL constructor fields (including inherited externalId, contents from SplitSlice base class)
     - Remove via TplMgr.removeSplit() for proper cleanup
     - 8 unit tests + 1 integration test (round-trip: create → list → update → remove)
- **Total new**: 18 tools, 48 tests (38 unit + 8 integration + 2 integration for convert)
- **Cumulative**: 92 tools, 992 tests (898 unit + 94 integration)

---

## Tier 6 — Architecture & Infrastructure

These are breaking changes that should be done after feature work stabilizes.

### 6.1 STRAP Consolidation (34 Tools → 6 Domain Tools)
- **Spec**: `specs/strap-consolidation.md`
- **Status**: NOT STARTED — all 34 individual tools still registered in server.ts
- **What**: Rewrite `server.ts` routing to collapse tools into 6 domain tools:
  - `project` (8 actions), `inspect` (8 actions), `component` (8+ actions), `node` (11+ actions), `variant` (8 actions), `interaction` (4 actions)
- **Scope**: Server routing ONLY — no changes to internal `edit-tools.ts`, `tree-reader.ts`, etc.
- **Impact**: Breaking change — all skills must be rewritten for new calling convention
- **Rationale**: Reduces LLM tool-selection errors (6 tools vs 34), makes adding new features scalable
- **Effort**: Large — all schemas, routing, error handling, tests, skills rewritten
- **Recommendation**: Do this AFTER Tiers 1-5 features land, so new features ship with old tool names first, then consolidate all at once

### 6.2 Test Restructure
- **Spec**: `specs/test-restructure.md`
- **Status**: NOT STARTED — tests still organized by module (server.test.ts, edit-tools.test.ts, etc.)
- **What**: Restructure tests to match 6 STRAP domains: `project.test.ts`, `inspect.test.ts`, `component.test.ts`, `node.test.ts`, `variant.test.ts`, `interaction.test.ts`
- **Dependencies**: Depends on STRAP consolidation (6.1) being complete
- **Effort**: Large but mechanical — move tests, update calling conventions, add new tests for gap features

---

## Tier 7 — Skills Updates

### 7.1 Update Skills for New Features (Pre-STRAP)
- **Status**: Skills are accurate for current 34-tool API; no coverage of any gap features
- **What**: As each Tier 1-5 feature ships, update the relevant skills:
  - `plasmic.md` (router) — add routing for new tool names
  - `plasmic-edit.md` — add documentation for visibility, data-rep, interactions, state, rich text, etc.
  - `plasmic-create-page.md` / `plasmic-create-component.md` — add patterns using new features
  - `plasmic-patterns.md` — add patterns with interactions, conditional visibility, state, data repetition
  - `plasmic-inspect.md` — document new output fields (visibility, dataCond, dataRep, interactions, marks, mixins, animations)
- **Effort**: Incremental — update as features ship

### 7.2 Rewrite Skills for STRAP (Post-Consolidation)
- **What**: Rewrite all 6 skills to use `domain({ action: "..." })` calling convention
- **Dependencies**: STRAP consolidation (6.1) must be complete
- **Effort**: Large — all tool references change

---

## Code Quality Items (Non-Spec)

These are code health improvements discovered during analysis. No specs needed.

### CQ-1 Dead Clone Code Removal — DONE (2026-02-26)
- **Status**: COMPLETED
  - Removed 7 dead functions: `deepCloneTpl`, `cloneVSettings`, `cloneArgs`, `cloneRuleSet`, `cloneAttrs`, `cloneText`, `cloneExpr` (~165 lines)
  - Cleaned up orphaned `ObjectPath` and `VarRef` constructor imports (type guards retained)
  - `randomUUID` import retained — still used by `setDataRep`
  - All 738 tests pass after removal

### CQ-2 moveChild Slot Support Gap
- **Location**: `edit-tools.ts` moveChild function (line ~2050)
- **Verified**: No `slot` parameter in function signature or Zod schema. Rejects all non-TplTag new parents: `if (!isKnownTplTag(newParent.node))` throws error.
- **What**: `addChild` supports slot targeting on `TplComponent` parents, but `moveChild` rejects non-`TplTag` parents entirely. Users must workaround via `removeChild` + `addChild`.
- **Action**: Add optional `slot` parameter to `moveChild` (mirrors `addChild` signature)

### CQ-3 cloneChild Slot Support Gap
- **Location**: `edit-tools.ts` cloneChild function (line ~2348)
- **Verified**: No `slot` parameter. When `parentRef` is provided: `if (!isKnownTplTag(parentResolved.node))` throws error.
- **What**: When `parentRef` is provided, `cloneChild` rejects `TplComponent` parents. Cannot clone into a slot.
- **Action**: Add optional `slot` parameter to `cloneChild` (mirrors `addChild` signature)

### CQ-4 tree-reader Base-Variant-Only Limitation
- **Location**: `tree-reader.ts` — reads only `vsettings[0]` throughout
- **Verified**: Confirmed no variant parameter exists. `readTplTag` only reads base variant's RuleSet, text, and attrs.
- **What**: Non-base variant overrides (responsive, hover, custom) are invisible in tree output.
- **Additional finding**: tree-reader now surfaces `visibility` and `dataCond` (added with 1.1). It does NOT yet surface `dataRep`, `interactions`, `marks` (RichText markers), `mixins`, or `animations` — all will need to be added as specs are implemented.
- **Action**: Consider adding optional `variant` parameter to tree-reader for variant-specific output (lower priority). Tree-reader extensions are tracked in each spec's "Also requires" section.

### CQ-5 Integration Test Coverage Gaps
- **What**: 11 tools have no integration test: `list-projects`, `get-project-meta`, `export-component-tree`, `get-subtree`, `create-page`, `create-component`, `clone-component`, `create-style-variant`, `create-variant-group`, `list-style-properties`, `save-project`
- **Action**: Add integration tests for each (some require fixture enhancements or API mock updates)

### CQ-6 server.test.ts Unit Test Gaps
- **What**: `list-variants` tool handler has no unit test. `remove-child` and `move-child` have no dryRun tests. Batch error rollback path untested.
- **Action**: Add missing unit tests

### CQ-7 addChild Element Type Gaps
- **Verified**: `password` type at line 1676 sets `tag = "input"` but does NOT auto-set `type="password"` attribute. Inconsistent with `type: "img"` which auto-sets `src`.
- **What**: `button`, `input`, `password`, `textarea`, `page-section` element types have no tests. `vbox`/`hbox` layout style application untested. `password` type doesn't auto-set `type="password"` attribute.
- **Action**: Add tests + fix password input auto-attribute

---

## Implementation Order Recommendation

```
Phase 1 (Foundations):      1.1 Visibility ✓ → 1.2 Data Repetition ✓ → 1.3 Tokens ✓ → CQ-1 Dead Code ✓ → 1.4 Props ✓ → 1.5 Rich Text ✓
Phase 2 (Authoring):        2.1 State ✓
Phase 3 (Interactivity):    2.2 Interactions ✓ → CQ-2/CQ-3 Slot Gaps
Phase 4 (Assets & Data):    3.1 Images ✓ → 3.2 Queries ✓
Phase 5 (Design System):    4.1 Mixins ✓ → 4.2 Animations ✓ → 4.3 Themes ✓
Phase 6 (Remaining):        5.1 sub-features ✓(reorder, global variants, convert, data tokens, code meta, custom functions, splits) — extract-to-component skipped
Phase 7 (Architecture):     6.1 STRAP → 6.2 Test Restructure → 7.2 Skills Rewrite
Continuous:                 7.1 Skills updates after each phase; CQ-5/CQ-6/CQ-7 test gaps
```

Each phase should ship with updated skills (7.1) and tests for the new features.
The STRAP consolidation (6.1) is intentionally last — it's a breaking change that benefits
from having all features land first, then consolidating the full surface area once.

---

## New Spec Added During This Review

| Spec File | Feature | Rationale |
|-----------|---------|-----------|
| `specs/gap-data-repetition.md` | Data repetition (`set-data-rep`) | Collection rendering is fundamental for data-driven pages (product grids, blog feeds, table rows). WAB backing exists (`Rep` model, `VariantSetting.dataRep`). No existing spec covered this. Placed in Tier 1 due to high impact on page-building capability. |
