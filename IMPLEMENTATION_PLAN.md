# Implementation Plan

Last updated: 2026-02-25

## Project Status Summary

The Plasmic MCP server (`packages/plasmic-mcp/`) provides 29 MCP tools for programmatic Plasmic Studio interaction from Claude Code. Six skill files in `.claude/commands/` orchestrate these tools. All 11 specs are fully implemented.

**Test count:** 359 tests across 14 files (340 Jest + 19 Vitest, all passing, zero skipped).
**Tools:** 29 registered in server.ts (read, write, batch, undo, save, refresh, list-variants, rename, metadata, preview, delete).
**Skills:** 6 files (router, inspect, edit, create-page, create-component, patterns).
**Specs:** 11 total (all complete).

---

## All Completed Work

### P0.1: Real Integration Tests with Vitest — DONE
### P1.1: ComponentElement Support in `add-child` — DONE
### P1.2: Variant-Aware Editing — DONE
### P2.1: Page/Component Management Tools — DONE

**Status:** All acceptance criteria met. 5 new tools implemented with 34 new tests.

**What was implemented:**
- `edit-tools.ts` — Added `renameComponent()` using `TplMgr.renameComponent()` for name deduplication. Added `updatePageMeta()` for SEO metadata mutations. Added `deleteComponent()` with `findReferencingComponents()` safety guard.
- `server.ts` — Registered 5 new tools: `rename-component`, `update-page-meta`, `get-page-meta`, `get-preview-url`, `delete-component`. Read-only tools (`get-page-meta`, `get-preview-url`) implemented inline; mutation tools delegate to edit-tools.ts.
- `wab.d.ts` — Added `TplMgr.renameComponent()` and `TplMgr.removeComponent()` type declarations.
- `types.ts` — Added `PageMetaInfo` interface for `get-page-meta` response.
- `__mocks__/wab-tpl-mgr.ts` — Added `mockRenameComponent` (default: updates `component.name`) and `mockRemoveComponent`.
- Skill files updated: `plasmic.md` (routing for rename, metadata, preview, delete), `plasmic-edit.md` (new tool listings), `plasmic-inspect.md` (`get-page-meta` and `get-preview-url`).

**Tests (34 new):**
- Jest server.test.ts (15): rename-component (4: success, path update, error, Zod validation), update-page-meta (3: partial update, all fields, non-page error), get-page-meta (4: full meta, null fields, non-page, unknown UUID), get-preview-url (3: page URL, non-page, unknown UUID), delete-component (3: success, force flag, reference error).
- Jest edit-tools.test.ts (19): renameComponent (6: basic rename, path update, non-page path ignored, save verification, unknown UUID error, deduplicated name), updatePageMeta (6: title+description, all fields, partial update, non-page error, unknown UUID, save verification), deleteComponent (5: no references, reference guard, force override, unknown UUID, save verification).

**Design decisions:**
- `get-page-meta` extracts text from TemplatedString fields (pageMeta.title/description can be string or TemplatedString).
- `get-preview-url` constructs URLs from `auth.host` + `session.projectId` — no server call needed.
- `rename-component` returns the actual post-deduplication name (may differ from input if auto-deduplicated).
- `delete-component` checks TplComponent references before calling `TplMgr.removeComponent()`. Force flag bypasses the check.

---

## Remaining Work

### P2.2: CI Enhancement for Integration Tests

- `.github/workflows/plasmic-mcp.yml` currently only runs Jest. Now that P0.1 is implemented, CI must also run Vitest integration tests.
- May need to install `platform/wab` dependencies in CI for real WAB module resolution.

### P3.1: Direct Unit Test for `readSubtree` in `tree-reader.test.ts`

`readSubtree` is exported and backs the `get-subtree` tool but has no direct unit test. It's a one-liner delegation to `readTplNode`, so coverage is implicitly there via `readComponentTree` tests. Low risk but technically a gap.

### P3.2: Direct Unit Tests for `sanitizeStyles` Edge Cases

`sanitizeStyles` in `edit-tools.ts` now handles both background consolidation AND CSS shorthand expansion. Tested indirectly via `updateStyles` assertions and integration tests, but specific paths lack direct unit coverage.

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
| `plasmic-integration-tests.md` — Vitest with real WAB modules | Complete | 19 (real-integration.test.ts) |
| `plasmic-component-instances.md` — ComponentElement in add-child | Complete | 6 Jest + 2 Vitest |
| `plasmic-variant-editing.md` — Variant-aware editing | Complete | 19 Jest + 4 Vitest |
| `plasmic-management-tools.md` — Rename, metadata, preview, delete | **Complete** | 34 Jest |

## Implementation Order

1. ~~**P0.1** — Vitest integration tests~~ ✓ DONE
2. ~~**P1.1** — ComponentElement in add-child~~ ✓ DONE
3. ~~**P1.2** — Variant-aware editing~~ ✓ DONE
4. ~~**P2.1** — Management tools~~ ✓ DONE
5. **P3.1–P3.2** — Test coverage gaps (small, can be done opportunistically)
6. **P4.1** — Cosmetic fix (trivial)
