# Real Integration Tests — Vitest with Real WAB Modules

## Jobs to Be Done

- As a developer, I want integration tests that exercise the **real WAB model stack** (FastBundler, TplMgr, MobX, ChangeRecorder, tree-reader on real Tpl instances) so that I catch bugs that duck-typed mocked tests miss.
- As a developer, I want these tests to run fast with no external dependencies (no running server, no network calls, no database), so that they are part of the standard `npm test` suite.

## Architecture

### Current Problem

The existing `integration.test.ts` (built by the Ralph loop for M3.5) was intended to test with real WAB internals, but it actually mocks all WAB code via `jest.config.cjs` `moduleNameMapper` — 10 entries redirect `@/wab/shared/*` to duck-typed mock files in `src/__mocks__/`. This means:

- `FastBundler.unbundle()` is mocked — never tests real bundle deserialization
- `isKnownTplTag()` and other type guards are mocked — never tests real model class instances
- `TplMgr` is mocked — never tests real edit operations
- `ChangeRecorder` / MobX observation is mocked — never tests real change tracking
- `tree-reader` receives duck-typed `{ _type: "TplTag" }` objects, not real `TplTag` instances

### Why WAB Mocks Exist

The 10 `moduleNameMapper` entries exist because WAB shared code has transitive imports of browser/platform packages that don't work in Node.js:

| Problematic import | Found in | Impact |
|---|---|---|
| `import defaultReact from "react"` | `core/observable-model.ts:56` | Runtime import — needs stub |
| `import * as Sentry from "@sentry/browser"` | `site-invariants.ts:90` | Runtime import — needs stub |
| `import type { ViewCtx } from "@/wab/client/..."` | `core/tpls.ts:90` | **Type-only** — stripped automatically |
| `import { CSSProperties } from "react"` | `RuleSetHelpers.ts:17`, others | **Type-only** — stripped automatically |
| `require("mobx/dist/mobx.cjs.development.js")` | `import-mobx.ts:6` | Needs alias to `mobx` |

These are all solvable with a small set of stubs. No need to mock the entire WAB codebase.

### Solution: Vitest with Real WAB Source Resolution

Use **Vitest** (already used in `plasmicpkgs/wordpress` and `plasmicpkgs/contentful` in this monorepo, integrated into CI) with Vite's resolver to point `@/*` at **real WAB source files** at `platform/wab/src/`. Stub only browser/client packages.

```
Test file (real-integration.test.ts)
  → vi.stubGlobal("fetch", ...)     ← intercepts HTTP, returns real bundle fixture
  → import { createServer }         ← Vite resolves all @/wab/* to REAL source files
  → InMemoryTransport               ← MCP protocol (from node_modules)
  → client.callTool("set-project")  ← real FastBundler.unbundle(), real MobX, real Site model
  → client.callTool("get-tree")     ← real tree-reader on real TplTag/TplComponent instances
  → client.callTool("update-text")  ← real TplMgr, real ChangeRecorder, real edit-tools
```

Only **2 things** are not real:
1. `global.fetch` — returns a real Plasmic bundle fixture instead of making HTTP calls
2. Browser packages (`react`, `@sentry/browser`) — stubbed with a Proxy

**Why vitest instead of Jest:**
- Vite's resolver natively handles `@/` path aliases + extension resolution (no complex moduleNameMapper regex)
- Native TypeScript support (no `jest-transform-esbuild.js` needed for 173+ WAB source files)
- Native ESM support (plasmic-mcp is `"type": "module"`)
- Already used in the monorepo with CI integration

### Files to Create

1. **`packages/plasmic-mcp/vitest.config.integration.ts`** — Vitest config with Vite resolve aliases:
   - `@/wab/client/*` and `@/wab/server/*` → stub module
   - `@/*` → `../../platform/wab/src/*` (real WAB source)
   - `src/wab/*` → `../../platform/wab/src/wab/*` (malformed imports in WAB code)
   - `react`, `react-dom`, `@sentry/*`, `antd`, `@ant-design/*`, `@plasmicapp/*`, `@plasmicpkgs/*` → stub module
   - `mobx/dist/mobx.cjs.development.js` → `mobx` (alias matching build.mjs)
   - Test config: `include: ["src/__tests__/real-integration.test.ts"]`, `testTimeout: 30000`, `environment: "node"`

