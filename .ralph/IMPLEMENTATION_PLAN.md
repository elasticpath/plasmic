# Implementation Plan

_Last updated: 2026-03-04_

## Priority 2 — Admin SDK ✓ (P2.1 complete, 2026-03-04)

**Branch:** `feat/hostless-package-management`
**Package:** `packages/plasmic-admin/` (`@elasticpath/plasmic-admin`)
**Status:** Complete. Standalone HTTP client SDK for Plasmic admin API.

### P2.1 — PlasmicAdminClient SDK ✓
- **Completed:** 2026-03-04
- **What:** New standalone package implementing the full `PlasmicAdminClient` interface from `ADMIN_SDK.md`. Session/cookie auth with CSRF tokens, project CRUD (list, get, getMeta, create, update, updateMeta, delete, clone), workspace CRUD (list, get, getPersonal, create, update, delete), admin operations (adminList, adminClone, adminDelete, adminHardDelete, adminRestore, adminChangeOwner, adminRevert), and supporting endpoints (getCurrentUser, listTeams, getTeam).
- **Why:** The Admin UI (specified in `ADMIN_UI_REQUIREMENTS.md`) needs a clean HTTP client that works in browser environments with session auth. The existing MCP api-client uses token auth and WAB internals — it cannot be used in a browser admin panel.
- **Key design decisions:**
  - Zero runtime dependencies — uses only native `fetch()`
  - Injectable fetch for testing (no real HTTP in unit tests)
  - CSRF-exempt routes properly handled (4 admin routes skip X-CSRF-Token)
  - Session cookie extracted from `set-cookie` headers for Node environments
  - All IDs URL-encoded in path parameters
- **Files created:** `packages/plasmic-admin/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `src/client.ts`, `src/index.ts`, `src/__tests__/client.test.ts`
- **Tests:** 43 tests, all pass. Covers auth flow, every CRUD method, CSRF handling, error handling, URL encoding.
- **Spec:** `ADMIN_SDK.md` (root)

### Next: P2.2 — Admin UI (not yet started)
- **Spec:** `ADMIN_UI_REQUIREMENTS.md` (root)
- **Depends on:** P2.1 (Admin SDK) ✓
- **Scope:** Browser-based admin dashboard using the `PlasmicAdminClient` — login, project list, CRUD operations, workspace management, admin panel

---

## Priority 1 — Hostless Package Management ✓ (P1.1–P1.6 complete, 2026-03-04)

**Branch:** `feat/hostless-package-management`
**Status:** All complete. 4 new actions (list-packages, add-package, remove-package, upgrade-package) wired into the project tool. Action count: 104 → 108.

---

## Known Limitations (non-blocking)

| Limitation | Location | Notes |
|-----------|----------|-------|
| Mixin-inherited styles not resolved in inspect output | `tree-reader.ts:14` | MVP limitation — inspect shows only direct VariantSetting styles, not resolved mixin styles |
| Rich text marks cannot combine with dynamic text | `edit-tools.ts:1743` | Use `update-text` with `dynamic:true` instead of `update-rich-text` for dynamic content |
| No interactive/OAuth auth in MCP | `auth.ts:6` | Pre-configured credentials only (env vars or `.plasmic.auth` file) |
| `component.create-page/create/clone` return explicit dryRun error | `server.ts` | Server-side API operations that cannot be previewed — dryRun returns structured error |

## Notes

- **Branch context:** `feat/hostless-package-management`
- **MCP action count:** 108 actions across 8 tools
- **MCP scope:** `packages/plasmic-mcp/` — specs in `.ralph/specs/`
- **Admin SDK scope:** `packages/plasmic-admin/` — spec in `ADMIN_SDK.md`
- **Admin UI scope:** Not yet started — spec in `ADMIN_UI_REQUIREMENTS.md`
- **No TODOs/FIXMEs/skipped tests** found in `packages/plasmic-mcp/src/` or `packages/plasmic-admin/src/`
