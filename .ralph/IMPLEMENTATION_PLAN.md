# Implementation Plan

**Last updated:** 2026-03-06
**Branch:** `feat/mcp-gap-fixes`

## Status Summary

| Category | Count |
|----------|-------|
| Completed features | 21 |
| Remaining items | 3 |
| Test files | 42 |
| Test cases (approx.) | 2,090+ |
| Skipped tests | 0 |

**Remaining:** 3 items across 2 priority levels.

---

## Completed (21 items)

| # | Feature | PR / Commit | Tests |
|---|---------|------------|-------|
| 1 | Hostless package discovery (`package-manager.ts`) | PR #163 | 40+ tests (872 lines) |
| 2 | Design guidance (22 design actions, `inspect.list-design-system`, layoutHint) | PR #159 | 2,285 lines |
| 3 | Design pattern library (8 built-in, user-extensible, `patterns/registry.ts` + `applier.ts`) | PR #159 | 823 lines |
| 4 | HTML bridge / WIComponent (intentionally removed) | `62353caab` | N/A |
| 5 | EP Studio lockdown (`ep/dashboard-restriction.ts`, 3 devflags) | PR #168 | 25 unit + 19 E2E |
| 6 | WebSocket live sync (`live-sync.ts`, `socket-client.ts`, `rebase-engine.ts`, `update-queue.ts`) | PR #167 | 426+ lines |
| 7 | WebSocket presence (`presence-manager.ts`, `tool-presence.ts`) | PR #167 | 10,518 lines |
| 8 | Expression safety validation (`edit-tools.ts` lines 117-229, acorn parser) | PR #169 | 14+ tests |
| 9 | Production database bootstrap (`docs/DATABASE_BOOTSTRAP.md`) | PR #164 | docs only |
| 10 | STRAP architecture (8 domain tools, 104 actions, all handlers complete) | multiple | full coverage |
| 11 | MCP registry package (`@elasticpath/plasmic-mcp-registry`, 5 registry readers) | merged | 5 test files |
| 12 | Dev host variant sync (`devhost-sync.ts`, non-fatal failure mode) | merged | 59 tests |
| 13 | Eval harness (runner, scenario loader, 8 graders, visual capture, LLM judge, CLI, 50+ YAML scenarios) | merged | 10 test files |
| 14 | Rebase engine (5-phase incremental rebase with conflict resolution) | PR #167 | 347 lines |
| 15 | Undo manager (push/pop stack, save integration, rollback, MAX_UNDO_DEPTH=50) | merged | 261 lines |
| 16 | Change tracker (ChangeRecorder wrapper, singleton lifecycle) | merged | 116 lines |
| 17 | Update queue (sequential processing, branch filtering, save gating) | PR #167 | 273 lines |
| 18 | Batch manager (atomic transactions, rollback, undo integration) | merged | 200+ lines |
| 19 | Commerce elastic-path package (176 files, 15+ components, 20 test files) | merged | 95%+ complete |
| 20 | Hostless component reachability fix (`bundler-helpers.ts`, `change-tracker.ts` isExternalRef, `edit-tools.ts` verification) | feat/mcp-gap-fixes | 23 tests |
| 21 | Headless canvas screenshot (`headless-canvas.ts`, `inspect.capture-screenshot` action) | feat/mcp-gap-fixes | 32 tests |

---

## P1 — High Priority

### 3. CMS Package Fork (`@ep-plasmic` Scope)

- **Spec:** `docs/EP_PLASMIC_CMS_PACKAGE_FORK.md` (467 lines)
- **Status:** NOT STARTED — all 11 files unchanged, zero `@ep-plasmic` references in codebase
- **Scope:** M (Medium)
- **Dependencies:** Requires `@ep-plasmic` npm org on npmjs.com; must publish npm packages BEFORE deploying platform changes
- **External:** npm org setup, CI publish pipeline