2. **`packages/plasmic-mcp/src/__mocks__/stub-module.js`** — Proxy stub (same pattern as `build.mjs` Layer 4):
   ```javascript
   module.exports = new Proxy({}, {
     get: (t, p) => p === '__esModule' ? false : () => {}
   });
   ```

3. **`packages/plasmic-mcp/src/__tests__/real-integration.test.ts`** — Test file using vitest

### Files to Delete

1. **`packages/plasmic-mcp/src/__tests__/integration.test.ts`** — replaced by `real-integration.test.ts`
2. **`packages/plasmic-mcp/src/__tests__/fixtures/test-site.ts`** — duck-typed fixture no longer needed (real bundle fixture used instead)

### Files to Modify

1. **`packages/plasmic-mcp/jest.config.cjs`** — add `testPathIgnorePatterns: ["real-integration"]` so Jest skips the vitest test file
2. **`packages/plasmic-mcp/package.json`** — add `vitest` devDependency (version `3.2.4`, matching `plasmicpkgs/wordpress`), update `test` script to run both Jest unit tests and vitest integration tests:
   ```json
   "test": "jest --config jest.config.cjs && vitest run --config vitest.config.integration.ts",
   "test:unit": "jest --config jest.config.cjs",
   "test:integration": "vitest run --config vitest.config.integration.ts"
   ```

### Bundle Fixture

Use `platform/wab/cypress/bundles/page-replacement.json` (73KB, smallest fixture). Format: `[[projectId, bundleJson]]`.

Mock `global.fetch` to return the fixture wrapped as an API response:
```typescript
vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: any) => {
  const urlStr = String(url);
  // GET project bundle
  if (urlStr.includes("/api/v1/projects/") && opts?.method !== "POST") {
    return new Response(JSON.stringify({
      rev: { data: JSON.stringify(bundleJson), revision: 1 },
      project: { id: projectId, name: "Test Project" },
      depPkgs: [],
      modelVersion: 1,
      hostlessDataVersion: 0,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  // GET list projects
  if (urlStr.includes("/api/v1/projects")) { ... }
  // POST save revision
  if (urlStr.includes("/revisions/") && opts?.method === "POST") { ... }
  // GET CSRF token
  if (urlStr.includes("/api/v1/auth/csrf")) { ... }
  return new Response("Not found", { status: 404 });
}));
```

Set auth env vars before tests:
```typescript
process.env.PLASMIC_AUTH_HOST = "https://test.example.com";
process.env.PLASMIC_AUTH_USER = "test@test.com";
process.env.PLASMIC_AUTH_TOKEN = "test-token";
```

### Key Technical Details

- **MobX initialization**: `model-loader.ts` calls `require("mobx").configure()`. MobX resolves from `node_modules/` — no stub needed.
- **Vite resolver**: Natively tries `.ts`, `.tsx`, `.js`, `/index.ts` extensions — matches `build.mjs`'s `resolveWithExtensions()` behavior automatically.
- **Type-only imports**: `import type { ViewCtx }` in `tpls.ts` and `import { CSSProperties }` in `RuleSetHelpers.ts` are stripped automatically by vitest's TypeScript handling — no special config needed.

## Acceptance Criteria

### Must Have

