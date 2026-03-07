# Implementation Plan

**Last updated:** 2026-03-07
**Branch:** `feat/mcp-variant-fixes`
**Focus:** Gaps #33-39 from the Plasmic MCP gap tracker
**Codebase quality:** CONFIRMED clean (zero TODOs, FIXMEs, HACKs, skipped tests, placeholders, debugger statements; all `as any` justified at WAB module boundaries and test mocks; no production console.log)

## Status Summary

| Category | Count |
|----------|-------|
| Specs | 5 |
| Items to implement | 7 (across 5 specs) |
| Completed | 4 (Gap #33, Gap #34, Gap #35, Gap #39) |

---

## Specs

| Spec | Gaps | Priority | Status |
|------|------|----------|--------|
| `toggle-variant-state-linking.md` | #33 | P0 Critical | COMPLETE |
| `visibility-api-polish.md` | #34 | P1 Major | COMPLETE |
| `batch-architecture-research.md` | #35 | P1 Major | COMPLETE |
| `interaction-improvements.md` | #38, #39 | P2 Medium | #39 COMPLETE, #38 NOT STARTED |
| `element-styling-dx.md` | #36, #37 | P2 Medium | NOT STARTED |

---

## P0 — Critical

### 1. Toggle Variant State Linking (Gap #33) — COMPLETE

- **Spec:** `.ralph/specs/toggle-variant-state-linking.md`
- **Status:** COMPLETE
- **Scope:** M

**Summary of changes:**
- Added `linkedState?: { name: string; uuid: string }` to `CreateVariantGroupResult` interface
- After `tplMgr.createVariantGroup()`, scans `component.states` for the implicit state linked to the toggle group by matching `state.param` to `group.param` (reference equality or UUID match)
- Returns `linkedState` in response for toggle groups
- Updated `buildActionArgs()` signature to accept optional `component` parameter
- Added variant group name/UUID resolution in `updateVariable` case: when no state matches the name, searches `component.variantGroups` and resolves to the linked state
- Updated all 3 call sites (`addInteraction`, 2x `updateInteraction`) to pass `component`
- Updated server.ts `create-group` response to include `linkedState` and a helpful message
- Added 3 tests in variant.test.ts (linkedState returned, undefined for non-toggle, undefined when no matching state)
- Added 5 tests in interaction.test.ts (group name resolution, UUID resolution, no linked state error, state priority over group name)
- Blocker B1 (`buildActionArgs` lacking component context) resolved as part of this work

---

## P1 — High Priority

### 2. Visibility API Polish (Gap #34) — COMPLETE

- **Spec:** `.ralph/specs/visibility-api-polish.md`
- **Status:** COMPLETE
- **Scope:** S

**Summary of changes:**
- Added `z.literal("hidden")` to Zod union in server.ts and updated `.describe()` to document all three visibility states
- Added `note?: string` to `SetVisibilityResult` interface
- Updated `setVisibility()` function signature to accept `boolean | "displayNone" | "hidden"`
- Added early normalization: `"hidden"` → `"displayNone"` before processing (uses same code path)
- When `visible === false`, returns informational `note` explaining notRendered vs hidden distinction
- Updated tool description to show `"hidden"` as the recommended value for responsive hiding
- Server response includes `note` field when present (both dry-run and normal paths)
- Added 4 tests in node.test.ts: hidden alias maps to displayNone, false returns note, true returns no note, displayNone returns no note
- All 298 existing tests pass unchanged (backward compatible)

---

### 3. Batch Architecture Research & Redesign (Gap #35) — COMPLETE

- **Spec:** `.ralph/specs/batch-architecture-research.md`
- **Status:** COMPLETE
- **Scope:** M-L

**Summary of changes:**
- Created `micro-batch.ts` (~230 lines) with per-call error isolation and coalesced saves
  - `registerCall(callId)` creates micro-batch on first call; no-op when explicit batch active
  - `commitCall(callId, apiClient, changes, description, componentIids)` records changes, returns Promise resolved when batch saves
  - `failCall(callId)` marks call as failed (changes already rolled back by ChangeRecorder)
  - `doFlush()` merges committed entries, single HTTP save, pushes individual undo entries
  - `scheduleFlushIfReady()` uses setTimeout(0) for coalescing across Promise.all dispatch
  - 50ms safety timer force-fails pending calls that never settle
  - `setCurrentCallId()`/`getCurrentCallId()` thread-local pattern avoids changing 74+ saveOrAccumulate call sites
- Modified `edit-tools.ts`: added micro-batch routing in `saveOrAccumulate()` between batch check and immediate save
- Modified `server.ts`:
  - Extended `handleMutationError()` with optional `callId` parameter and micro-batch failCall
  - Added callId generation, `registerCall()`, `setCurrentCallId()` to all 6 mutation tool handlers (component, node, variant, design, data, interaction)
  - Added `failCall()` and `setCurrentCallId(null)` in finally blocks
- Created `micro-batch.test.ts` with 21 tests: single call, parallel commits (3 calls coalesced to 1 save), partial failure (2 succeed + 1 fail results in 1 save), all fail (no save), save failure (rollback + reject), safety timer, explicit batch precedence, sequential batches, component IID merging, failCall idempotency, resetMicroBatch
- All 1995 tests pass (41 files, 0 failures, 0 regressions)
- Backward compatible: explicit `begin-batch`/`end-batch` unchanged

---

## P2 — Medium Priority

### 4. updateVariable Toggle Auto-Value (Gap #39) — COMPLETE

- **Spec:** `.ralph/specs/interaction-improvements.md`
- **Status:** COMPLETE
- **Scope:** S

**Summary of changes:**
- In `buildActionArgs` `updateVariable` case: when `operation === "toggle"` and value is undefined/null/empty, auto-generates `!$state.${stateName}`
- Only throws on missing value when operation is NOT "toggle"
- Explicit value with `operation: "toggle"` is used as-is
- Added 3 tests in interaction.test.ts (auto-generates toggle value, uses explicit value, still requires value for non-toggle)

---

### 5. customFunction Single-Quote Handling (Gap #38)

- **Spec:** `.ralph/specs/interaction-improvements.md`
- **Status:** NOT STARTED (confirmed via code analysis — zero validation for customFunction)
- **Scope:** S-M
- **Dependencies:** None

**Code locations (verified):**
- `edit-tools.ts:5724-5737` — `buildActionArgs` customFunction case (code stored as-is, NO validation call)
- `edit-tools.ts:174-188` — `validateJsExpression()` (exists, uses acorn `parseExpressionAt`, NOT called for customFunction)

**Tasks:**
1. Investigate root cause: test save with single quotes via MCP vs Studio
2. Add `validateJsExpression(code)` call before creating FunctionExpr (between lines 5727-5729)
3. If server rejects single quotes: use acorn AST walk to normalize string literals
4. Return descriptive error on validation failure instead of letting 500 propagate

**Tests (interaction.test.ts):**
- Test: syntax error in customFunction throws descriptive error
- Test: template literals with single quotes preserved as-is
- Test: double-quoted strings pass without normalization
- Verify existing `alert('hello')` test (line 290-310) still passes

---

### 6. Component Instance Styling Propagation (Gap #36)

- **Spec:** `.ralph/specs/element-styling-dx.md`
- **Status:** NOT STARTED (confirmed via code analysis — zero implementation)
- **Scope:** M
- **Dependencies:** None

**Code locations (verified):**
- `edit-tools.ts:2178-2183` — `UpdateStylesResult` interface (missing `note`, `appliedToNode`)
- `edit-tools.ts:2195-2265` — `updateStyles()` function
  - Line 2207: detects TplComponent via `isKnownTplComponent(tpl)` — but does NOT differentiate behavior
  - Lines 2240-2242: applies ALL styles to wrapper VariantSetting — no layout vs visual split
  - Lines 2259-2264: return block — no `note` or `appliedToNode` fields

**Tasks:**
1. **Research Studio behavior first (CRITICAL — Risk R3):** How does Studio apply styles to component instances? Layout/visual split or always wrapper?
2. Add `note?: string` and `appliedToNode?: { name?: string; uuid: string }` to `UpdateStylesResult`
3. If Studio does layout/visual split: classify style properties; route visual styles to `tpl.component.tplTree` root, layout styles to wrapper
4. If Studio always styles wrapper: add informational `note` only
5. Fallback: if component root can't be determined, use wrapper with warning

**Tests (node.test.ts):**
- Extend TplComponent test (line 1194) to verify `note` field
- Test: layout styles applied to wrapper
- Test: visual styles applied to component root (if Studio does this)
- Test: component with no identifiable root falls back with warning

---

### 7. Box Default Padding Information (Gap #37)

- **Spec:** `.ralph/specs/element-styling-dx.md`
- **Status:** NOT STARTED (confirmed via code analysis — zero implementation)
- **Scope:** S
- **Dependencies:** None

**Code locations (verified):**
- `edit-tools.ts:2585-2595` — `AddChildResult` interface (missing `note`, `defaults`; has `warnings?: string[]` already)
- `edit-tools.ts:2836-3030` — `addChild()` function
  - Lines 3009-3012: creates element and inserts (TplTag path)
  - Lines 3022-3029: return block — no note or defaults
  - Lines 2966-2974: return block for TplComponent slot path — also no note or defaults

**Tasks:**
1. Add `note?: string` and `defaults?: Record<string, string>` to `AddChildResult`
2. After element creation (line 3012), check if child is box/vbox/hbox
3. For box types: always set `defaults: { padding: "8px" }`
4. If explicit height/width <= 16px: set `note` warning about padding + box-sizing
5. No auto-zeroing — informational only
6. Apply same logic to TplComponent slot path return (lines 2966-2974)

**Tests (node.test.ts):**
- Test: box with `height: "2px"` returns `note` and `defaults`
- Test: box with `height: "100px"` returns `defaults` but no `note`
- Test: box without explicit height returns `defaults` but no `note`
- Test: non-box element returns no `defaults`
- Test: vbox/hbox returns same `defaults` as box

---

## Implementation Sequence

```
Phase 1 (P0):
  Gap #33 (toggle state linking)        ████████████████████  COMPLETE
    │
    ├──→ Gap #39 (toggle auto-value)    ████████████████████  COMPLETE
    │
Phase 2 (P1, parallel with Phase 1):
  Gap #34 (visibility polish)           ████████████████████  COMPLETE
  Gap #35 (batch micro-batch impl)      ████████████████████  COMPLETE
    │
Phase 3 (P2, parallel after Phase 1):
  Gap #38 (customFunction validation)   ░░░░░░░░░░░░░░░░░░░░  NOT STARTED
  Gap #36 (instance styling)            ░░░░░░░░░░░░░░░░░░░░  NOT STARTED
  Gap #37 (box defaults)                ░░░░░░░░░░░░░░░░░░░░  NOT STARTED
```

**Parallelization notes:**
- Phases 1 and 2 COMPLETE — Gaps #33, #34, #35, #39 all done
- Phase 3 items (#38, #36, #37) are independent of each other and unblocked
- Gaps #36, #37, #38 all touch `edit-tools.ts` — serialize if same developer

---

## Confirmed Blockers

| # | Blocker | Affects | Details | Resolution |
|---|---------|---------|---------|------------|
| B1 | ~~`buildActionArgs` lacks component context~~ | ~~Gap #33, #39~~ | **RESOLVED** — Optional `component` parameter added to `buildActionArgs` signature. All 3 call sites (`addInteraction`, 2x `updateInteraction`) updated to pass `component`. Completed as part of Gap #33 implementation. | RESOLVED |

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | ~~Implicit state not discoverable in `component.states` after `tplMgr.createVariantGroup()`~~ | ~~Low~~ | ~~High~~ | RESOLVED — Gap #33 complete. State discovered via `state.param === group.param` match. |
| R2 | ~~Variant group name resolution conflicts with existing state names~~ | ~~Low~~ | ~~Medium~~ | RESOLVED — Gap #33 complete. State name match takes priority over group name match, confirmed by tests. |
| R3 | Studio applies TplComponent styles differently than expected (Gap #36) | Medium | High | Research Studio source code BEFORE implementing. If Studio always styles wrapper, simplify to informational note. |
| R4 | ~~Batch redesign breaks existing `begin-batch`/`end-batch` consumers~~ | ~~Medium~~ | ~~High~~ | RESOLVED — Gap #35 complete. Explicit batches unchanged; micro-batch is dormant when explicit batch is active. Backward compatible by design. |
| R5 | Single-quote issue in customFunction is server-side codegen, unfixable in MCP | Medium | Low | Pre-validate with acorn. If server rejects, normalize in MCP. Document limitation. |
| R6 | `validateJsExpression` rejects valid customFunction code (IIFEs) | Low | Medium | acorn `parseExpressionAt` handles IIFEs correctly. Test with documented IIFE format. |
| R7 | Box default padding info adds noise to every `addChild` response | Low | Low | Only add `note` for small dimensions (<= 16px). Always include `defaults` (structured data). |

---

## Critical Files

All file paths relative to `packages/plasmic-mcp/src/`:

| File | Gaps | Role |
|------|------|------|
| `edit-tools.ts` | All 7 | Core logic: createVariantGroup, buildActionArgs, setVisibility, updateStyles, addChild, validateJsExpression |
| `server.ts` | #33, #34, #35 | Tool schemas (Zod), response shaping, handleMutationError |
| `batch-manager.ts` | #35 | Explicit batch state machine, accumulate/end/cancel |
| `micro-batch.ts` | #35 | Implicit micro-batch: per-call error isolation, coalesced saves |
| `undo-manager.ts` | #35 | Per-call undo stack (Architecture E foundation) |
| `__tests__/variant.test.ts` | #33 | Toggle group creation tests |
| `__tests__/interaction.test.ts` | #33, #38, #39 | updateVariable and customFunction tests |
| `__tests__/node.test.ts` | #34, #36, #37 | Visibility, styling, addChild tests |
| `__tests__/batch-manager.test.ts` | #35 | Batch lifecycle and error recovery tests |
| `__tests__/micro-batch.test.ts` | #35 | Micro-batch coalescing, partial failure, safety timer tests |
