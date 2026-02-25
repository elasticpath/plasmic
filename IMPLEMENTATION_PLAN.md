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
| M4 — Component Creation & Cloning | **Not started** | No spec yet |
| M5 — E2E Integration Tests | **Not started** | No spec yet |

---

## Priority 1 — Context-Efficient Queries (spec exists, zero implementation)

The current `get-component-tree` returns ~15KB per call. An edit workflow calling it before AND after costs ~30KB per cycle. This is the #1 bottleneck for practical use of the editing skills from Claude Code.

Spec: `specs/plasmic-context-efficient-queries.md`

- [x] **P1.1** Add `childCount` field to `TreeNode` in `types.ts`
- [x] **P1.2** Add `TreeReadOptions` interface to `types.ts` (fields: `maxDepth?`, `excludeStyles?`, `summaryOnly?`)
- [x] **P1.3** Add `readComponentSummary()` to `tree-reader.ts` — compact indented outline (type, tag, name, uuid, childCount per node; no styles/attrs/text); target ~2KB for a 50-node component
- [x] **P1.4** Add `readNodeDetails()` to `tree-reader.ts` — full info for a single resolved node with immediate children as summaries; target ~300B per call
- [x] **P1.5** Register `get-component-summary` tool in `server.ts` — calls `readComponentSummary()`
- [x] **P1.6** Register `get-node-details` tool in `server.ts` — calls `requireSingleNode()` + `readNodeDetails()`
- [x] **P1.7** Register `export-component-tree` tool in `server.ts` — writes full JSON to `/tmp/plasmic-tree-{uuid}.json`, returns file path + compact summary
- [x] **P1.8** Enhance existing `get-component-tree` tool with optional params: `maxDepth`, `excludeStyles`, `summaryOnly` (backward compatible — all optional)
- [x] **P1.9** Add node resolver caching in `node-resolver.ts` — cache flattened node list per component UUID; invalidate on structural changes (`add-child`, `remove-child`, `move-child`, `refresh-project`, `set-project`); text/style edits do NOT invalidate
- [x] **P1.10** Update `/plasmic-edit` skill to use `get-component-summary` + `get-node-details` instead of full tree dumps (summary→drill-down pattern)
- [x] **P1.11** Update `/plasmic-inspect` skill to prefer summary + drill-down over full tree
- [x] **P1.12** Add tests for `readComponentSummary()`, `readNodeDetails()`, node resolver cache, and all 3 new tool handlers (36 new tests, 246 total)
- [x] **P1.13** Verify 80%+ context reduction for a typical edit workflow (measured: 73% single-edit, 85-93% multi-edit sessions)

---

## Priority 2 — Component Creation & Cloning (no spec yet)

Currently only pages can be created. The `UpdateProjectReq` type already supports `newComponents` without a `path` (for non-page components) and `cloneFrom` (for duplicating), but no MCP tools or skills expose these capabilities. Creating reusable components is essential for a scalable page creation workflow.

- [ ] **P2.1** Author spec at `specs/plasmic-component-creation.md`
- [ ] **P2.2** Register `create-component` tool in `server.ts` — same as `create-page` but without `path` parameter (component, not page)
- [ ] **P2.3** Register `clone-component` tool in `server.ts` — uses `cloneFrom` field on `NewComponentReq` to duplicate an existing page or component
- [ ] **P2.4** Create `/plasmic-create-component` skill in `.claude/commands/` — natural language component creation workflow
- [ ] **P2.5** Update `/plasmic` router to route "create component" intents to the new skill
- [ ] **P2.6** Add tests for `create-component` and `clone-component` tool handlers
- [ ] **P2.7** Update `/plasmic-patterns` with common component patterns (not just page sections)

---

## Priority 3 — E2E Integration Tests (no spec yet)

All 210 existing tests use mocks. There are no tests that verify the full workflow against a real self-hosted Plasmic instance. This is noted in `AGENTS.md` as requiring env setup.

- [ ] **P3.1** Author spec at `specs/plasmic-e2e-tests.md` — define test environment requirements, test project setup, CI configuration
- [ ] **P3.2** Create E2E test harness that connects to a real Plasmic instance (env-gated, skipped when credentials unavailable)
- [ ] **P3.3** E2E test: `set-project` → `list-components` → `get-component-tree` (read workflow)
- [ ] **P3.4** E2E test: `create-page` → verify in `list-components` → `get-component-tree` (create workflow)
- [ ] **P3.5** E2E test: `update-text` → `update-styles` → verify changes (edit workflow)
- [ ] **P3.6** E2E test: `begin-batch` → multiple edits → `end-batch` (batch workflow)
- [ ] **P3.7** E2E test: edit → `undo` → verify revert (undo workflow)
- [ ] **P3.8** Update CI workflow to optionally run E2E tests when credentials are available

---

## Priority 4 — Spec Acceptance Criteria Hygiene

All spec files have unchecked acceptance criteria despite M1 and M2 being fully implemented. Update specs to reflect actual status.

- [ ] **P4.1** Update `specs/plasmic-mcp-server.md` — check off all implemented M1 acceptance criteria
- [ ] **P4.2** Update `specs/plasmic-esbuild-bundling.md` — check off all implemented bundling criteria
- [ ] **P4.3** Update `specs/claude-code-skills.md` — check off all implemented M1 skill criteria
- [ ] **P4.4** Update `specs/plasmic-incremental-writes.md` — check off all implemented M2 criteria
- [ ] **P4.5** Update `specs/plasmic-edit-skills.md` — check off all implemented M2 skill criteria

---

## Future Considerations (not yet prioritized)

These items are mentioned in specs as nice-to-haves or future milestones. They are listed here for completeness but are not blocking the primary goal of creating pages from the Claude Code terminal.

- **`save-project` tool** — explicit manual save (spec: `plasmic-incremental-writes.md` nice-to-have)
- **`get-subtree` tool** — subtree extraction with depth limit (spec: `plasmic-context-efficient-queries.md` nice-to-have)
- **Variant-aware editing** — edit non-base variants, responsive breakpoints (mentioned as out of scope in edit skills spec)
- **Style token creation/editing** — currently read-only via `get-tokens`
- **Image asset management** — currently can only reference URLs; no upload/manage capability
- **Multi-level undo improvements** — currently one-level undo per operation
- **Node resolution by CSS selector or content match** — richer node targeting
- **Dry-run mode for edit tools** — preview changes without saving
- **M3 — Real-time collaboration** — socket.io sync (future milestone per MCP server spec)
- **Node resolver cache metrics** — hit/miss rates for performance monitoring
