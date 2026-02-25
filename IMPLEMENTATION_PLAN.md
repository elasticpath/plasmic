# Implementation Plan

Last updated: 2026-02-26

## Milestone Status

| Milestone | Status | Notes |
|-----------|--------|-------|
| M1 — Core MCP Server | **Complete** | 7 tools, auth, session, bundling, CI |
| M1 — Skills Layer | **Complete** | /plasmic, /plasmic-create-page, /plasmic-inspect, /plasmic-patterns |
| M2 — Incremental Writes | **Complete** | 9 tools, change tracking, save manager, batch, undo |
| M2 — Edit Skills | **Complete** | /plasmic-edit, updated /plasmic router |
| M2 — Tests | **Complete** | 210 tests across 13 test files |
| M3 — Context-Efficient Queries | **Complete** | 3 new tools, enhanced get-component-tree, node resolver cache, 246 total tests |
| M3.5 — Integration Tests | **Complete** | 12 tests using real MCP modules with duck-typed Site fixture, 258 total tests |
| M4 — Component Creation & Cloning | **Not started** | No spec yet |
| M5 — E2E Integration Tests | **Not started** | Requires live Plasmic instance |

---

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

## Priority 3 — Integration Tests (spec exists, COMPLETE)

Spec: `specs/plasmic-integration-tests.md`

Integration tests use real MCP modules (model-loader, tree-reader, node-resolver, edit-tools, session, change-tracker, save-manager, batch-manager, undo-manager) against a realistic duck-typed Site fixture. Only `api-client` is mocked. WAB internals remain mocked via jest.config.cjs moduleNameMapper.

- [x] **P3.1** Bundle fixture at `packages/plasmic-mcp/src/__tests__/fixtures/test-site.ts` — 7-node homepage + 3-node header component
- [x] **P3.2** Integration test file at `packages/plasmic-mcp/src/__tests__/integration.test.ts`
- [x] **P3.3** Test: `set-project` → `list-components` → verify real component names/UUIDs
- [x] **P3.4** Test: `get-component-tree` → verify output matches expected node structure
- [x] **P3.5** Test: `get-component-summary` → verify compact output, NO styles/text
- [x] **P3.6** Test: `get-node-details` on named node → full styles/text/attrs
- [x] **P3.7** Test: summary size vs full tree size (summary is ≤60% for small fixture; M3 measured 73-93% for real components)
- [x] **P3.8** Test: `get-component-tree` with `maxDepth:1` → children truncated with childCount
- [x] **P3.9** Test: `update-text` → `get-node-details` → verify new text content
- [x] **P3.10** Test: `update-styles` → `get-node-details` → verify new styles
- [x] **P3.11** Test: `begin-batch` → edits → `end-batch` → verify all changes applied
- [x] **P3.12** Test: edit → verify → `undo` → verify reverted
- [x] **P3.13** Test: node resolution by UUID, name, path all find same node
- [x] **P3.14** Test: `add-child` → verify in tree → `remove-child` → verify gone
- [x] **P3.15** All 258 tests pass (246 existing + 12 integration)

### Remaining: Live E2E Tests (future)

E2E tests against a running Plasmic server are a separate effort requiring environment setup:

- [ ] Create E2E test harness with real HTTP calls (env-gated, skipped without credentials)
- [ ] E2E test: full read/write cycle against a real Plasmic instance
- [ ] CI configuration for optional E2E runs

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
