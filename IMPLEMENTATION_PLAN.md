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
| M3.5 — Integration Tests | **Complete** | 16 tests using real MCP modules with duck-typed Site fixture |
| M4 — Component Creation & Cloning | **Complete** | 2 tools, skill file, router updated, 269 total tests |
| M5 — E2E Integration Tests | **Not started** | Requires live Plasmic instance |

---

---

## Priority 2 — Component Creation & Cloning (COMPLETE)

Spec: `specs/plasmic-component-creation.md`

Two new MCP tools (`create-component`, `clone-component`) allow creating reusable components and duplicating existing pages/components. Both reload the in-memory model after creation. The `/plasmic-create-component` skill handles both creation and cloning workflows.

- [x] **P2.1** Author spec at `specs/plasmic-component-creation.md`
- [x] **P2.2** Register `create-component` tool in `server.ts` — same as `create-page` but without `path` parameter
- [x] **P2.3** Register `clone-component` tool in `server.ts` — uses `cloneFrom: { uuid }` to deep-clone
- [x] **P2.4** Create `/plasmic-create-component` skill with create and clone instructions
- [x] **P2.5** Update `/plasmic` router with `create-component`/`clone-component` tools and routing rules
- [x] **P2.6** Add tests: 7 unit tests in server.test.ts + 4 integration tests in integration.test.ts (269 total)
- [x] **P2.7** Update `/plasmic-patterns` to reference component creation
- [x] **P2.8** Fix `cloneFrom` type in types.ts (`string` → `{ uuid: string } | { name: string }`)
- [x] **P2.9** Make `body` optional in `NewComponentReq` (not needed for cloning)

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

## Future Considerations (not yet prioritized)

These items are mentioned in specs as nice-to-haves or future milestones. They are listed here for completeness but are not blocking the primary goal of creating pages from the Claude Code terminal.

- **`save-project` tool** — explicit manual save (spec: `plasmic-incremental-writes.md` nice-to-have)
- **`get-subtree` tool** — subtree extraction with depth limit (spec: `plasmic-context-efficient-queries.md` nice-to-have)
- **Variant-aware editing** — edit non-base variants, responsive breakpoints (mentioned as out of scope in edit skills spec)
- **Style token creation/editing** — currently read-only via `get-tokens`
- **Image asset management** — currently can only reference URLs; no upload/manage capability
- **~~Multi-level undo~~** — already implemented (undo stack supports multiple operations)
- **Node resolution by CSS selector or content match** — richer node targeting
- **Dry-run mode for edit tools** — preview changes without saving
- **M3 — Real-time collaboration** — socket.io sync (future milestone per MCP server spec)
- **Node resolver cache metrics** — hit/miss rates for performance monitoring
