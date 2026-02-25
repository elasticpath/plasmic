# Integration Tests with Real Bundle Fixture

## Jobs to Be Done

- As a developer, I want integration tests that validate the full MCP tool stack with real Plasmic model data, so that I catch bugs that mocked tests miss (incorrect model traversal, missing fields, tree-reader edge cases).
- As a developer, I want these tests to run fast with no external dependencies (no running server, no network calls), so that they are part of the standard `npm test` suite.

## Architecture

### Current Problem

All 210 existing tests in `packages/plasmic-mcp/src/__tests__/` use mocks. The `server.test.ts` integration tests mock every internal module (model-loader, tree-reader, node-resolver, edit-tools, session, etc.) to isolate server.ts wiring logic. This means:

- No test verifies that `FastBundler.unbundle()` produces a model that `tree-reader.ts` can walk correctly
- No test verifies that `node-resolver.ts` finds real nodes in an unbundled model
- No test verifies that edit tools (`update-text`, `update-styles`, `add-child`, etc.) correctly mutate a real MobX-observed model
- No test verifies that the new `get-component-summary` and `get-node-details` tools (from M3 context-efficient queries) produce correct output from real model data

### Solution: Real Bundle, Mocked HTTP

Integration tests that use the **same InMemoryTransport + MCP Client/Server pattern** as `server.test.ts`, but mock **only the HTTP layer** (`api-client`). Everything else runs for real:

```
MCP Client → InMemoryTransport → Server handler → model-loader (real FastBundler.unbundle())
  → tree-reader (real Tpl traversal) → node-resolver (real) → edit-tools (real) → response
```

The `api-client` mock returns a real Plasmic bundle fixture for `getProjectBundle()` and accepts saves via `saveRevision()`. This gives us:
- **Real model data**: FastBundler.unbundle() produces a real Site with real TplTag/TplComponent/TplSlot nodes
- **Real tree reading**: tree-reader.ts walks real Tpl structures (not hand-crafted mock objects)
- **Real node resolution**: node-resolver.ts flattens real trees, matches by UUID/name/path
- **Real editing**: edit-tools.ts mutates real MobX-observed models via TplMgr
- **Fast**: No network calls, no running server, runs in ~2-3 seconds

### Bundle Fixture

Use one of the existing Playwright/Cypress bundle fixtures from `platform/wab/cypress/bundles/` (e.g., `state-management.json`). Copy a small fixture into `packages/plasmic-mcp/src/__tests__/fixtures/` for isolation.

The fixture must contain:
- Named nodes at multiple depths (for node-resolver testing)
- Styles on nodes (for summary vs full-detail verification)
- Text content (for update-text testing)
- Multiple children in at least one container (for add/remove/move testing)

If no existing bundle is small enough (<100KB), create a minimal one by exporting from a test project.

### Test File Location

`packages/plasmic-mcp/src/__tests__/integration.test.ts`

Runs as part of the standard `npm test` suite — no separate script needed.

### Mock Pattern

```typescript
// Mock ONLY the HTTP layer — everything else is real
jest.mock("../api-client", () => ({
  PlasmicApiClient: jest.fn(() => ({
    listProjects: jest.fn().mockResolvedValue({
      projects: [{ id: "test-project-id", name: "Test Project" }],
      perms: [],
    }),
    getProjectBundle: jest.fn().mockResolvedValue(fixtureBundle),
    updateProject: jest.fn().mockResolvedValue({}),
    saveRevision: jest.fn().mockResolvedValue({ revisionNum: 2 }),
  })),
  PlasmicApiError: class PlasmicApiError extends Error {
    constructor(message, statusCode, errorType) {
      super(message);
      this.name = "PlasmicApiError";
      this.statusCode = statusCode;
      this.errorType = errorType;
    }
  },
}));

// Do NOT mock: model-loader, tree-reader, node-resolver, edit-tools,
// session, change-tracker, save-manager, batch-manager, undo-manager
// These all run for real against the unbundled Site model.
```

