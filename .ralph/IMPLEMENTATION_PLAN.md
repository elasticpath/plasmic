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
| Completed | 7 (ALL GAPS COMPLETE) |

---

## Specs

| Spec | Gaps | Priority | Status |
|------|------|----------|--------|
| `toggle-variant-state-linking.md` | #33 | P0 Critical | COMPLETE |
| `visibility-api-polish.md` | #34 | P1 Major | COMPLETE |
| `batch-architecture-research.md` | #35 | P1 Major | COMPLETE |
| `interaction-improvements.md` | #38, #39 | P2 Medium | COMPLETE |
| `element-styling-dx.md` | #36, #37 | P2 Medium | COMPLETE |

---

## All Gaps Complete

All 7 gaps (#33-#39) across all 5 specs are implemented and tested.
Total test count: 2177 tests across 44 files, 0 failures.

### Phase 3 Summary (Gaps #36, #37, #38)

#### Gap #38 — customFunction Single-Quote Handling — COMPLETE

- **Spec:** `.ralph/specs/interaction-improvements.md`
- **Scope:** S-M

**Summary of changes:**
- Added `normalizeCustomFunctionCode()` function that validates code as a JS expression (acorn parse) and normalizes single-quoted string literals to double-quoted (Plasmic codegen rejects single quotes with HTTP 500)
- Added `walkAstNodes()` helper for recursive acorn AST traversal
- Modified `buildActionArgs()` customFunction case to validate and normalize code before creating FunctionExpr
- Normalization uses `JSON.stringify(node.value)` for correct escaping of all special characters
- Template literals and double-quoted strings pass through unchanged
- Descriptive error on syntax errors: "Invalid customFunction code: ... The code must be a valid JS expression"
- Updated existing `alert('hello')` test assertion to expect normalized `alert("hello")`
- Added 4 tests in interaction.test.ts: syntax error rejection, single-quote normalization, template literal preservation, double-quote passthrough
- Risks R5 (server-side unfixable) and R6 (validateJsExpression rejects IIFEs) both resolved — acorn handles all valid expression types correctly

#### Gap #37 — Box Default Padding Information — COMPLETE

- **Spec:** `.ralph/specs/element-styling-dx.md`
- **Scope:** S

**Summary of changes:**
- Added `note?: string` and `defaults?: Record<string, string>` to `AddChildResult` interface
- Added `boxDefaultsInfo()` helper function that detects box/vbox/hbox types and returns `{ defaults: { padding: "8px" } }` plus an optional `note` when height/width ≤ 16px
- Applied `...boxDefaultsInfo(child)` to both return paths (TplComponent slot path and TplTag path)
- Updated server.ts `add-child` response to include `note` and `defaults` in both dry-run and normal paths
- Added 5 tests in node.test.ts: box with large height (defaults only), box with small height (defaults + note), box without dimensions (defaults only), non-box element (no defaults), vbox/hbox (same defaults as box)
- Risk R7 (noise in addChild response) resolved — note only appears for small dimensions, defaults is structured data

#### Gap #36 — Component Instance Styling Note — COMPLETE

- **Spec:** `.ralph/specs/element-styling-dx.md`
- **Scope:** M (reduced after research)

**Key research finding:** Studio does NOT route visual styles to the component root. Only `TPL_COMPONENT_PROPS` (defined in `platform/wab/src/wab/shared/core/style-props.ts`) are applicable: positioning, sizing, margins, opacity, transform. Padding, background, border etc. are silently ignored by codegen. This triggered the Risk R3 mitigation path ("If Studio always styles wrapper, simplify to informational note").

**Summary of changes:**
- Added `note?: string` to `UpdateStylesResult` interface
- Added `TPC_APPLICABLE_PROPS` constant — set of CSS properties applicable to TplComponent instances (matching Studio's `TPL_COMPONENT_PROPS`)
- In `updateStyles()`, after save, checks if any requested properties are not in `TPC_APPLICABLE_PROPS` and returns informational note listing the inapplicable properties
- Updated server.ts `update-styles` response to include `note` in both dry-run and normal paths
- Added 3 tests in node.test.ts: inapplicable styles return note, applicable styles return no note, TplTag styles never return note
- Risk R3 RESOLVED — Studio always styles wrapper; informational note implemented per mitigation plan

---

## Implementation Sequence — ALL COMPLETE

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
  Gap #38 (customFunction validation)   ████████████████████  COMPLETE
  Gap #36 (instance styling note)       ████████████████████  COMPLETE
  Gap #37 (box defaults)                ████████████████████  COMPLETE
```

---

## Risk Register — ALL RESOLVED

| # | Risk | Resolution |
|---|------|------------|
| R1 | Implicit state not discoverable | RESOLVED — Gap #33. State discovered via `state.param === group.param` match. |
| R2 | Variant group name conflicts | RESOLVED — Gap #33. State name takes priority, confirmed by tests. |
| R3 | Studio TplComponent styles differently | RESOLVED — Gap #36. Studio only allows TPL_COMPONENT_PROPS on instances. Informational note implemented. |
| R4 | Batch redesign breaks consumers | RESOLVED — Gap #35. Explicit batches unchanged; micro-batch dormant when explicit active. |
| R5 | Single-quote issue unfixable in MCP | RESOLVED — Gap #38. normalizeCustomFunctionCode uses acorn AST walk + JSON.stringify for quote conversion. |
| R6 | validateJsExpression rejects IIFEs | RESOLVED — Gap #38. acorn parseExpressionAt handles IIFEs correctly. |
| R7 | Box defaults adds noise | RESOLVED — Gap #37. Note only for small dims, defaults always structured. |

---

## Critical Files

All file paths relative to `packages/plasmic-mcp/src/`:

| File | Gaps | Role |
|------|------|------|
| `edit-tools.ts` | All 7 | Core logic: createVariantGroup, buildActionArgs, setVisibility, updateStyles, addChild, normalizeCustomFunctionCode |
| `server.ts` | #33, #34, #35, #36, #37 | Tool schemas (Zod), response shaping, handleMutationError |
| `batch-manager.ts` | #35 | Explicit batch state machine, accumulate/end/cancel |
| `micro-batch.ts` | #35 | Implicit micro-batch: per-call error isolation, coalesced saves |
| `undo-manager.ts` | #35 | Per-call undo stack (Architecture E foundation) |
| `__tests__/variant.test.ts` | #33 | Toggle group creation tests |
| `__tests__/interaction.test.ts` | #33, #38, #39 | updateVariable and customFunction tests |
| `__tests__/node.test.ts` | #34, #36, #37 | Visibility, styling, addChild tests |
| `__tests__/batch-manager.test.ts` | #35 | Batch lifecycle and error recovery tests |
| `__tests__/micro-batch.test.ts` | #35 | Micro-batch coalescing, partial failure, safety timer tests |