**Problem:** CMS Credentials Provider hardcodes `DEFAULT_HOST = "https://data.plasmic.app"` in both `plasmicpkgs/cms/src/constants.ts` and `plasmicpkgs/plasmic-cms/src/constants.ts`. Self-hosted EP deployments need `https://data.integration.storefront.elasticpath.com`. Latest bundle migration is 256 (`256-wrap-page-meta-og-image-in-ref.ts`).

**Approach (3-part):**
1. Fork `@plasmicpkgs/cms` → `@ep-plasmic/cms` and `@plasmicpkgs/plasmic-cms` → `@ep-plasmic/plasmic-cms` with updated `DEFAULT_HOST`
2. Update platform canvas-packages and loader-bundle-env imports
3. Database bundle migration 257 to rewrite `importPath` in existing projects

**Files to modify (10 existing + 1 new):**

| # | File | Change |
|---|------|--------|
| 1 | `plasmicpkgs/cms/package.json` | name → `@ep-plasmic/cms` |
| 2 | `plasmicpkgs/cms/src/constants.ts` | `DEFAULT_HOST` → EP data URL |
| 3 | `plasmicpkgs/plasmic-cms/package.json` | name → `@ep-plasmic/plasmic-cms`, dep update |
| 4 | `plasmicpkgs/plasmic-cms/src/constants.ts` | `DEFAULT_HOST` → EP data URL |
| 5 | `plasmicpkgs/plasmic-cms/src/components.tsx` | imports → `@ep-plasmic/cms` |
| 6 | `plasmicpkgs/plasmic-cms/src/context.tsx` | imports → `@ep-plasmic/cms` |
| 7 | `plasmicpkgs/plasmic-cms/src/api.ts` | imports → `@ep-plasmic/cms` |
| 8 | `platform/canvas-packages/src/cms.ts` | imports → `@ep-plasmic/cms` |
| 9 | `platform/canvas-packages/src/plasmic-cms.ts` | imports → `@ep-plasmic/plasmic-cms` |
| 10 | `platform/loader-bundle-env/package.json` | deps → `@ep-plasmic` scope |

**New file:**
- `platform/wab/src/wab/server/bundle-migrations/257-migrate-cms-to-ep-plasmic.ts`

**Risk:** Modifies upstream files (unavoidable for fork). Future CMS merges require manual resolution.

---

## P2 — Medium Priority

### 4. Admin SDK and Admin Dashboard UI

- **Specs:** `ADMIN_SDK.md` (506 lines) + `ADMIN_UI_REQUIREMENTS.md` (431 lines)
- **Status:** SDK was implemented in `5a4782d25` then reverted in `be7b9ef63` (~1 hour later). Source files deleted; stale `dist/` remains untracked. No admin UI code exists.
- **Scope:** L (Large) — SDK=M, Dashboard UI=L
- **Dependencies:** None for SDK. UI depends on SDK.

**4a. Re-implement Admin SDK (`packages/plasmic-admin/`)**
- Original implementation (retrievable from git `5a4782d25`): `client.ts` (406 lines), `types.ts` (246 lines), `index.ts` (31 lines), `__tests__/client.test.ts` (635 lines, 43 tests)
- Zero runtime deps (native `fetch()` only)
- Covered: auth (CSRF + session), project CRUD, admin ops (clone/delete/restore/change-owner/revert), workspace CRUD
- **Pre-work:** Investigate why the SDK was reverted (check discussion around `be7b9ef63`)

**4b. Admin Dashboard UI (new package or app)**
- Login page, project list dashboard with CRUD, workspace management, admin panel
- Permission-gated routes (admin email check)
- Complements EP Studio lockdown (lockdown redirects away from Plasmic UI; admin UI provides replacement)

---

### 5. Test Coverage Gaps (Continuous)

- **Status:** Ongoing — address alongside each feature
- **Scope:** M (spread across features)

**Gaps by module:**

