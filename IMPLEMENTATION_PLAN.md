# Implementation Plan

## Status Summary

- **Milestone 1 (Read-Only + Basic Write): COMPLETE** — 7 MCP tools, 4 skills, esbuild bundling, CI pipeline
- **Milestone 2 (Incremental Writes + Edit Skills): P0+P1+P2 COMPLETE, P3 NEXT** — P0 foundation + P1 edit tools + P2 workflow tools done with 176 tests; P3 skills layer next

## Milestone 1 — Completed Items

- [x] esbuild bundles `platform/wab/src/wab/shared/` into standalone package (1.3MB, under 2MB target)
- [x] MCP server starts via stdio and registers tools with Claude Code
- [x] Auth via env vars with `.plasmic.auth` file fallback
- [x] Tool: `set-project` — fetch project bundle, unbundle via FastBundler into live model
- [x] Tool: `list-projects` — list accessible projects via HTTP
- [x] Tool: `list-components` — list pages/components from in-memory model
- [x] Tool: `get-component-tree` — read full Tpl tree directly from model (tags, styles, layout, text, images)
- [x] Tool: `get-project-meta` — read project metadata from model
- [x] Tool: `create-page` — create page with PlasmicElement tree via REST API + model reload
- [x] Tool: `get-tokens` — read design tokens with cross-reference resolution
- [x] Model reload after `create-page`
- [x] Skills: `/plasmic`, `/plasmic-create-page`, `/plasmic-inspect`, `/plasmic-patterns`
- [x] `.claude/mcp.json` configured (uses built `dist/index.cjs`)
- [x] CI pipeline: `.github/workflows/plasmic-mcp.yml` (typecheck, test, build, size check)
- [x] Package publishable via npm, runnable via `npx @elasticpath/plasmic-mcp`

### M1 Known Limitations (documented MVP choices, not bugs)
- tree-reader: Mixin-inherited styles not resolved (reads base variant only)
- tree-reader: Dynamic text shows `[dynamic text]` placeholder
- tree-reader: Unknown TplNode types get fallback div
- server.test.ts: Smoke test only (2 tests); individual tool execution not tested end-to-end

---

## Milestone 2 — Prioritized Implementation Tasks

### Upstream Dependencies Verified
All upstream modules exist at `platform/wab/src/wab/shared/`, have zero runtime dependencies on `@/wab/client/` or `@/wab/server/`, and are confirmed bundled via esbuild (verified in dist/meta.json):
- `TplMgr` at `shared/TplMgr.ts` — constructor requires `{ site: Site }` only
- `observeModel()` / `ChangeRecorder` at `shared/core/observable-model.ts`
- `FastBundler.fastBundle()` at `shared/bundler.ts`
- `mkTplTagX()` at `shared/core/tpls.ts`
- `RuleSetHelpers` / `RSH()` at `shared/RuleSetHelpers.ts`
- `undoChanges()` at `shared/core/undo-util.ts`
- `instUtil` singleton at `shared/model/InstUtil.ts`

### P0: Foundation — COMPLETE

