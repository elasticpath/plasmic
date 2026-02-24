# Implementation Plan

## Status Summary

- **Milestone 1 (Read-Only + Basic Write): COMPLETE** — 7 MCP tools, 4 skills, esbuild bundling, CI pipeline
- **Milestone 2 (Incremental Writes + Edit Skills): P0 COMPLETE, P1 NEXT** — P0 foundation (6 items) done with 121 tests; P1 edit tools next

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

### P1: Core Edit Tools (build on P0 foundation) — NEXT

- [ ] **Implement `update-text` tool** — Find TplTag via node-resolver, update base variant's RawText, record change, trigger save. Register in `server.ts`. Params: `componentUuid`, `nodeRef`, `text`. Spec: `specs/plasmic-incremental-writes.md` § update-text
- [ ] **Implement `update-styles` tool** — Find TplTag, update `vsettings[0].rs.values` entries via RuleSetHelpers, record change, trigger save. Params: `componentUuid`, `nodeRef`, `styles` (camelCase CSS object). Spec: `specs/plasmic-incremental-writes.md` § update-styles
- [ ] **Implement `add-child` tool** — Convert PlasmicElement JSON to TplTag via `mkTplTagX()` + `TplMgr.ensureBaseVariantSetting()`, insert into parent's children at position, trigger save. Params: `componentUuid`, `parentRef`, `child` (PlasmicElement), `position`. Spec: `specs/plasmic-incremental-writes.md` § add-child
- [ ] **Implement `remove-child` tool** — Find TplTag, remove from parent's children, record IID for `toDeleteIids`, trigger save. Prevent removal of component root node. Params: `componentUuid`, `nodeRef`. Spec: `specs/plasmic-incremental-writes.md` § remove-child
- [ ] **Implement `move-child` tool** — Remove from current parent, insert into new parent at position. Detect and prevent cycles (moving parent into its own descendant). Params: `componentUuid`, `nodeRef`, `newParentRef`, `position`. Spec: `specs/plasmic-incremental-writes.md` § move-child

### P2: Workflow Tools (enhance editing UX)

- [ ] **Implement `begin-batch` / `end-batch` tools** — `begin-batch`: set flag to suppress auto-save, accumulate changes. `end-batch`: call `fastBundle()` with all accumulated changes, POST once, clear batch state. Error if `end-batch` without active batch. Spec: `specs/plasmic-incremental-writes.md` § begin-batch / end-batch
- [ ] **Implement `undo-manager.ts`** — Operation stack storing `ModelChange[]` per operation. `undo()` pops last operation, calls `undoChanges()` from `core/undo-util.ts`, triggers save. Error when stack empty. Spec: `specs/plasmic-incremental-writes.md` § undo
- [ ] **Implement `undo` tool** — Register in `server.ts`. Delegates to undo-manager. Returns description of what was undone + new revision.
- [ ] **Implement `refresh-project` tool** — Re-fetch project bundle, re-unbundle, replace session state (site, bundler, revision). Re-attach change tracker. Useful after 412 conflict. Spec: `specs/plasmic-incremental-writes.md` § refresh-project

### P3: Skills Layer (prompt orchestration for natural language editing)

- [ ] **Create `.claude/commands/plasmic-edit.md`** — Natural language editing workflow skill. Calls `get-component-tree` before editing, identifies nodes, maps descriptions to tool calls, uses batch for 3+ edits, reports results. Spec: `specs/plasmic-edit-skills.md` § /plasmic-edit
- [ ] **Update `.claude/commands/plasmic.md`** — Add edit intent routing: "change X to Y", "update the heading", "make it bigger" → delegate to `/plasmic-edit`. Add "undo" → call `undo()`, "refresh" → call `refresh-project()`. Spec: `specs/plasmic-edit-skills.md` § /plasmic Updated Router

### P4: Remaining Tests

- [ ] **Unit tests for edit tools** — update-text, update-styles, add-child, remove-child, move-child: happy path + error cases (wrong node type, missing node, cycle detection, root removal)
- [ ] **Unit tests for `undo-manager.ts`** — Push/pop operations; undoChanges invocation; empty stack error
- [ ] **Unit tests for batch tools** — begin/end batch; accumulated save; error on orphaned end-batch

### P5: Nice-to-Have

- [ ] **`save-project` tool** — Explicit manual save (run fastBundle + POST on demand)
- [ ] **Undo stack depth > 1** — Support multiple sequential undos
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

---

## Specs Reference

| Spec | Covers |
|------|--------|
| `specs/plasmic-mcp-server.md` | M1 MCP server architecture, tools, data flow, future vision |
| `specs/plasmic-esbuild-bundling.md` | esbuild config, path aliases, externals, build verification |
| `specs/claude-code-skills.md` | M1 skills: /plasmic, /plasmic-create-page, /plasmic-inspect, /plasmic-patterns |
| `specs/plasmic-incremental-writes.md` | M2 architecture, MobX tracking, fastBundle, save flow, edit tools, node resolution |
| `specs/plasmic-edit-skills.md` | M2 skills: /plasmic-edit, updated /plasmic router |
