# Implementation Plan

Last updated: 2026-02-25

## Project Status Summary

The Plasmic MCP server (`packages/plasmic-mcp/`) provides 23 MCP tools for programmatic Plasmic Studio interaction from Claude Code. Six skill files in `.claude/commands/` orchestrate these tools. Of 11 total specs, 7 are fully implemented, 1 is 0% implemented, and 3 are newly authored and pending implementation.

**Test count:** ~309 tests across 14 files (all passing, zero skipped).
**Tools:** 23 registered in server.ts (read, write, batch, undo, save, refresh).
**Skills:** 6 files (router, inspect, edit, create-page, create-component, patterns).
**Specs:** 11 total (7 complete, 4 pending implementation).

---

## Priority 0 — Spec Exists, 0% Implemented

### P0.1: Real Integration Tests with Vitest (spec: `plasmic-integration-tests.md`)

The only spec with zero acceptance criteria met. The existing `integration.test.ts` mocks all WAB modules via Jest `moduleNameMapper` (10 entries redirect `@/wab/shared/*` to duck-typed fakes). This means FastBundler, TplMgr, ChangeRecorder, and MobX observation are never tested for real.

**Files to create:**
- `packages/plasmic-mcp/vitest.config.integration.ts` — Vite resolve aliases pointing `@/*` to real WAB source at `platform/wab/src/`
- `packages/plasmic-mcp/src/__mocks__/stub-module.js` — Proxy stub for browser packages (react, @sentry/browser, antd, etc.)
- `packages/plasmic-mcp/src/__tests__/real-integration.test.ts` — Vitest tests using `vi.stubGlobal("fetch", ...)` with real bundle fixture (`platform/wab/cypress/bundles/page-replacement.json`)

**Files to delete:**
- `packages/plasmic-mcp/src/__tests__/integration.test.ts` (mocked version)
- `packages/plasmic-mcp/src/__tests__/fixtures/test-site.ts` (duck-typed fixture)

**Files to modify:**
- `packages/plasmic-mcp/jest.config.cjs` — add `testPathIgnorePatterns: ["real-integration"]`
- `packages/plasmic-mcp/package.json` — add `vitest` devDependency, split `test` script into `test:unit` (Jest) + `test:integration` (Vitest), `test` runs both
- `.github/workflows/plasmic-mcp.yml` — ensure CI runs both test suites

**Must-have tests (15):** set-project → list-components, get-component-tree with real UUIDs, get-component-summary compact output, get-node-details, summary vs tree size ratio, maxDepth truncation, update-text round-trip, update-styles round-trip, batch edit workflow, edit → undo → verify, node resolution by UUID/name/path, npm test runs both suites, existing Jest tests pass.

**Nice-to-have tests (3):** add-child → remove-child, move-child → undo, refresh-project.

---

## Priority 1 — Functional Gaps in Existing Code (Need New Specs)

### P1.1: ComponentElement Support in `add-child` (spec: `plasmic-component-instances.md` — NEW)

`PlasmicElement` union in `types.ts` defines `ComponentElement` (`type: "component"`) and `DefaultComponentElement` (`type: "default-component"`), but `plasmicElementToTpl()` in `edit-tools.ts` silently falls through to `default: tag = "div"` for both types. Component instances requested via `add-child` become empty divs.

Note: `create-page` handles these types correctly because it delegates to the Plasmic server's `elementSchemaToTpl`. Only the local `add-child` path is broken.

**What's needed:**
- Implement `"component"` case in `plasmicElementToTpl()` — look up component by name/UUID in the Site model, create a `TplComponent` node (using `TplMgr.mkTplComponentX()`)
- Implement `"default-component"` case — create a `TplComponent` using the component's registered default slot contents
- Add unit tests for both cases in `edit-tools.test.ts`
- Add integration test: `add-child` with `{ type: "component", name: "ExistingComponent" }` → verify `get-node-details` shows a component instance, not a div
- Update `plasmic-edit.md` skill to document component instance insertion

**Impact:** Without this, users cannot compose pages from reusable components via `add-child`. They can only use HTML primitives (div, text, img, button, input). This significantly limits the page-building workflow.

### P1.2: Variant-Aware Editing (spec: `plasmic-variant-editing.md` — NEW)

All edit tools (`update-text`, `update-styles`) operate exclusively on the base variant. There is no way to:
- Set responsive styles (e.g., mobile breakpoint overrides)
- Set interactive state styles (e.g., hover, focus, pressed)
- Read or create variant groups
- Apply styles to a specific variant