The fixture bundle JSON must be shaped as a `ProjectBundleResponse`:
```typescript
const fixtureBundle = {
  rev: { data: JSON.stringify(bundleJson), revision: 1 },
  project: { id: "test-project-id", name: "Test Project" },
  depPkgs: [],
  modelVersion: 1,
  hostlessDataVersion: 0,
};
```

## Acceptance Criteria

### Must Have

- [x] Bundle fixture exists at `packages/plasmic-mcp/src/__tests__/fixtures/` containing a realistic Plasmic project bundle
- [x] Integration test file at `packages/plasmic-mcp/src/__tests__/integration.test.ts`
- [x] Only `api-client` is mocked — all other modules (model-loader, tree-reader, node-resolver, edit-tools, session, change-tracker, save-manager, batch-manager, undo-manager) run for real
- [x] Test: `set-project` → `list-components` → verify real component names/UUIDs from bundle
- [x] Test: `get-component-tree` → verify output matches expected node structure from fixture
- [x] Test: `get-component-summary` → verify compact output has uuid/name/childCount, NO styles/text
- [x] Test: `get-node-details` on a named node → verify full styles/text/attrs present
- [x] Test: compare `get-component-summary` size vs `get-component-tree` size → summary ≤20% of full
- [x] Test: `get-component-tree` with `maxDepth: 1` → verify children truncated with childCount
- [x] Test: `update-text` → `get-node-details` → verify new text content
- [x] Test: `update-styles` → `get-node-details` → verify new styles
- [x] Test: `begin-batch` → multiple edits → `end-batch` → verify all changes applied
- [x] Test: edit → verify → `undo` → verify reverted
- [x] Test: node resolution by UUID, by name, by path all find the same node
- [x] All tests run as part of `npm test` (no separate script or env vars required)
- [x] All existing tests continue to pass

### Nice to Have

- [x] Test: `add-child` → verify in tree → `remove-child` → verify gone
- [x] Test: `move-child` → verify new parent → `undo` → verify original position
- [x] Test: `refresh-project` → verify session still valid

## Happy Path

### Integration test run
1. Jest loads `integration.test.ts`
2. `beforeAll`: Creates real MCP server (no mocks except api-client), connects Client via InMemoryTransport
3. Test calls `set-project` → real model-loader fetches fixture → real FastBundler.unbundle() → real Site model in session
4. Test calls `list-components` → real session returns real component list from unbundled Site
5. Test calls `get-component-summary` → real tree-reader walks real Tpl tree in summary mode → compact output
6. Test calls `get-node-details` → real node-resolver finds node → real tree-reader returns full details
7. Test calls `update-text` → real edit-tools mutate real MobX model → real save-manager bundles changes
8. Test calls `get-node-details` again → confirms text changed in the real model
9. Test calls `undo` → real undo-manager reverts the change in the real model
10. All assertions pass, total time ~2-3 seconds

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Bundle fixture is too large (>100KB) | Create a minimal fixture with only essential nodes. Strip unnecessary data from an existing bundle. |
| FastBundler.unbundle() fails on fixture | Bundle may need migration. Use a recently-exported bundle or one from the current codebase version. |
| MobX not initialized before test | model-loader.ts handles this via `initMobx()` — called automatically on first `loadProject()`. |
| Edit tool fails because component tracking not set up | model-loader.ts calls `trackComponentRoot()` and `trackComponentSite()` for all components — this happens automatically. |
| Node not found by name in fixture | Tests must use node names that actually exist in the fixture bundle. Document expected node names in the test file. |
| `saveRevision` mock not recording calls | Mock should track call args so tests can verify incremental save payloads if needed. |

## Out of Scope

- Tests against a running Plasmic server (real HTTP calls)
- Tests that require database setup (`createDatabase`, `createBackend`)
- Tests that require Playwright/browser automation
- Testing the Claude Code skill layer (`.claude/commands/` files)
- Performance benchmarking or load testing