- [ ] `vitest.config.integration.ts` exists with Vite resolve aliases pointing `@/*` to real WAB source
- [ ] `stub-module.js` exists with Proxy pattern
- [ ] `real-integration.test.ts` exists using vitest (`vi.fn`, `vi.stubGlobal`, `describe`, `it`, `expect`)
- [ ] Only `global.fetch` and browser packages are stubbed — all WAB modules run for real
- [ ] Old `integration.test.ts` and `fixtures/test-site.ts` are deleted
- [ ] Test: `set-project` → `list-components` → verify real component names/UUIDs from the bundle fixture
- [ ] Test: `get-component-tree` → verify output has real UUIDs, styles, text from real TplTag instances
- [ ] Test: `get-component-summary` → verify compact output has uuid/name/childCount, NO styles/text
- [ ] Test: `get-node-details` on a named node → verify full styles/text/attrs present
- [ ] Test: compare `get-component-summary` size vs `get-component-tree` size → summary ≤ 20% of full
- [ ] Test: `get-component-tree` with `maxDepth: 1` → verify children truncated with childCount
- [ ] Test: `update-text` → `get-node-details` → verify new text content
- [ ] Test: `update-styles` → `get-node-details` → verify new styles
- [ ] Test: `begin-batch` → multiple edits → `end-batch` → verify all changes applied
- [ ] Test: edit → verify → `undo` → verify reverted
- [ ] Test: node resolution by UUID, by name, by path all find the same node
- [ ] `npm test` runs both Jest unit tests and vitest integration tests
- [ ] All existing Jest unit tests continue to pass

### Nice to Have

- [ ] Test: `add-child` → verify in tree → `remove-child` → verify gone
- [ ] Test: `move-child` → verify new parent → `undo` → verify original position
- [ ] Test: `refresh-project` → verify session still valid

## Happy Path

### Integration test run
1. Vitest loads `real-integration.test.ts`
2. `beforeAll`: Stubs `global.fetch` with fixture data, sets auth env vars
3. `beforeEach`: Creates real MCP server via `createServer()`, connects Client via InMemoryTransport
4. Test calls `set-project` → real `model-loader` calls mocked `fetch` → real `FastBundler.unbundle()` → real MobX-observed Site model in session
5. Test calls `list-components` → real session returns real component list from unbundled Site
6. Test calls `get-component-summary` → real tree-reader walks real Tpl tree in summary mode → compact output
7. Test calls `get-node-details` → real node-resolver finds node in real model → real tree-reader returns full details
8. Test calls `update-text` → real edit-tools mutate real MobX model → real change-tracker records changes → real save-manager calls mocked `fetch`
9. Test calls `get-node-details` again → confirms text changed in the real model
10. Test calls `undo` → real undo-manager calls `undoChanges()` → reverts change in the real model
11. All assertions pass

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Bundle fixture is too large (>100KB) | Use `page-replacement.json` (73KB). If still too large, strip non-essential data. |
| FastBundler.unbundle() fails on fixture | Bundle may need migration. Use a recently-exported bundle or one from the current codebase version. |
| MobX not initialized before test | model-loader.ts handles this via `initMobx()` — called automatically on first `loadProject()`. |
| Edit tool fails because component tracking not set up | model-loader.ts calls `trackComponentRoot()` and `trackComponentSite()` for all components automatically. |
| Node not found by name in fixture | Tests must use node names that actually exist in the fixture bundle. Discover real names by first running `list-components` and `get-component-tree` and asserting against the actual output. |
| Transitive WAB dependency imports unexpected browser package | Add the package to the stub list in `vitest.config.integration.ts`. The Proxy stub handles any shape. |
| `import-mobx.ts` loads wrong MobX build | The alias `"mobx/dist/mobx.cjs.development.js" → "mobx"` in vitest config handles this (matches build.mjs). |
| fetch mock doesn't handle CSRF flow | Mock must return `{ csrf: "test-csrf" }` for `GET /api/v1/auth/csrf` and accept any POST to `/revisions/`. |

## Out of Scope

- Tests against a running Plasmic server (real HTTP calls)
- Tests that require database setup (`createDatabase`, `createBackend`)
- Tests that require Playwright/browser automation
- Testing the Claude Code skill layer (`.claude/commands/` files)
- Performance benchmarking or load testing
- Modifying existing Jest unit tests or mock files (they remain as-is for fast unit testing)
