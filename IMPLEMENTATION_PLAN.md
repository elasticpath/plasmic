# Implementation Plan

Last updated: 2026-02-25

## Project Status Summary

The Plasmic MCP server (`packages/plasmic-mcp/`) provides 23 MCP tools for programmatic Plasmic Studio interaction from Claude Code. Six skill files in `.claude/commands/` orchestrate these tools. Of 11 total specs, 9 are fully implemented, and 2 are pending implementation.

**Test count:** 302 tests across 14 files (287 Jest + 15 Vitest, all passing, zero skipped).
**Tools:** 23 registered in server.ts (read, write, batch, undo, save, refresh).
**Skills:** 6 files (router, inspect, edit, create-page, create-component, patterns).
**Specs:** 11 total (9 complete, 2 pending implementation).

---

## Priority 0 — COMPLETE

### P0.1: Real Integration Tests with Vitest (spec: `plasmic-integration-tests.md`) — DONE

**Status:** All acceptance criteria met. 15 Vitest integration tests pass using real WAB modules (13 original + 2 component instance tests).

**What was implemented:**
- `vitest.config.integration.ts` — Vite config with two plugins (`stubWabInternals`, `stubBrowserPackages`) mirroring build.mjs Layer 1-4 resolution strategy. Resolve aliases for `@/` → real WAB source.
- `src/__mocks__/stub-module.js` — Universal Proxy stub for browser packages (react, @sentry, antd, etc.)
- `src/__mocks__/import-mobx-shim.cjs` — Shim replacing `@/wab/shared/import-mobx` to avoid conditional require issue in Vite.
- `src/__tests__/real-integration.test.ts` — 13 tests using real `FastBundler.unbundle()`, `TplMgr`, `ChangeRecorder`, and MobX-observed model instances against `active-screen-variant-group.json` fixture.
- `jest.config.cjs` — `testPathIgnorePatterns: ["real-integration"]`
- `package.json` — `vitest` devDep, split test scripts (`test:unit`, `test:integration`, `test`)

**Tests (13):** set-project → list-components, get-component-tree with real UUIDs, get-component-summary compact output, get-node-details, summary ≤ full tree size, maxDepth truncation, update-text round-trip, update-styles round-trip (with shorthand expansion), batch workflow, undo workflow, node resolution by UUID/name, add-child → remove-child, refresh-project.

**Old mocked files deleted:** `integration.test.ts`, `fixtures/test-site.ts`

**Bugs fixed during implementation:**
1. **`emptyRecordedChanges` called as value instead of function** — `batch-manager.ts` used `{ ...emptyRecordedChanges }` (spreading the function) instead of `emptyRecordedChanges()`. In the real WAB code, `emptyRecordedChanges` is a function, not a const. This caused `existingChanges.changes is not iterable` on the 2nd edit operation. Fixed in `batch-manager.ts`, mock, type declaration, and all test callsites.
2. **CSS shorthand properties rejected by site-invariants** — Plasmic's `isValidStyleProp()` rejects shorthand properties like `padding`, `margin`, `gap`, `borderRadius` because they lack CSS initial values in `css-initials`. Expanded `sanitizeStyles()` in `edit-tools.ts` to convert 9 shorthand families to their longhand equivalents (padding → paddingTop/Right/Bottom/Left, gap → row-gap + column-gap, etc.).
3. **Test isolation: batch/undo state leaking between tests** — `set-project` handler didn't cancel active batches or clear the undo stack. Added `cancelBatch()` and `clearUndoStack()` to the `set-project` tool handler in `server.ts`.
4. **Bundle fixture incompatibility** — `page-replacement.json` lacked the `animations` field on RuleSet (old schema). Switched to `active-screen-variant-group.json` which matches the current model schema.

