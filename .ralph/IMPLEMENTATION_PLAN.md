# Implementation Plan

**Last updated:** 2026-03-07
**Branch:** `feat/mcp-variant-fixes`
**Focus:** Gaps #33-39 from the Plasmic MCP gap tracker
**Total tests:** 2193 across 44 files, 0 failures

## Gaps #33-#39 — ALL COMPLETE

| Gap | Title | Priority | Status |
|-----|-------|----------|--------|
| #33 | Toggle variant state linking | P0 Critical | COMPLETE |
| #34 | Visibility API polish (`hidden` alias) | P1 Major | COMPLETE |
| #35 | Implicit micro-batch for error isolation | P1 Major | COMPLETE |
| #36 | TplComponent instance styling note | P2 Medium | COMPLETE |
| #37 | Box default padding information | P2 Medium | COMPLETE |
| #38 | customFunction single-quote handling | P2 Medium | COMPLETE |
| #39 | Toggle variant auto-value | P2 Medium | COMPLETE |

All risks (R1-R7) resolved. Codebase confirmed clean (zero TODOs, FIXMEs, HACKs, skipped tests, placeholders, debugger statements; all `as any` justified at WAB boundaries and test mocks; no production console.log).

---

## Critical Files

All paths relative to `packages/plasmic-mcp/src/`:

| File | Role |
|------|------|
| `edit-tools.ts` | Core logic: createVariantGroup, buildActionArgs, setVisibility, updateStyles, addChild, normalizeCustomFunctionCode |
| `server.ts` | Tool schemas (Zod), response shaping, handleMutationError |
| `batch-manager.ts` | Explicit batch state machine, accumulate/end/cancel |
| `micro-batch.ts` | Implicit micro-batch: per-call error isolation, coalesced saves |
| `undo-manager.ts` | Per-call undo stack (Architecture E foundation) |
| `__tests__/variant.test.ts` | Toggle group creation tests |
| `__tests__/interaction.test.ts` | updateVariable and customFunction tests |
| `__tests__/node.test.ts` | Visibility, styling, addChild tests |
| `__tests__/batch-manager.test.ts` | Batch lifecycle and error recovery tests |
| `__tests__/micro-batch.test.ts` | Micro-batch coalescing, partial failure, safety timer tests |
| `__tests__/server.test.ts` | Server-level integration tests (see below) |

---

## Post-Completion: Server-Level Test Coverage

Added **16 server-level integration tests** for 3 previously uncovered handlers in `server.test.ts`.

### `node.update-props` (5 tests)
- Success with updated/removed props
- Dry-run mode
- Variant passthrough
- Warnings inclusion
- Error handling

### `node.apply-pattern` (5 tests)
- Success with node creation
- Customisations/position passthrough
- Pattern-not-found error response
- Warnings inclusion
- Thrown error handling

### `inspect.capture-screenshot` (6 tests)
- Success with image + metadata response
- Missing componentUuid
- Component not found
- No dev host URL
- No template tree
- captureScreenshot failure

### Test infrastructure additions
- Mock declarations, initializations, and `doMock` registrations for: `updateProps` (edit-tools), `captureScreenshot` (headless-canvas), `applyPattern` (patterns/applier), `listPatternsMeta` (patterns/registry)

Status: **COMPLETE**
