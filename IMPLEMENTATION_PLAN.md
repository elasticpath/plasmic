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
| P7 — Code Quality & Skill Consistency | **Complete** | ESLint clean, skill files aligned with context-efficient tools |
| M6 — E2E Integration Tests | **Not started** | Requires live Plasmic instance |

---

## Priority 7 — Code Quality & Skill Consistency (COMPLETE)

Fixed lint errors and aligned all skill files with context-efficient query tools (M3).

- [x] **P7.1** Fix 24 ESLint `curly` violations (auto-fixed)
- [x] **P7.2** Fix 4 unused variable errors: `ResolvedNode` import in `edit-tools.ts`, `session` in `server.ts`, `mockWithRecording`/`mergeRecordedChanges` in `batch-manager.test.ts`
- [x] **P7.3** Update `plasmic-create-component.md` — add `get-component-summary`, `get-node-details`, `get-subtree`; full `get-component-tree` signature; add inspection-first workflow step
- [x] **P7.4** Update `plasmic-create-page.md` — add `get-component-summary` and `get-node-details` for inspecting existing components
- [x] **P7.5** Update `plasmic-patterns.md` — change `get-component-tree` reference to prefer `get-component-summary` first
- [x] **P7.6** Add `.playwright-mcp/` to `.gitignore`
- [x] **P7.7** All 303 tests pass, TypeScript clean, ESLint zero errors

---

## Future Considerations (not yet prioritized)

These items are mentioned in specs as nice-to-haves or future milestones. They are listed here for completeness but are not blocking the primary goal of creating pages from the Claude Code terminal.

- **Variant-aware editing** — edit non-base variants, responsive breakpoints (mentioned as out of scope in edit skills spec)
- **Style token creation/editing** — currently read-only via `get-tokens`
- **Image asset management** — currently can only reference URLs; no upload/manage capability
- **M3 — Real-time collaboration** — socket.io sync (future milestone per MCP server spec)
- **M6 — E2E Integration Tests** — requires live Plasmic instance
