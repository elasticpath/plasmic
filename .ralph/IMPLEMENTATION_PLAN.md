# Implementation Plan

_Last updated: 2026-03-04_

## Priority 1 — Hostless Package Management ✓ (P1.1–P1.5 complete, 2026-03-04)

**Branch:** `feat/hostless-package-management`
**Status:** All complete. 4 new actions (list-packages, add-package, remove-package, upgrade-package) wired into the project tool. Action count: 104 → 108. All 1,778 tests pass (33 files).

---

## Priority 2 — Documentation & Follow-up

### P2.1 — Documentation sync (action counts 104→108) ✓
- **Completed:** 2026-03-04
- **What:** Updated FEATURE_REFERENCE.md, README.md, and index.ts to reflect the 4 new package management actions (list-packages, add-package, remove-package, upgrade-package) added in P1.4
- **Files modified:** `packages/plasmic-mcp/FEATURE_REFERENCE.md`, `packages/plasmic-mcp/README.md`, `packages/plasmic-mcp/src/index.ts`

---

## Completed Items (previous branch work)

### `project.list` HTTP 500 fix (query param encoding) ✓
- **Completed:** 2026-03-04

### `packages/plasmic-mcp/FEATURE_REFERENCE.md` ✓
- **Completed:** 2026-03-04

### `node.update-props` action ✓
- **Completed:** 2026-03-04

---

## Known Limitations (non-blocking)

| Limitation | Location | Notes |
|-----------|----------|-------|
| Mixin-inherited styles not resolved in inspect output | `tree-reader.ts:14` | MVP limitation — inspect shows only direct VariantSetting styles, not resolved mixin styles |
| Rich text marks cannot combine with dynamic text | `edit-tools.ts:1743` | Use `update-text` with `dynamic:true` instead of `update-rich-text` for dynamic content |
| No interactive/OAuth auth | `auth.ts:6` | Pre-configured credentials only (env vars or `.plasmic.auth` file) |
| `component.create-page/create/clone` don't support dryRun | `server.ts` | Server-side API operations that cannot be previewed |

## Notes

- **Branch context:** `feat/hostless-package-management`
- **Action count:** 108 actions across 8 tools
- **Scope:** This plan is scoped to `packages/plasmic-mcp/` only. EP commerce gaps are tracked separately.
- **Spec:** `.ralph/specs/PROJECT-PACKAGE-MANAGEMENT.md`
- **Key WAB reference:** `platform/wab/src/wab/client/ProjectDependencyManager.ts` — the Studio implementation this feature replicates
- **Build mechanism:** esbuild `build.mjs` already resolves `@/wab/shared/*` to real WAB source files. Unit tests use mocks via Vite aliases. Integration tests use real WAB source.
- **No TODOs/FIXMEs/skipped tests** found in existing `packages/plasmic-mcp/src/`
