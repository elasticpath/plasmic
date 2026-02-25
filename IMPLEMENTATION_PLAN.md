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
| M5.5 — Remaining Nice-to-Haves | **Complete** | save-project, content resolution, dry-run, cache metrics, 303 total tests |
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

## Priority 6 — Remaining Nice-to-Have Features (COMPLETE)

Four features from spec nice-to-have lists, plus 20 new tests.

- [x] **P6.1** `save-project` tool — explicit full save via `SaveManager.saveFullBundle()`
- [x] **P6.2** Content-based node resolution — `~text` prefix for case-insensitive text matching in `node-resolver.ts`
- [x] **P6.3** Dry-run mode — `dryRun` param on all 5 edit tools; uses batch+undo to preview without persisting
- [x] **P6.4** Node resolver cache metrics — `getCacheMetrics()` returning hits/misses/hitRate/cachedComponents
- [x] **P6.5** Cache metrics included in `get-node-details` response (`_cache` field)
- [x] **P6.6** Unit tests: 12 node-resolver tests (8 content resolution + 4 cache metrics)
- [x] **P6.7** Unit tests: 8 server.test.ts tests (3 save-project + 4 dry-run + 1 cache metrics)
- [x] **P6.8** Update spec acceptance criteria (2 specs: incremental-writes 3 items, context-efficient-queries 1 item)
- [x] **P6.9** All 303 tests pass (282 → 303, +21 new tests)

---

## Future Considerations (not yet prioritized)

These items are mentioned in specs as nice-to-haves or future milestones. They are listed here for completeness but are not blocking the primary goal of creating pages from the Claude Code terminal.

- **Variant-aware editing** — edit non-base variants, responsive breakpoints (mentioned as out of scope in edit skills spec)
- **Style token creation/editing** — currently read-only via `get-tokens`
- **Image asset management** — currently can only reference URLs; no upload/manage capability
- **M3 — Real-time collaboration** — socket.io sync (future milestone per MCP server spec)
- **M6 — E2E Integration Tests** — requires live Plasmic instance