| Module | Gap | Deliver With |
|--------|-----|-------------|
| Hostless reachability | ~~Bundler `__ref`/`__xref` classification~~ DONE (23 tests). Remaining: integration test with real WAB bundler for end-to-end `node.add` with hostless component | Standalone |
| Rebase engine | `undoChangesAndResolveConflicts` mock does nothing; no dep pkg unbundle failure test | Standalone |
| Undo manager | No concurrent undo during save test; rollback "CRITICAL" log not verified | Standalone |
| Change tracker | Only lifecycle tests; no mutation capture or `getRecorder()` tests | Standalone |
| Update queue | No enqueue+stop race condition test; no handler exception+concurrent test | Standalone |
| Batch manager | No rollback failure test; no batch-during-rebase test; no bundler state cleanup test | Standalone |
| Cross-module | No rebase+undo+batch integration test; no SaveManager+UpdateQueue+Rebase test | Standalone |
| Screenshot | ~~`headless-canvas.test.ts` to be created~~ DONE (32 tests). Remaining: integration test with real dev host | Standalone |
| Admin SDK | Original 43 tests were reverted | Item 4a |

---

## Implementation Sequence

```
Item 1 (P0, hostless reachability)    ████████████████████████████  DONE
  │
  ├──→ Item 2 (P1, screenshot)       ████████████████████████████  DONE
  │    Delivered: headless-canvas.ts, inspect.capture-screenshot,
  │    32 tests. Approach: tree-reader JSON → React.createElement
  │    in dev host iframe (avoids WAB canvas-rendering bundle).
  │
  └──→ Item 3 (P1, CMS fork)         ░░░░░░░░░░░░░░░░░░░░  blocked on @ep-plasmic npm org
       ├─ Prerequisite: @ep-plasmic npm org
       ├─ 10 files modified + migration 257
       └─ Publish to npm BEFORE platform deploy

Item 4 (P2, admin SDK + UI)          ░░░░░░░░░░░░░░░░░░░░  independent workstream
  ├─ Phase 1: Restore/rewrite SDK from 5a4782d25
  └─ Phase 2: Dashboard UI

Item 5 (P2, test gaps)               ░░░░░░░░░░░░░░░░░░░░  continuous, alongside each item
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bundler public API insufficient for fix | ~~Medium~~ Resolved | ~~High~~ | `addrOf()` public method is sufficient for `isExternalRef` and `ensureDependencyAddresses`. No upstream changes needed. |
| `@ep-plasmic` npm org not available | Low | Blocks Item 3 | Reserve org name early; `@ep-storefront` as fallback |
| Screenshot ViewCtx duck-type insufficient | ~~Medium~~ Resolved | ~~Medium~~ | Avoided entirely: used tree-reader JSON → React.createElement in dev host instead of bundling WAB canvas-rendering.ts. Code components render via `__PlasmicComponentRegistry`. |
| Admin SDK revert reason still relevant | Medium | Medium | Investigate before re-implementing; may need architectural changes |
| CMS fork creates permanent upstream merge burden | High | Medium | Document divergences; automate merge conflict detection |

## Architecture Notes

### Screenshot Renderer (Item 2) — Design Decision

The spec proposed bundling WAB's `canvas-rendering.ts` into a browser IIFE (`headless-renderer-entry.ts`) and calling `renderTplNode()` with a ViewCtx duck-type. Investigation revealed this is impractical: `renderTplNode` depends on `ViewCtx`, `CanvasCtx`, `SubDeps`, `RenderingCtx`, MobX observables, and dozens of WAB client modules — forming a massive transitive dependency tree that cannot be cleanly bundled for browser execution.

**Chosen approach:** Convert the tree-reader's existing JSON output (`TreeNode`) to React elements in-browser using the dev host's own React instance (`window.__Sub.React`). This avoids the entire WAB bundling problem:
- HTML tags → `React.createElement(tag, { style }, children)`
- Code components → looked up in `window.__PlasmicComponentRegistry` → rendered with actual implementations
- Plasmic components (unregistered) → fall back to `<div>` with children
- Slots → rendered as React Fragment

Trade-off: Mixin-inherited styles and variant resolution are not applied (tree-reader reads base variant only). For the agent visual verification use case, this provides sufficient fidelity.
