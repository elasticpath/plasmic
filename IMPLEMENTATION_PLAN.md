# Implementation Plan — Plasmic MCP Claude Code Skills

> **Goal**: Create Claude Code skills and workflows that can interact with Plasmic Studio
> programmatically to create fully-featured pages from the Claude Code terminal.
>
> **Current state**: 8 STRAP domain tools (consolidating 103 actions), 6 Claude Code skills (STRAP calling convention), 1116 tests (998 unit + 118 integration), 19 test files.
> Zero TODOs/FIXMEs/skipped tests. Zero tsc errors. All code quality items complete.
>
> **Last verified**: 2026-02-26 — All 1116 tests pass, tsc clean. Skills audit complete.
>
> **Spec consistency pass 1** (2026-02-26): Fixed 4 gap spec → STRAP naming discrepancies:
> `gap-mixins.md` remove-mixin→detach-mixin, `gap-themes.md` themeRef→themeIndex,
> `gap-animations.md` added missing update-animation action, `test-restructure.md` added interaction.update.
>
> **Spec consistency pass 2** (2026-02-26): Fixed 9 remaining gap spec → implementation discrepancies:
> `gap-visibility-and-conditional.md` "customCode"→"displayNone", `gap-data-repetition.md` "node domain"→"data domain",
> `gap-token-crud.md` type→tokenType, `gap-images-and-assets.md` type→assetType,
> `gap-interactions.md` added event+interactionName params to update, `gap-animations.md` animationRef→seqRef+animationIndex,
> `gap-data-queries.md` update-query name? made required+removed op?, `gap-remaining-features.md` newName→name for extract,
> splits weight→prob+added splitType+added update-split action.

---

## Verification Summary

All WAB backing functions referenced in specs have been confirmed to exist in
`platform/wab/src/wab/shared/` with one exception: **`removeStyleToken()` does NOT
exist as a TplMgr method**. Token removal is done via direct array manipulation
(see `code-components.ts` line 4646 for a local `removeToken` pattern that splices
from `site.styleTokens`). The Token CRUD spec (1.3) handles removal manually.

The MCP source lives entirely in `packages/plasmic-mcp/src/` (16 source files,
~8,200 lines). The `src/tools/` directory exists but is empty (created for future refactor).

Key file sizes: `server.ts` (~4,730 lines after STRAP consolidation), `edit-tools.ts` (~5,900 lines),
`tree-reader.ts` (~850 lines).

Spec consistency: All 15 gap specs updated to reflect STRAP domain assignments (2026-02-26).
Pass 1 fixed 4 naming discrepancies (detach-mixin, themeIndex, update-animation, interaction.update).
Pass 2 fixed 9 remaining discrepancies (displayNone, data domain header, tokenType, assetType, interaction.update params, seqRef/animationIndex, update-query name required, extract name, splits prob/splitType/update-split).
STRAP spec updated for `component.extract` (Tier 5.1) and `interaction.update`.

---

## Tier 1 — Core Page-Building Gaps

### 1.1 Visibility & Conditional Rendering — IMPLEMENTED
- **Spec**: `specs/gap-visibility-and-conditional.md`

### 1.2 Data Repetition (Collection Rendering) — IMPLEMENTED
- **Spec**: `specs/gap-data-repetition.md`

### 1.3 Token CRUD — IMPLEMENTED
- **Spec**: `specs/gap-token-crud.md`

### 1.4 Component Props Definition — IMPLEMENTED
- **Spec**: `specs/gap-component-props.md`

### 1.5 Rich Text Formatting — IMPLEMENTED
- **Spec**: `specs/gap-rich-text.md`

---

## Tier 2 — Interactive Pages

### 2.1 State Management — IMPLEMENTED
- **Spec**: `specs/gap-state-management.md`

### 2.2 Interactions & Event Handlers — IMPLEMENTED
- **Spec**: `specs/gap-interactions.md`
- All 4 actions implemented: list, add, update, remove (update added 2026-02-26)

---

## Tier 3 — Asset & Data Management

### 3.1 Images & Assets — IMPLEMENTED
- **Spec**: `specs/gap-images-and-assets.md`

### 3.2 Data Queries — IMPLEMENTED
- **Spec**: `specs/gap-data-queries.md`

---

## Tier 4 — Design System Features

### 4.1 Mixins (Reusable Style Bundles) — IMPLEMENTED
- **Spec**: `specs/gap-mixins.md`

