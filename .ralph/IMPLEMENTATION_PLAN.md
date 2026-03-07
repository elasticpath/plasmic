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
| Completed | 0 |

---

## Specs

| Spec | Gaps | Priority | Status |
|------|------|----------|--------|
| `toggle-variant-state-linking.md` | #33 | P0 Critical | NOT STARTED |
| `visibility-api-polish.md` | #34 | P1 Major | NOT STARTED |
| `batch-architecture-research.md` | #35 | P1 Major | RESEARCH COMPLETE — ready to implement |
| `interaction-improvements.md` | #38, #39 | P2 Medium | NOT STARTED |
| `element-styling-dx.md` | #36, #37 | P2 Medium | NOT STARTED |

---

## P0 — Critical

### 1. Toggle Variant State Linking (Gap #33)

- **Spec:** `.ralph/specs/toggle-variant-state-linking.md`
- **Status:** NOT STARTED (confirmed via code analysis — zero implementation)
- **Scope:** M
- **Dependencies:** None (upstream of Gap #39)
- **Blocker:** `buildActionArgs` signature lacks component context (see Confirmed Blockers below)

**Code locations (verified):**
- `edit-tools.ts:3930-3936` — `CreateVariantGroupResult` interface (missing `linkedState`)
- `edit-tools.ts:3951-4015` — `createVariantGroup()` function (no state capture after TplMgr call)
  - Line 3982: `tplMgr.createVariantGroup()` call — implicit state created here but not captured
  - Lines 4008-4014: return block — no `linkedState` field
  - Line 4011: captures `group!.param?.variable?.name` (group param name, NOT implicit state name)
- `edit-tools.ts:5680-5744` — `buildActionArgs()` function
  - Line 5680: signature `(actionName: string, args: Record<string, string>)` — **NO component parameter**
  - Lines 5698-5722: updateVariable case — NO variant group name resolution
- `edit-tools.ts:5342-5348` — `findState()` helper (reusable for group-to-state lookup)
- `edit-tools.ts:5756-5790` — `addInteraction()` — calls `buildActionArgs` at line 5790; has `component` in scope from line 5774
- `server.ts:3583-3599` — response shape for `create-group` (missing `linkedState`)

**Tasks:**
1. Extend `CreateVariantGroupResult` interface with `linkedState?: { name: string; uuid: string }`
2. After `tplMgr.createVariantGroup()` (line 3982), scan `component.states` for the newly created implicit state by matching `state.param === group.param`. Return `linkedState` for toggle type.
3. **Refactor `buildActionArgs` signature** (CRITICAL — see Confirmed Blockers): add optional `component` parameter. Update call site at `addInteraction` line 5790 to pass `component`.
4. In `buildActionArgs` updateVariable case (lines 5698-5722): if `stateName` doesn't match a state, search `component.variantGroups` for a matching group name/UUID. If group is standalone (toggle) type, resolve to its linked implicit state. If group is not toggle, throw descriptive error.
5. Update server.ts response (lines 3583-3599) to include `linkedState` field and update message string.

**Tests (variant.test.ts, interaction.test.ts):**
- Extend toggle test (line 1061-1084) to assert `result.linkedState` returned
- Test: `buildActionArgs` resolves variant group name to linked state ObjectPath
- Test: `buildActionArgs` resolves variant group UUID to linked state
- Test: non-toggle group name throws descriptive error
- Test: state name match takes priority over group name match

---

## P1 — High Priority

### 2. Visibility API Polish (Gap #34)

- **Spec:** `.ralph/specs/visibility-api-polish.md`
- **Status:** NOT STARTED (confirmed via code analysis — zero implementation)
- **Scope:** S
- **Dependencies:** None

**Code locations (verified):**
- `server.ts:2594` — Zod schema: `z.union([z.boolean(), z.literal("displayNone")])` — missing `z.literal("hidden")`
- `edit-tools.ts:4019-4025` — `SetVisibilityResult` interface (missing `note`)
- `edit-tools.ts:4039-4122` — `setVisibility()` function
  - Line 4043: signature accepts `boolean | "displayNone"` only — no `"hidden"`
  - Lines 4076-4094: three branches handle true/false/"displayNone" — no "hidden" case
  - Lines 4115-4121: return block — no `note` field
- `server.ts:2557` — tool description (only shows `visible:false` example, doesn't document all states)

**Tasks:**
1. Add `z.literal("hidden")` to Zod union at line 2594 and update `.describe()` text
2. Add `note?: string` to `SetVisibilityResult` interface at line 4019
3. Update function signature (line 4043) to accept `boolean | "displayNone" | "hidden"`
4. Accept `"hidden"` in function body, normalize to `"displayNone"` before processing
5. When `visible === false`, set `note` explaining notRendered vs hidden distinction
6. Update tool description at line 2557 to document all three states

**Tests (node.test.ts — 10 existing visibility tests at lines 5136-5335):**
- Test: `visible: "hidden"` maps to displayNone behavior
- Test: `visible: false` returns informational `note`
- Test: `visible: true` returns no `note`
- Existing true/false/displayNone tests unchanged (backward compat)

---

### 3. Batch Architecture Research & Redesign (Gap #35)

- **Spec:** `.ralph/specs/batch-architecture-research.md`
- **Status:** RESEARCH COMPLETE — ready to implement Implicit Micro-Batch architecture
- **Scope:** M-L (implementation only — research done)
- **Dependencies:** None (but impacts all mutation tools)

**Code locations (verified):**
- `batch-manager.ts` — entire file (236 lines)
  - Lines 30-35: `BatchState` interface
  - Lines 98-115: `accumulateChanges()` — merges without isolation
  - Lines 121-171: `endBatch()` — all-or-nothing save
  - Lines 191-209: `cancelBatchWithRollback()` — reverts ALL accumulated changes
- `server.ts:290-300` — `handleMutationError` (cancels entire batch on any error, no per-call handling)
- `edit-tools.ts:1083-1127` — `saveOrAccumulate()` (routes to batch or immediate save, no `callId` parameter, no micro-batch routing)
- `undo-manager.ts` — full undo stack (MAX_UNDO_DEPTH=50, push/pop/replace)
- `rebase-engine.ts:120-259` — handles mixed batch + undo stack rebase

**Confirmed gaps:**
- `micro-batch.ts` file DOES NOT EXIST
- Zero references to microBatch/micro-batch/MicroBatch/registerCall/commitCall/failCall/isMicroBatchActive anywhere in codebase
- No `callId` generation in any of the 8 mutation handler catch blocks
- cross-module-integration.test.ts (453 lines): no micro-batch tests

**Research findings (COMPLETE — see spec for full details):**
- No MCP server uses automatic multi-tool transactions; community pattern is per-tool independence
- MCP SDK dispatches parallel calls sequentially via microtask queue (no interleaving)
- Problem is purely error handler blast radius, not race conditions
- Undo manager and per-call auto-rollback (edit-tools.ts:1098-1126) already exist
- SaveManager is HTTP-atomic (no partial save at HTTP level)
- **Decision: Implicit Micro-Batch** — per-burst saves with per-call error isolation, zero LLM ceremony

**Tasks:**
1. Create `micro-batch.ts` (~150 lines) with `MicroBatchEntry`, `MicroBatchState`, and functions: `registerCall`, `commitCall`, `failCall`, `flush`, `isMicroBatchActive`, `isCallSettled`
2. Add micro-batch routing to `saveOrAccumulate()` between explicit batch check and immediate save
3. Extend `handleMutationError()` to call `failCall(callId)` when micro-batch active
4. Add `callId` generation to each mutation tool handler in server.ts
5. Document `project.undo` as recovery mechanism

**Tests (batch-manager.test.ts — 524 lines, new micro-batch.test.ts):**
- Test: parallel calls where one fails — successful calls preserved
- Test: explicit batch with partial failure — only failed call rolled back
- Test: no-batch mode error does not affect other calls
- Test: single call optimization (no coalescing delay)
- Test: explicit batch precedence (micro-batch dormant)

---

## P2 — Medium Priority

### 4. updateVariable Toggle Auto-Value (Gap #39)

- **Spec:** `.ralph/specs/interaction-improvements.md`
- **Status:** NOT STARTED (confirmed via code analysis — zero implementation)
- **Scope:** S
- **Dependencies:** Depends on Gap #33 for full testing (variant group name resolution)

**Code locations (verified):**
- `edit-tools.ts:5698-5722` — `buildActionArgs` updateVariable case
  - Lines 5703-5705: throws if `value === undefined` REGARDLESS of operation type
  - Line 5707: `operation` defaults to `"newValue"`, no special toggle handling
  - No auto-generation of `value = "!$state.${stateName}"` for toggle

**Tasks:**
1. After extracting `operation` (line 5707), auto-generate toggle value:
   ```typescript
   if (operation === "toggle" && (value === undefined || value === null)) {
     value = `!$state.${stateName}`;
   }
   ```
2. Relax the `value === undefined` throw (lines 5703-5705) to only apply when operation is NOT "toggle"
3. If `value` is provided with `operation: "toggle"`, use it as-is

**Tests (interaction.test.ts):**
- Test: toggle without value auto-generates `!$state.<name>`
- Test: toggle with explicit value uses provided value
- Test: newValue without value still throws error

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
  Gap #33 (toggle state linking)        ░░░░░░░░░░░░░░░░░░░░  NOT STARTED
    │
    ├──→ Gap #39 (toggle auto-value)    ░░░░░░░░░░░░░░░░░░░░  NOT STARTED (depends on #33)
    │
Phase 2 (P1, parallel with Phase 1):
  Gap #34 (visibility polish)           ░░░░░░░░░░░░░░░░░░░░  NOT STARTED
  Gap #35 (batch micro-batch impl)      ░░░░░░░░░░░░░░░░░░░░  NOT STARTED (research done)
    │
Phase 3 (P2, parallel after Phase 1):
  Gap #38 (customFunction validation)   ░░░░░░░░░░░░░░░░░░░░  NOT STARTED
  Gap #36 (instance styling)            ░░░░░░░░░░░░░░░░░░░░  NOT STARTED
  Gap #37 (box defaults)                ░░░░░░░░░░░░░░░░░░░░  NOT STARTED
```

**Parallelization notes:**
- Phase 1 must complete before Gap #39 (depends on group name resolution)
- Phase 2 items (#34, #35) are independent of Phase 1 and each other
- Phase 3 items (#38, #36, #37) are independent of each other
- Gap #35 research is complete; implementation can start immediately
- Gaps #34, #36, #37, #38 all touch `edit-tools.ts` — serialize if same developer

---

## Confirmed Blockers

| # | Blocker | Affects | Details | Resolution |
|---|---------|---------|---------|------------|
| B1 | `buildActionArgs` lacks component context | Gap #33, #39 | `buildActionArgs(actionName, args)` at edit-tools.ts:5680 has no `component` parameter. The updateVariable case (lines 5698-5722) cannot look up variant groups without component access. Called from `addInteraction()` at line 5790, which **does** have `component` in scope (obtained at line 5774 via `findComponent(componentUuid)`). | Add optional `component` parameter to `buildActionArgs` signature. Update call site at line 5790 to pass `component`. Keep parameter optional so navigation/customFunction cases are unaffected. Backwards-compatible since parameter is optional and internal-only. |

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Implicit state not discoverable in `component.states` after `tplMgr.createVariantGroup()` | Low | High | Snapshot `component.states` before/after. Fall back to scanning by `param` UUID match. TplMgr creates state synchronously. |
| R2 | Variant group name resolution conflicts with existing state names | Low | Medium | State name match takes priority (more specific). Document in tool description. |
| R3 | Studio applies TplComponent styles differently than expected (Gap #36) | Medium | High | Research Studio source code BEFORE implementing. If Studio always styles wrapper, simplify to informational note. |
| R4 | Batch redesign breaks existing `begin-batch`/`end-batch` consumers | Medium | High | Keep begin/end-batch as opt-in (backward compatible). Default to per-call auto-commit. |
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
| `batch-manager.ts` | #35 | Batch state machine, accumulate/end/cancel |
| `undo-manager.ts` | #35 | Per-call undo stack (Architecture E foundation) |
| `__tests__/variant.test.ts` | #33 | Toggle group creation tests |
| `__tests__/interaction.test.ts` | #33, #38, #39 | updateVariable and customFunction tests |
| `__tests__/node.test.ts` | #34, #36, #37 | Visibility, styling, addChild tests |
| `__tests__/batch-manager.test.ts` | #35 | Batch lifecycle and error recovery tests |
