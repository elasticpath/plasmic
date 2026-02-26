# Test Restructure by Domain

## Jobs to Be Done
- As a developer, I want tests organized by STRAP domain so that test files match the code architecture and are easy to navigate
- As a developer, I want comprehensive integration tests for every tool action so that real WAB class interactions are verified

## Background

Currently: 619 unit tests across 13 files + 45 integration tests in 1 file = 664 total. Unit tests are organized by internal module (edit-tools, tree-reader, node-resolver, etc.). After STRAP consolidation, the server has 8 domain tools instead of 34 (then 97), and tests should reflect this.

## New Test File Structure

### Unit Tests (mocked WAB)
```
src/__tests__/
  # Domain test files (one per STRAP domain)
  project.test.ts        — project domain actions (set, list, get-meta, save, refresh, batch, undo)
  inspect.test.ts        — inspect domain actions (tree, summary, node, subtree, export, style-properties, preview-url); merged from tree-reader.test.ts
  component.test.ts      — component domain actions (list, create-page, create, clone, rename, delete, convert-to-page, convert-to-component, update-page-meta, list-props, add-prop, update-prop, remove-prop, list-states, add-state, update-state, remove-state)
  node.test.ts           — node domain actions (add, remove, move, clone, reorder, update-styles, update-text, update-rich-text, update-attrs, set-visibility, set-image, apply-mixin, detach-mixin, add-animation, remove-animation)
  variant.test.ts        — variant domain actions (list, create-style, create-group, list-global-groups, create-global-group, add-global, remove-global-group, rename-global)
  design.test.ts         — design domain actions (list-tokens, create-token, update-token, remove-token, duplicate-token, list-mixins, create-mixin, update-mixin, remove-mixin, list-animations, create-animation, update-animation, remove-animation, list-themes, create-theme, update-theme, remove-theme, set-active-theme, list-assets, upload-asset, rename-asset, remove-asset); merged from token-reader.test.ts
  data.test.ts           — data domain actions (set-data-cond, set-data-rep, list-queries, add-query, update-query, remove-query, list-data-tokens, create-data-token, update-data-token, remove-data-token, list-splits, create-split, update-split, remove-split, get-code-meta, list-functions)
  interaction.test.ts    — interaction domain actions (list, add, update, remove)
  # Shared helpers
  test-helpers.ts        — shared helper module (mkSite, mkComponent, mkPage, callTool, etc.)
  # Routing / transport tests (kept as single file)
  server.test.ts         — handler routing tests, already domain-organized; kept as-is
  # Internal utility tests (kept as-is, no STRAP dependency)
  node-resolver.test.ts  — internal utility (cross-domain dependency); kept as-is
  session.test.ts        — session management tests
  batch-manager.test.ts  — batch internal tests
  change-tracker.test.ts — change recorder tests
  undo-manager.test.ts   — undo stack tests
```

### Integration Tests (real WAB)
```
src/__tests__/
  real-integration.test.ts — ALL integration tests, organized by describe blocks matching domains; unchanged
    describe("project actions")
    describe("inspect actions")
    describe("component actions")
    describe("node actions")
    describe("variant actions")
    describe("design actions")
    describe("data actions")
    describe("interaction actions")
```

## Migration Strategy

1. Create new domain test files
2. Move relevant tests from old files, updating tool call syntax: `name: "add-child"` → `name: "node", arguments: { action: "add", ... }`
3. Add new tests for new actions (visibility, interactions, state, etc.)
4. Keep internal module tests untouched (they test functions, not MCP tools)
5. Delete old server.test.ts, edit-tools.test.ts, tree-reader.test.ts, token-reader.test.ts, node-resolver.test.ts (content moved to domain files)

## Acceptance Criteria
- [x] All existing test assertions are preserved (no dropped coverage)
- [x] Tests call new STRAP domain tools with action discriminator
- [x] Every action in every domain has at least 1 unit test and 1 integration test
- [x] New gap features have unit + integration tests
- [x] Internal module tests (api-client, auth, session, batch-manager, etc.) are unchanged
- [x] `npm test` runs all tests (unit + integration)
- [x] Total test count is higher than 664 (now 1116: 998 unit + 118 integration, as of 2026-02-26)
- [x] Test files are < 500 lines each where possible

## Implementation Notes

- **server.test.ts kept as single file**: Its `vi.doMock()` + `InMemoryTransport` setup pattern cannot easily be split across files — `vi.doMock()` must be at file-scope, so all handler routing tests remain together.
- **node-resolver.test.ts kept as internal utility**: The node resolver is a cross-domain dependency used by multiple domains; it is tested independently of any single domain.
- **tree-reader.test.ts merged into inspect.test.ts**: All tree-reading assertions were moved to the inspect domain file, which owns the `tree`, `summary`, `node`, `subtree`, and `export` actions.
- **token-reader.test.ts merged into design.test.ts**: All token/mixin reading assertions were moved to the design domain file.
- **Shared helpers extracted to test-helpers.ts**: `mkSite`, `mkComponent`, `mkPage`, `callTool`, and related fixtures were deduplicated into a single shared module to avoid copy-paste across 8 domain files.
- **Fixed pre-existing convertToPage/convertToComponent bug**: These actions were missing `mockWithRecording` setup in the original tests. Fixed during migration; 20 additional tests were added to improve coverage.
- **Test count**: Went from 1026 (pre-restructure) to 1046 after restructure (+20 tests from improved coverage), then to 1116 (998 unit + 118 integration) as of 2026-02-26 through continued gap-feature and variant-domain work.

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Test that tested multiple old tools | Split into separate tests per domain |
| Integration test that relies on setup from another domain | Use shared setup in beforeAll |
| Flaky test from old suite | Fix during migration, don't carry forward |

## Out of Scope
- Changing vitest configuration (workspace, aliases, etc.)
- Performance benchmarks
- E2E browser tests