### 4.2 Animations — IMPLEMENTED
- **Spec**: `specs/gap-animations.md`

### 4.3 Themes — IMPLEMENTED
- **Spec**: `specs/gap-themes.md`

---

## Tier 5 — Remaining Features

### 5.1 Remaining Features Bundle — IMPLEMENTED (8 of 8)
- **Spec**: `specs/gap-remaining-features.md`
- Sub-features done: Reorder Children, Global Variant Groups, Convert Page/Component, Data Tokens, Code Component Meta, Custom Functions, A/B Testing (Splits), Extract to Component
- Previously deferred variant actions now implemented (2026-02-26): create-screen, update-screen, rename, remove — variant domain expanded from 8 to 12 actions

---

## Tier 6 — Architecture & Infrastructure

### 6.1 STRAP Consolidation (103 Actions → 8 Domain Tools) — IMPLEMENTED
- **Spec**: `specs/strap-consolidation.md`

### 6.2 Test Restructure — IMPLEMENTED
- **Spec**: `specs/test-restructure.md`

---

## Tier 7 — Skills Updates

### 7.1 Update Skills for New Features (Pre-STRAP) — IMPLEMENTED
- All 6 skills updated to cover all 98 tools

### 7.2 Rewrite Skills for STRAP (Post-Consolidation) — IMPLEMENTED
- All 6 skills rewritten to use `domain({ action: "..." })` calling convention

### 7.3 Skills Audit — Parameter Name Alignment — IMPLEMENTED
- Audited all 6 skills against server.ts Zod schemas
- **25+ parameter mismatches fixed** across 5 skill files (plasmic.md, plasmic-edit.md, plasmic-patterns.md, plasmic-inspect.md, plasmic-create-page.md was clean, plasmic-create-component.md was clean)
- Key fixes: `visibility`→`visible`, `expr`→`condition`, `elementVar`→`elementVariable`, `indexVar`→`indexVariable`, `initVal`→`initialValue`, `body/serverSide`→`queryType`, `action`→`actionName`, `eventIndex`→`interactionIndex`, `sequenceRef`→`seqRef`, `offset`→`percentage`, `tagStyles`→`themeStyles`, `src`→`url` (upload-asset), removed non-existent `nameFilter` param
- **6 missing actions added**: `interaction.update`, `variant.create-screen`, `variant.update-screen`, `variant.rename`, `variant.remove`, `component.extract`
- **Why**: Wrong parameter names in skills cause tool calls to fail with Zod validation errors when Claude Code uses them to interact with Plasmic. This was the highest-priority fix.

---

## Code Quality Items

| Item | Status | Description |
|------|--------|-------------|
| CQ-1 Dead Clone Code Removal | DONE | Removed 7 dead functions (~165 lines); all tests pass |
| CQ-2 moveChild Slot Support | DONE | Added optional `slot` param to `moveChild()`, mirroring `addChild()` semantics |
| CQ-3 cloneChild Slot Support | DONE | Added optional `slot` param to `cloneChild()`, mirroring `addChild()` semantics |
| CQ-4 tree-reader Base-Variant-Only | N/A | Known limitation; variant param considered lower priority — no action taken |
| CQ-5 Integration Test Coverage Gaps | DONE | 12 new integration tests covering 11 previously untested tools |
| CQ-6 server.test.ts Unit Test Gaps | DONE | 5 new unit tests covering 3 gaps (variant.list, dryRun paths, end-batch error) |
| CQ-7 addChild Password Auto-Attribute | DONE | `type: "password"` now auto-sets attribute; remaining element-type tests deferred |
| CQ-8 wab.d.ts Type Declaration Gaps | DONE | Fixed 20 tsc errors; `tsc --noEmit` passes with zero errors |

---

## Implementation Order (Completed)

All phases are complete. The order followed was:

1. Foundations (Tiers 1–2): Visibility, Data Repetition, Tokens, Props, Rich Text, State, Interactions
2. Assets & Data (Tier 3): Images, Queries
3. Design System (Tier 4): Mixins, Animations, Themes
4. Remaining Features (Tier 5): Reorder, Global Variants, Convert, Data Tokens, Code Meta, Custom Functions, Splits
5. Architecture (Tiers 6–7): STRAP consolidation, Skills rewrite, Test restructure
6. Code Quality (CQ-1 through CQ-8): Applied throughout
