# Implementation Plan

_Last updated: 2026-03-05_

## Priority 1 — Hostless Package Discovery

**Branch:** `feat/hostless-package-discovery`
**Spec:** `.ralph/specs/HOSTLESS-PACKAGE-DISCOVERY.md`
**Action count impact:** 108 → 110 (+ `list-available-packages`, + `list-package-components`)

### P1.1 — Fix `add-package` / `upgrade-package` crash (gap #22)

**Root cause:** `api-client.ts` sends `?version=latest` as a raw string; the WAB server does `JSON.parse(req.query.version)` → `SyntaxError`. Fix: omit version param when undefined, JSON.stringify when specific.

**Acceptance criteria:**
- [ ] Omit `version` query param when requesting latest
- [ ] JSON-stringify + URI-encode specific version strings
- [ ] New unit tests cover both code paths
- [ ] All existing package-manager tests pass

### P1.2 — `project.list-available-packages` (new action)

**What:** Calls `GET /api/v1/app-config`, extracts `hostLessComponents`, returns installable package catalog with `isInstalled` flags. Filters `hidden: true` by default.

**Acceptance criteria:**
- [ ] Returns array with `name`, `projectId`, `sectionLabel`, `isInstalled`, `items`, `imageUrl`, `codeName`, `codeLink`
- [ ] Hidden packages excluded by default
- [ ] Installed packages marked `isInstalled: true`
- [ ] Registered on `project` tool
- [ ] Unit tests pass

### P1.3 — `project.list-package-components` (gap #23, new action)

**What:** Lists components from installed hostless packages. Optional `packageName` filter.

**Acceptance criteria:**
- [ ] Accepts optional `packageName` filter
- [ ] Each record includes `packageName`, `packageProjectId`, `name`, `displayName`
- [ ] Registered on `project` tool
- [ ] Unit tests pass

### P1.4 — Integration verification

- [ ] All existing package-manager tests still pass
- [ ] `npm test` passes with zero failures

## Files to change

- `packages/plasmic-mcp/src/api-client.ts`
- `packages/plasmic-mcp/src/package-manager.ts`
- `packages/plasmic-mcp/src/types.ts`
- `packages/plasmic-mcp/src/server.ts`
- `packages/plasmic-mcp/src/__tests__/api-client.test.ts`
- `packages/plasmic-mcp/src/__tests__/package-manager.test.ts`
