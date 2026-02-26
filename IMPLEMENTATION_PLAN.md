# Implementation Plan — Plasmic MCP Claude Code Skills

> **Goal**: Create Claude Code skills and workflows that can interact with Plasmic Studio
> programmatically to create fully-featured pages from the Claude Code terminal.
>
> **Current state**: 46 MCP tools, 6 Claude Code skills, 798 tests (732 unit + 66 integration).
> Zero TODOs/FIXMEs/skipped tests.
>
> **Last verified**: 2026-02-26 — 1.5 Rich Text Formatting implemented.

---

## Verification Summary

All WAB backing functions referenced in specs have been confirmed to exist in
`platform/wab/src/wab/shared/` with one exception: **`removeStyleToken()` does NOT
exist as a TplMgr method**. Token removal is done via direct array manipulation
(see `code-components.ts` line 4646 for a local `removeToken` pattern that splices
from `site.styleTokens`). The Token CRUD spec (1.3) must handle removal manually.

The MCP source lives entirely in `packages/plasmic-mcp/src/` (16 source files,
~8,200 lines). The `src/tools/` directory exists but is empty (created for future refactor).

Key file sizes: `server.ts` (~3,680 lines), `edit-tools.ts` (~4,000 lines),
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
- **Status**: NOT IMPLEMENTED
  - Verified: zero references to `addComponentState`, `add-state`, `list-states` in MCP src/
  - WAB backing confirmed: `addComponentState()` (line 626), `removeComponentState()` (line 643), `updateStateAccessType()` (line 539) in `shared/core/states.ts`
- **What**: Four new component-level actions:
  - `add-state` — create state variable (text/number/boolean/array/object/variant/dateString/dateRangeStrings)
  - `list-states` — list all state variables on a component
  - `remove-state` — delete state + clean up expression references
  - `update-state` — change `accessType` (private → writable) or `initialValue`
- **Cross-tool integration**: States usable in interactions (`$state.isOpen`), conditional visibility (`set-data-cond`), and dynamic text (`update-text` with `dynamic: true`)
- **Effort**: Medium — CRUD + expression cleanup on removal
- **Tests needed**: Unit + integration (create state → use in dynamic text → verify)

### 2.2 Interactions & Event Handlers
- **Spec**: `specs/gap-interactions.md`
- **Status**: NOT IMPLEMENTED
  - Verified: zero references to `EventHandler` wiring or interaction registration in MCP src/
  - WAB backing confirmed: `EventHandler` (line 6289), `Interaction` (line 4437), `NameArg` (line 3967) in `classes.ts`
- **What**: Four new actions in a new `interaction` domain:
  - `add` — attach event handler (onClick, onMouseEnter, onChange, etc.) with action types: navigateTo, setState, runCode, scrollTo, openUrl, closeOverlay, etc.
  - `list` — return all interactions on an element
  - `update` — modify an existing interaction by index
  - `remove` — remove by index or event name
- **Dependencies**: `setState` action requires state management (2.1) to exist
- **Also requires**: Extend `get-node-details` to surface `interactions` array
- **Effort**: Large — complex action type dispatch, validation, arg wiring
- **Tests needed**: Integration (add onClick → navigateTo → list → verify → undo; setState with state variable; multiple interactions on same event)

---

## Tier 3 — Asset & Data Management

These features enable data-driven and media-rich pages.

### 3.1 Images & Assets
- **Spec**: `specs/gap-images-and-assets.md`
- **Status**: NOT IMPLEMENTED
  - Verified: only read-path `ImageAssetRef` handling exists in tree-reader
  - WAB backing confirmed: `TplMgr.addImageAsset()` (line 1906), `renameImageAsset()` (line 1935), `removeImageAsset()` (line 1951) in `shared/TplMgr.ts`
- **What**: Four site-level + one node-level action:
  - `list-assets` — list all ImageAssets with optional type filter
  - `upload-asset` — create ImageAsset from URL or dataUri
  - `remove-asset` — delete and clean up references
  - `rename-asset` — rename by ref
  - `set-image` — set image on node (by asset ref or raw src URL), variant-aware
- **Effort**: Medium — URL fetching for upload, plus element-type-aware setting (img tag vs background-image)
- **Tests needed**: Unit + integration (upload → set → read back → verify)

### 3.2 Data Queries
- **Spec**: `specs/gap-data-queries.md`
- **Status**: NOT IMPLEMENTED
  - Verified: zero references to `addEmptyQuery`, `ComponentDataQuery` in MCP src/
  - WAB backing confirmed: `addEmptyQuery()` (line 2835 standalone), `TplMgr.removeComponentQuery()` (line 1240), `clearReferencesToRemovedQueries()` (line 1212) in `shared/TplMgr.ts`
