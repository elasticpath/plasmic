# Implementation Plan

Last updated: 2026-02-25

## Milestone Status

| Milestone | Status | Notes |
|-----------|--------|-------|
| M1 — Core MCP Server | **Complete** | 7 tools, auth, session, bundling, CI |
| M1 — Skills Layer | **Complete** | /plasmic, /plasmic-create-page, /plasmic-inspect, /plasmic-patterns |
| M2 — Incremental Writes | **Complete** | 9 tools, change tracking, save manager, batch, undo |
| M2 — Edit Skills | **Complete** | /plasmic-edit, updated /plasmic router |
| M2 — Tests | **Complete** | 210 tests across 13 test files |
| M3 — Context-Efficient Queries | **Complete** | 3 new tools, enhanced get-component-tree, node resolver cache, 246 total tests |
| M3.5 — Integration Tests | **Complete** | 16 tests using real MCP modules with duck-typed Site fixture |
| M4 — Component Creation & Cloning | **Complete** | 2 tools, skill file, router updated, 269 total tests |
| M5 — Nice-to-Have Features | **Complete** | get-subtree tool, Zod validation, 282 total tests |
| M6 — E2E Integration Tests | **Not started** | Requires live Plasmic instance |

---

---

## Priority 2 — Component Creation & Cloning (COMPLETE)

Spec: `specs/plasmic-component-creation.md`

---

## Priority 3 — Integration Tests (COMPLETE)

Spec: `specs/plasmic-integration-tests.md`

---

## Priority 4 — Spec Acceptance Criteria Hygiene (COMPLETE)

Updated all 7 spec files to check off implemented acceptance criteria.

- [x] **P4.1** Update `specs/plasmic-mcp-server.md` — all 11 must-have + 2 nice-to-have checked
- [x] **P4.2** Update `specs/plasmic-esbuild-bundling.md` — all 8 criteria checked
- [x] **P4.3** Update `specs/claude-code-skills.md` — all 7 must-have + 3 nice-to-have checked
- [x] **P4.4** Update `specs/plasmic-incremental-writes.md` — all 17 must-have + 1 nice-to-have checked
- [x] **P4.5** Update `specs/plasmic-edit-skills.md` — all 8 criteria checked
- [x] **P4.6** Update `specs/plasmic-context-efficient-queries.md` — all 18 must-have checked
- [x] **P4.7** Update `specs/plasmic-component-creation.md` — all 14 must-have + 2 nice-to-have checked

---

## Priority 5 — Nice-to-Have Features & Test Coverage (COMPLETE)

Three categories of improvements: new tool, input validation, and test coverage.

- [x] **P5.1** Implement `get-subtree` tool in `server.ts` — returns full tree from a specific node downward with optional `maxDepth`
- [x] **P5.2** Add `readSubtree()` function to `tree-reader.ts` (thin wrapper around internal `readTplNode`)
- [x] **P5.3** Add Zod `.min(1)` validation for `create-component` name, `clone-component` name and sourceUuid
- [x] **P5.4** Integration test: `move-child` → verify new parent → `undo` → verify original position
- [x] **P5.5** Integration test: `refresh-project` → verify session still valid, undo stack cleared
- [x] **P5.6** Integration tests for `get-subtree`: full subtree, maxDepth, leaf node, invalid nodeRef
- [x] **P5.7** Unit tests for `get-subtree` in `server.test.ts`: wiring, maxDepth option, errors
- [x] **P5.8** Zod validation tests in `server.test.ts`: empty name/sourceUuid rejected
- [x] **P5.9** Update spec acceptance criteria (3 specs updated)
- [x] **P5.10** Update skill files with `get-subtree` routing
- [x] **P5.11** All 282 tests pass (269 → 282, +13 new tests)

---

## Future Considerations (not yet prioritized)

These items are mentioned in specs as nice-to-haves or future milestones. They are listed here for completeness but are not blocking the primary goal of creating pages from the Claude Code terminal.

- **`save-project` tool** — explicit manual save (spec: `plasmic-incremental-writes.md` nice-to-have)
- **Variant-aware editing** — edit non-base variants, responsive breakpoints (mentioned as out of scope in edit skills spec)
- **Style token creation/editing** — currently read-only via `get-tokens`
- **Image asset management** — currently can only reference URLs; no upload/manage capability
- **~~Multi-level undo~~** — already implemented (undo stack supports multiple operations)
- **Node resolution by CSS selector or content match** — richer node targeting
- **Dry-run mode for edit tools** — preview changes without saving
- **M3 — Real-time collaboration** — socket.io sync (future milestone per MCP server spec)
- **Node resolver cache metrics** — hit/miss rates for performance monitoring