- [x] **Extend session state** — Added `revisionNum`, `modelVersion`, `hostlessDataVersion`, `projectUuid` to `Session` interface. Populated from API response during `set-project`.
- [x] **Extend `wab.d.ts` type stubs** — Added TypeScript declarations for all M2 upstream modules: `TplMgr`, `ChangeRecorder`, `observeModel`, `RecordedChanges`, `ModelChange`, `ChangeNode`, `undoChanges`, `mkTplTagX`, `flattenTpls`, `RuleSetHelpers`, `RSH()`, `InstUtil`, `instUtil`. Also added `fastBundle()` and `addrOf()` to `FastBundler`.
- [x] **Verify esbuild bundles M2 modules** — All 6 modules confirmed in `dist/meta.json`. Bundle size 1356 KB (under 2MB).
- [x] **Implement `change-tracker.ts`** — Wraps `ChangeRecorder` from `observable-model.ts` with `instUtil` from `InstUtil.ts`. Module singleton pattern (init/get/dispose). Initialized during `set-project`.
- [x] **Implement `save-manager.ts`** — Calls `fastBundle()` with changed instances, POSTs to `POST /api/v1/projects/{projectId}/revisions/{N+1}`. Handles 412 `ProjectRevisionError` (report conflict, suggest refresh-project) and 412 `UnknownReferencesError` (auto-retry with full bundle). Includes `saveFullBundle()` fallback.
- [x] **Implement `node-resolver.ts`** — Resolves nodes by UUID (exact), name (component-scoped), path (dot-separated suffix), or index (`#N`). Returns `ResolveResult` with ambiguity flag. `requireSingleNode()` helper throws actionable errors.
- [x] **Extend `api-client.ts`** — Added `saveRevision()` method for `POST /api/v1/projects/{projectId}/revisions/{revisionNum}`. Added `PlasmicApiError` class with `statusCode` and `errorType` fields for structured 412 handling.
- [x] **Extend `types.ts`** — Added `SaveRevisionReq` interface. Extended `ProjectBundleResponse` with optional `modelVersion` and `hostlessDataVersion`.
- [x] **Update `server.ts`** — `set-project` now extracts revision tracking fields and initializes change tracker. `create-page` model reload also reinitializes the change tracker.
- [x] **Test mocks for M2 upstream modules** — Added mocks for `observable-model`, `InstUtil`, `tpls`, `RuleSetHelpers`, `undo-util`, `TplMgr`. Updated `wab-bundler` mock with `fastBundle` and `addrOf`. Updated `jest.config.cjs` with 6 new module mappings.
- [x] **Unit tests for P0 modules** — 40 new tests across 3 new test files (node-resolver: 15, change-tracker: 9, save-manager: 12) + updates to session and model-loader tests. Total: 121 tests across 10 files.

### P1: Core Edit Tools — COMPLETE

- [x] **Implement `edit-tools.ts`** — New module with 5 edit operations: `updateText`, `updateStyles`, `addChild`, `removeChild`, `moveChild`. Each resolves nodes via node-resolver, wraps mutations in ChangeRecorder, and saves via SaveManager. Created `plasmicElementToTpl()` helper that converts PlasmicElement JSON to TplTag nodes using `mkTplTagX()` + `TplMgr.ensureBaseVariantSetting()` + `RSH.merge()`. Uses `RawText` and `CustomCode` class constructors from `@/wab/shared/model/classes` for model instance creation.
- [x] **Register 5 edit tools in `server.ts`** — `update-text`, `update-styles`, `add-child`, `remove-child`, `move-child`. Each with Zod input validation, error handling, and structured JSON responses including revision numbers.
- [x] **Unit tests for edit tools** — 27 tests in `edit-tools.test.ts` covering all 5 operations. Total: 148 tests across 11 files.

### P2: Workflow Tools — COMPLETE

