# Implementation Plan

_Last updated: 2026-03-04_

## Priority 1 — Hostless Package Management ✓ (P1.1–P1.5 complete, 2026-03-04)

**Branch:** `feat/hostless-package-management`
**Status:** All complete. 4 new actions (list-packages, add-package, remove-package, upgrade-package) wired into the project tool. Action count: 104 → 108. All 1,779 tests pass (33 files).

### P1.6 — ensureCanUpgradeDeps pre-check ✓
- **Completed:** 2026-03-04
- **What:** Added `ensureCanUpgradeDeps` pre-flight check to `upgradePackage()` that detects transitive version conflicts before calling `upgradeProjectDeps`. Mirrors Studio's `ProjectDependencyManager.ensureCanUpgradeDeps` BFS-walk logic.
- **Why:** Without this guard, a batch upgrade that creates transitive version conflicts would mutate the site model before detecting the problem. The guard aborts before any mutation.
- **Files modified:** `packages/plasmic-mcp/src/package-manager.ts`, `packages/plasmic-mcp/src/__tests__/package-manager.test.ts`
- **Spec updated:** `.ralph/specs/PROJECT-PACKAGE-MANAGEMENT.md` — all 14 acceptance criteria checked, validation reuse note corrected (client-only class requires local reimplementation)

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