**Deviation from spec:** Uses `active-screen-variant-group.json` instead of `page-replacement.json` (the spec's fixture is incompatible with the current WAB model schema).

---

## Priority 1 — Functional Gaps in Existing Code

### P1.1: ComponentElement Support in `add-child` (spec: `plasmic-component-instances.md`) — DONE

**Status:** All acceptance criteria met. `add-child` with `{ type: "component" }` and `{ type: "default-component" }` now creates real TplComponent nodes.

**What was implemented:**
- `edit-tools.ts` — Added `"component"` and `"default-component"` cases to `plasmicElementToTpl()`. Components resolved by name or UUID from `site.components` and dependency projects. Uses `mkTplComponentX()` from `@/wab/shared/core/tpls`. Children recursively converted and passed for default slot wiring.
- `edit-tools.ts` — Added `findComponentByNameOrUuid()` helper that searches local + dependency components, throws descriptive error listing available names on not found.
- `wab.d.ts` — Added `MkTplComponentParams` interface and `mkTplComponentX` type declaration.
- `types.ts` — Added `children?: PlasmicElement | PlasmicElement[]` to `ComponentElement` and `DefaultComponentElement` interfaces.
- `__mocks__/wab-tpls.ts` — Added `mockMkTplComponentX` mock for Jest tests.
- `plasmic-edit.md` — Documented component instance insertion syntax in PlasmicElement Reference section.
- `plasmic-patterns.md` — Added slot children example and `add-child` usage note in Referencing Existing Components section.

**Tests (8 new):**
- Jest (6): component by name, component by UUID, unknown component error with available names, default-component by kind, children passed for slot wiring, component from dependency project.
- Vitest (2): add-child with real TplComponent → verify in tree → remove-child, unknown component error message.

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

- `.github/workflows/plasmic-mcp.yml` currently only runs Jest. Now that P0.1 is implemented, CI must also run Vitest integration tests.
- May need to install `platform/wab` dependencies in CI for real WAB module resolution.

---

## Priority 3 — Test Coverage Gaps

### P3.1: Direct Unit Test for `readSubtree` in `tree-reader.test.ts`

`readSubtree` is exported and backs the `get-subtree` tool but has no direct unit test. It's a one-liner delegation to `readTplNode`, so coverage is implicitly there via `readComponentTree` tests. Low risk but technically a gap.

### P3.2: Direct Unit Tests for `sanitizeStyles` Edge Cases

`sanitizeStyles` in `edit-tools.ts` now handles both background consolidation AND CSS shorthand expansion (padding, margin, gap, borderRadius, borderWidth, borderStyle, borderColor, inset). Tested indirectly via `updateStyles` assertions and integration tests, but these specific paths lack direct unit coverage:
- `backgroundImage` passed directly → sets `background`
- `background` explicit shorthand overriding `backgroundColor`
- `backgroundSize` / `backgroundRepeat` / `backgroundPosition` being dropped with console.error warning
- `padding: "10px 20px"` → 2-value expansion (top/bottom vs left/right)
- `borderRadius: "4px 8px 12px 16px"` → 4-value expansion
- `gap: "10px 20px"` → separate row-gap and column-gap
- `inset: "10px"` → top/right/bottom/left

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
| `plasmic-integration-tests.md` — Vitest with real WAB modules | **Complete** | 15 (real-integration.test.ts) |
| `plasmic-component-instances.md` — ComponentElement in add-child | **Complete** | 6 Jest + 2 Vitest |
| `plasmic-variant-editing.md` — Variant-aware editing | **NEW — 0%** | 0 |
| `plasmic-management-tools.md` — Rename, metadata, preview, delete | **NEW — 0%** | 0 |

## Implementation Order

1. ~~**P0.1** — Vitest integration tests~~ ✓ DONE
2. ~~**P1.1** — ComponentElement in add-child~~ ✓ DONE
3. **P1.2** — Variant-aware editing (spec authored, required for responsive/interactive pages)
4. **P2.1** — Management tools (spec authored — rename, metadata, preview URL, delete)
5. **P3.1–P3.2** — Test coverage gaps (small, can be done opportunistically)
6. **P4.1** — Cosmetic fix (trivial)