- [x] **Implement `batch-manager.ts`** — Batch edit session management with `beginBatch()`, `endBatch()`, `accumulateChanges()`, `cancelBatch()`. Uses `mergeRecordedChanges()` to combine accumulated changes. Batch ID verification on end-batch. Empty batch returns current revision without saving. Entire batch pushed as single undo operation for atomic revert.
- [x] **Implement `undo-manager.ts`** — Operation stack storing `ModelChange[]` per operation with descriptions. `undo()` pops last operation, wraps `undoChanges()` in ChangeRecorder session, saves the reversed state. Multiple sequential undos supported (LIFO). Stack cleared on `refresh-project`. Blocked during active batch sessions.
- [x] **Integrate batch/undo into edit tools** — Added `saveOrAccumulate()` helper to `edit-tools.ts` that routes to batch accumulation or immediate save+undo-push depending on batch state. All 5 edit tools updated to use this helper.
- [x] **Register `begin-batch` tool** — No params, returns batch ID. Requires active project. Error if batch already active.
- [x] **Register `end-batch` tool** — Optional `batchId` param for verification. Saves all accumulated changes in one revision. Returns operation count + revision.
- [x] **Register `undo` tool** — No params. Blocked during batch. Returns description of undone operation + revision + remaining depth.
- [x] **Register `refresh-project` tool** — No params. Cancels active batch, disposes change tracker, clears undo stack, re-fetches and re-loads project. Returns new revision + component/page counts.
- [x] **Fix CLASSES import build error** — Moved `RawText` and `CustomCode` from `classes-metas` (where they don't exist upstream) to direct imports from `classes` module. Updated `wab.d.ts` declarations, `wab-classes` mock, and removed stale `CLASSES` export from `wab-classes-metas` mock. Bundle builds successfully at 1388 KB.
- [x] **Unit tests for batch-manager** — 12 tests: begin/end lifecycle, change accumulation, component IID dedup, batch ID verification, empty batch, error recovery (batch cleared on save failure), undo integration (batch as single undo), cancel batch.
- [x] **Unit tests for undo-manager** — 12 tests: push/pop operations, `undoChanges()` invocation, empty stack error, multiple sequential undos (LIFO), undo-of-undo not pushed, revision increment, stack depth tracking, clear stack.
- [x] **Total: 176 tests across 13 files, 14 MCP tools registered.**

### P3: Skills Layer (prompt orchestration for natural language editing)

- [ ] **Create `.claude/commands/plasmic-edit.md`** — Natural language editing workflow skill. Calls `get-component-tree` before editing, identifies nodes, maps descriptions to tool calls, uses batch for 3+ edits, reports results. Spec: `specs/plasmic-edit-skills.md` § /plasmic-edit
- [ ] **Update `.claude/commands/plasmic.md`** — Add edit intent routing: "change X to Y", "update the heading", "make it bigger" → delegate to `/plasmic-edit`. Add "undo" → call `undo()`, "refresh" → call `refresh-project()`. Spec: `specs/plasmic-edit-skills.md` § /plasmic Updated Router

### P5: Nice-to-Have

- [ ] **`save-project` tool** — Explicit manual save (run fastBundle + POST on demand)
- [ ] **Node resolution by content match** — Find nodes by text content ("the node containing 'Hello'")
- [ ] **Dry-run mode** — Show what would change without persisting
- [ ] **Expand server.test.ts** — Integration-level tests for individual tool execution (currently smoke test only)

---

## Architecture Notes (for future implementers)

### Save Endpoint Discovery
The Plasmic save endpoint is `POST /api/v1/projects/{projectBranchId}/revisions/{revisionNum}` (registered in `platform/wab/src/wab/server/AppServer.ts` line 1619). For main branch, `projectBranchId` = `projectId`. Request body: `{ data, modelVersion, hostlessDataVersion, incremental, toDeleteIids, modifiedComponentIids, modelSchemaHash }`. The `branchId` field is NOT in the body — it's encoded in the URL path as `projectId@branchId`.

### ChangeRecorder vs observeModel
The spec says to use `observeModel()` directly, but `ChangeRecorder` (from the same file) is a higher-level wrapper that provides `withRecording(fn)` with automatic rollback on error. We use `ChangeRecorder` because it's simpler and matches Studio's own pattern. The `_instUtil` parameter requires importing the `instUtil` singleton from `@/wab/shared/model/InstUtil`.

### PlasmicApiError
M2 introduced `PlasmicApiError extends Error` with `statusCode` and `errorType` fields to enable precise 412 handling in save-manager. This is backward-compatible — existing catch blocks and `toThrow()` assertions still match since it extends Error.

### Model Class Constructors
`RawText` and `CustomCode` are imported directly from `@/wab/shared/model/classes` (the generated classes module), NOT from `classes-metas` which only exports the `meta` schema and `modelSchemaHash`. The `classes.ts` file exports both type aliases and concrete class constructors for each model class.

---

## Specs Reference

| Spec | Covers |
|------|--------|
| `specs/plasmic-mcp-server.md` | M1 MCP server architecture, tools, data flow, future vision |
| `specs/plasmic-esbuild-bundling.md` | esbuild config, path aliases, externals, build verification |
| `specs/claude-code-skills.md` | M1 skills: /plasmic, /plasmic-create-page, /plasmic-inspect, /plasmic-patterns |
| `specs/plasmic-incremental-writes.md` | M2 architecture, MobX tracking, fastBundle, save flow, edit tools, node resolution |
| `specs/plasmic-edit-skills.md` | M2 skills: /plasmic-edit, updated /plasmic router |