**What's needed:**
- New optional `variant` parameter on `update-text` and `update-styles` tools (backward compatible — omit for base variant)
- New `list-variants` tool to enumerate global and component variant groups
- New `create-variant` / `create-variant-group` tools (stretch goal)
- Variant resolution logic in edit-tools.ts: look up the variant setting for the target variant, create it if missing, apply edits there
- Update `plasmic-edit.md` skill with variant workflow documentation

**Impact:** Without variant editing, all pages are desktop-only with no hover/focus states. Responsive design and interactive components require variant support.

---

## Priority 2 — Missing Workflow Capabilities (Need New Specs)

### P2.1: Page/Component Management Tools (spec: `plasmic-management-tools.md` — NEW)

Five new tools specified. All implemented as client-side model mutations + save (same pattern as update-text/update-styles):

**`rename-component`** — Renames page or component. Uses `TplMgr.renameComponent()` which handles name deduplication. Optional `newPath` for pages.

**`update-page-meta`** — Sets page SEO fields: `title`, `description`, `openGraphImage`, `canonical`, `path`. Mutates `component.pageMeta` fields directly.

**`get-page-meta`** — Reads page metadata including all SEO fields. Currently `get-project-meta` only surfaces `path`.

**`get-preview-url`** — Constructs preview and studio URLs from host + project ID + page path. No server call needed.

**`delete-component`** (lower priority) — Uses `TplMgr.removeComponent()`. Has reference-checking guards (errors if other components reference the target). Server API has no `deleteComponents` field, so this must be a model mutation + save.

**Impact:** Without rename/metadata tools, page management requires manual Studio visits. Without preview URL, developers can't verify changes from the terminal.

### P2.2: CI Enhancement for Integration Tests

- `.github/workflows/plasmic-mcp.yml` currently only runs Jest. Once P0.1 is implemented, CI must also run Vitest integration tests.
- May need to install `platform/wab` dependencies in CI for real WAB module resolution.

---

## Priority 3 — Test Coverage Gaps

### P3.1: Direct Unit Test for `readSubtree` in `tree-reader.test.ts`

`readSubtree` is exported and backs the `get-subtree` tool but has no direct unit test. It's a one-liner delegation to `readTplNode`, so coverage is implicitly there via `readComponentTree` tests. Low risk but technically a gap.

### P3.2: Direct Unit Tests for `sanitizeStyles` Edge Cases

`sanitizeStyles` in `edit-tools.ts` handles background property consolidation. Tested indirectly via `updateStyles` assertions, but these specific paths lack direct coverage:
- `backgroundImage` passed directly → sets `background`
- `background` explicit shorthand overriding `backgroundColor`
- `backgroundSize` / `backgroundRepeat` / `backgroundPosition` being dropped with console.error warning

---

## Priority 4 — Cosmetic

### P4.1: Duplicate Step Numbering in `plasmic-create-component.md`

Line 158 has step `6.` numbered twice. No functional impact.

---

## All Specs (11 total)

| Spec | Status | Tests |
|---|---|---|
| `plasmic-mcp-server.md` — Foundational MCP server, 23 tools | Complete | ~73 (server.test.ts) |
| `plasmic-esbuild-bundling.md` — esbuild bundling of WAB shared code | Complete | Build verified in CI |
| `claude-code-skills.md` — Skill files (router, inspect, create-page) | Complete | N/A (prompt files) |
| `plasmic-edit-skills.md` — `/plasmic-edit` skill for natural language editing | Complete | N/A (prompt file) |
| `plasmic-incremental-writes.md` — 9 edit tools + save + undo | Complete | ~26 + ~12 + ~16 + ~11 |
| `plasmic-component-creation.md` — create-component + clone-component | Complete | 7 (in server.test.ts) |
| `plasmic-context-efficient-queries.md` — Summary/detail tools + caching | Complete | ~34 + ~52 |
| `plasmic-integration-tests.md` — Vitest with real WAB modules | **0% — no criteria met** | 0 |
| `plasmic-component-instances.md` — ComponentElement in add-child | **NEW — 0%** | 0 |
| `plasmic-variant-editing.md` — Variant-aware editing | **NEW — 0%** | 0 |
| `plasmic-management-tools.md` — Rename, metadata, preview, delete | **NEW — 0%** | 0 |

## Implementation Order

1. **P0.1** — Vitest integration tests (spec exists, unblocks validation of all other work)
2. **P1.1** — ComponentElement in add-child (spec authored, critical for real page composition)
3. **P1.2** — Variant-aware editing (spec authored, required for responsive/interactive pages)
4. **P2.1** — Management tools (spec authored — rename, metadata, preview URL, delete)
5. **P3.1–P3.2** — Test coverage gaps (small, can be done opportunistically)
6. **P4.1** — Cosmetic fix (trivial)