- **What**: Four component-level actions:
  - `add-query` — create ComponentDataQuery or ComponentServerQuery
  - `list-queries` — list all queries on a component
  - `remove-query` — delete and clean up expression references
  - `update-query` — update name or operation config
- **Cross-tool integration**: Query results usable via `$queries.myQuery.data` in dynamic text, data-cond, and data-rep collection expressions
- **Effort**: Medium — straightforward CRUD with reference cleanup
- **Tests needed**: Unit + integration (create query → reference in dynamic text → verify)

---

## Tier 4 — Design System Features

These features enable systematic design management but are not blocking for basic page creation.

### 4.1 Mixins (Reusable Style Bundles)
- **Spec**: `specs/gap-mixins.md`
- **Status**: NOT IMPLEMENTED
  - Verified: zero references to `addMixin`, `create-mixin` in MCP src/
  - WAB backing confirmed: `TplMgr.addMixin()` (line 1748), `removeMixin()` (line 1766), `renameMixin()` (line 1775), `duplicateMixin()` (line 1783) in `shared/TplMgr.ts`
- **What**: Four site-level + two node-level actions:
  - `create-mixin`, `list-mixins`, `update-mixin`, `remove-mixin` — CRUD for reusable style bundles
  - `apply-mixin`, `remove-mixin` (on node) — attach/detach mixin on element's VariantSetting
- **Also requires**: Extend `get-node-details` to show applied mixins
- **Effort**: Medium
- **Tests needed**: Unit + integration (create → apply → update → verify propagation)

### 4.2 Animations
- **Spec**: `specs/gap-animations.md`
- **Status**: NOT IMPLEMENTED
  - Verified: zero references to `AnimationSequence` in MCP src/
  - WAB backing confirmed: `TplMgr.addAnimationSequence()` (line 1798), `removeAnimationSequence()` (line 1814) in `shared/TplMgr.ts`
- **What**: Three site-level + two node-level actions:
  - `create-animation`, `list-animations`, `remove-animation` — site-level keyframe sequences
  - `add-animation`, `remove-animation` (on node) — apply sequence to element with timing options
- **Also requires**: Extend `get-node-details` to show applied animations
- **Effort**: Medium
- **Tests needed**: Unit + integration (create → apply → read back → verify)

### 4.3 Themes
- **Spec**: `specs/gap-themes.md`
- **Status**: NOT IMPLEMENTED
  - Verified: only a doc string example mentioning "Theme" exists in MCP src/
  - WAB backing confirmed: `Theme` (line 2897), `ThemeStyle` (line 2957) in `classes.ts`; `Site.themes[]`, `Site.activeTheme`
- **What**: Five site-level actions:
  - `list-themes`, `create-theme`, `update-theme`, `remove-theme`, `set-active-theme`
- **Dependencies**: Implicit relationship with token and mixin systems
- **Effort**: Medium — CRUD plus active-theme toggle
- **Tests needed**: Unit + integration (create → set active → read tokens → verify override)

---

## Tier 5 — Remaining Features (Smaller Gaps)

### 5.1 Remaining Features Bundle
- **Spec**: `specs/gap-remaining-features.md`
- **Status**: ALL NOT IMPLEMENTED (confirmed for all 8 sub-features)
- **Sub-features** (ordered by utility):
  1. **Reorder Children** — `node({ action: "reorder" })` using `TplMgr.reorderChildren()` (line 2210)
  2. **Global Variant Groups** — create/rename/remove global groups + screen breakpoints using `TplMgr.createGlobalVariantGroup()` (line 763), `createScreenVariant()` (line 781)
  3. **Convert Page ↔ Component** — using `TplMgr.convertComponentToPage()` (line 1543) / `convertPageToComponent()` (line 1581)
  4. **Extract to Component** — using subtree extraction → new component + instance replacement
  5. **Data Tokens** — CRUD for `Site.dataTokens[]` using `TplMgr.addDataToken()` (line 2163)
  6. **Code Component Meta** — read-only `get-code-meta` for code component introspection
  7. **Custom Functions** — read-only `list-functions` for custom project functions
  8. **A/B Testing (Splits)** — CRUD for `Split` + `SplitSlice` using WAB split utilities
- **Effort**: Varies (reorder is trivial; extract is complex)
- **Tests needed**: Unit + integration per sub-feature

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
Phase 2 (Authoring):        2.1 State
Phase 3 (Interactivity):    2.2 Interactions → CQ-2/CQ-3 Slot Gaps
Phase 4 (Assets & Data):    3.1 Images → 3.2 Queries
Phase 5 (Design System):    4.1 Mixins → 4.2 Animations → 4.3 Themes
Phase 6 (Remaining):        5.1 sub-features (reorder, global variants, convert, extract, etc.)
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
