# Implementation Plan — EP Studio Lockdown

**Spec:** `.ralph/specs/ep-studio-lockdown.md`
**Branch:** `feat/ep-studio-lockdown`
**Supersedes:** PR #118 (`feat/hide-dashboard-views`) — code is NOT on this branch; relevant pieces will be reimplemented with modifications per the expanded spec.
**Last verified:** 2026-03-05 via source code research

---

## Status Summary

| Task | Status | Priority |
|------|--------|----------|
| 1.1 Devflags | **completed** | P0 (blocker) |
| 1.2 Core module | **completed** | P0 (blocker) |
| 2.1 Dashboard route lockdown | **completed** | P1 |
| 2.2 Auth page lockdown | **completed** | P1 |
| 2.3 Non-logged-in redirect | **completed** | P1 |
| 3.1 LeftTabStrip | **completed** | P2 |
| 3.2 TopBar | **completed** | P2 |
| 3.3 PublishFlowDialog | **completed** | P2 |
| 4.1 Code content URL | **not started** | P3 (config only) |
| 4.2 CodeButton menu filter | **completed** | P2 |
| 5.1 Unit tests | **completed** | P2 |
| 5.2 E2E tests | **not started** | P3 |

---

## Phase 1: Foundation (Devflags + Core Module)

### 1.1 Add devflags to `DEFAULT_DEVFLAGS`

- **File:** `platform/wab/src/wab/shared/devflags.ts`
- **Verified:** `DEFAULT_DEVFLAGS` starts at line 264, extends to line 585. Type is derived via `typeof DEFAULT_DEVFLAGS` at line 589. None of the three flags exist yet.
- **What:** Insert three new flags anywhere in the object (e.g., near the end before line 585):
  ```ts
  hideDashboardViews: false,
  dashboardRedirectUrl: "",
  adminDashboardOverrideParam: "adminDashboard",
  ```
- **Merge risk:** Minimal (3 additive lines).
- **Dependencies:** None.
- **Status:** completed

### 1.2 Create `ep/dashboard-restriction.ts` core module

- **File:** `platform/wab/src/wab/client/ep/dashboard-restriction.ts` (NEW file, zero merge risk)
- **Verified:** The `ep/` directory does NOT exist on this branch. PR #118's implementation exists on `feat/hide-dashboard-views` branch (commit `12574382b`) and can be used as reference — but requires these changes:
  - **Remove `isAdminTeamEmail` check** — PR #118 requires both query param AND admin email domain. Spec requires query param only.
  - **Remove `userEmail` parameter** from `isDashboardRestricted` and `shouldHideForRestrictedUser` signatures (no longer needed without email check).
  - **Add `shouldRedirectAuthRoute`** function (new, not in PR #118).
- **Exports:**
  - `isDashboardRestricted(appConfig, locationSearch): boolean`
  - `redirectToDashboard(appConfig): void`
  - `shouldHideForRestrictedUser(isWhiteLabel, appConfig, locationSearch): boolean`
  - `shouldRedirectAuthRoute(appConfig, pathname, locationSearch, authPatterns): boolean`
- **Dependencies:** 1.1.
- **Status:** completed

---

## Phase 2: Route Lockdown

### 2.1 Dashboard route lockdown in `LoggedInContainer`

- **File:** `platform/wab/src/wab/client/components/root-view.tsx`
- **Verified:** `LoggedInContainer` at line 98. Three routing branches:
  1. `!selfInfo` (line 134) → not logged in → redirects to login
  2. `isWhiteLabeled` (line 140, declared at line 122) → white-label → project route only
  3. Default (line 143) → full dashboard
- **What:** Insert a new branch between `isWhiteLabeled` (line 140) and default (line 143). When `isDashboardRestricted(appCtx.appConfig, location.search)` is true, render `<Switch>` with only:
  1. `projectRoute()` — allows `/projects/:projectId`
  2. CMS route — allows `/cms/:databaseId/*`
  3. Catch-all calling `redirectToDashboard(appCtx.appConfig)` + `<Spinner />`
- **Routes redirected:** `/projects` (list, line 244), `/orgs/:teamId` (line 273), `/orgs/:teamId/settings` (line 322), `/settings` (line 372), `/workspaces/:workspaceId` (line 253), `/playground` (line 249), `/` (root), `/admin/*` (line 378)
- **Merge risk:** Low (additive conditional branch).
- **Dependencies:** 1.1, 1.2.
- **Status:** completed

### 2.2 Auth page lockdown in `Root()`

- **File:** `platform/wab/src/wab/client/components/root-view.tsx`
- **Verified:** `Root()` at line 452. Auth routes in the `contents` callback:
  - `/login` (line 556) — `AuthForm` mode "sign in"
  - `/signup` (line 593) — `AuthForm` mode "sign up"
  - `/sso` (line 609) — `SsoLoginForm`
  - `/forgot-password` (line 636) — `ForgotPasswordForm`
  - `/reset-password` (line 646) — `ResetPasswordForm`
  - `appCtx.appConfig` is available at line 503+ (before auth routes render)
- **What:** Add early check at top of `contents` callback (~line 554). Use `shouldRedirectAuthRoute(appCtx.appConfig, pathname, location.search, authPatterns)` to redirect auth routes to CM. Single `if` block.
- **Edge case:** `appCtx.appConfig` is available even when `selfInfo` is null (devflags fetched via `loadAppCtx`).
- **Merge risk:** Moderate (inserting into `Root()` render path). Keep minimal.
- **Dependencies:** 1.1, 1.2.
- **Status:** not started

### 2.3 Non-logged-in user redirect to CM

- **File:** `platform/wab/src/wab/client/components/root-view.tsx`
- **Verified:** `!selfInfo` branch at line 134 in `LoggedInContainer`. Currently shows project route + redirects other routes to login.
- **What:** When `!selfInfo` and `isDashboardRestricted(appCtx.appConfig, location.search)`, redirect to CM (via `redirectToDashboard`) instead of Plasmic login.
- **Merge risk:** Low (2-3 lines in existing `!selfInfo` branch).
- **Dependencies:** 1.1, 1.2.
- **Status:** not started

---

## Phase 3: Studio UI Element Lockdown

### 3.1 LeftTabStrip — hide community links, docs, help, splits

- **File:** `platform/wab/src/wab/client/components/studio/LeftTabStrip.tsx`
- **Verified line numbers:**
  - `isWhiteLabelUser` declared at line 93
  - Splits tab: `!isWhiteLabelUser` in `cond` at line 234
  - Slack community: `cond: !isWhiteLabelUser` at line 335
  - Forum: `cond: !isWhiteLabelUser` at line 342
  - Documentation: `cond: !isWhiteLabelUser` at line 349
  - Help: `cond: Boolean(studioCtx.siteInfo.teamId) && !isWhiteLabelUser` at line 360
  - No existing references to `shouldHideForRestrictedUser` or `isRestrictedUser`
- **What:** Import `shouldHideForRestrictedUser` from `ep/dashboard-restriction`. Compute `isRestrictedUser = shouldHideForRestrictedUser(isWhiteLabelUser, appCtx.appConfig, location.search)`. Replace `!isWhiteLabelUser` with `!isRestrictedUser` in the 5 conditionals listed above.
- **Dependencies:** 1.2.
- **Status:** not started

### 3.2 TopBar — hide duplicate project, app auth, share; KEEP code button

- **File:** `platform/wab/src/wab/client/components/top-bar/TopBar.tsx`
- **Verified line numbers:**
  - `isWhiteLabelUser` declared at line 67
  - Duplicate project: `if (!isWhiteLabelUser)` at line 91
  - App auth: `!isWhiteLabelUser` at line 120
  - Code button: `studioCtx.contentEditorMode || isWhiteLabelUser` at line 445 — **DO NOT CHANGE** (spec requires Code button visible)
  - Share button: `isWhiteLabelUser` at line 454
  - No existing references to `shouldHideForRestrictedUser` or `isRestrictedUser`
- **What:** Import `shouldHideForRestrictedUser`. Compute `isRestrictedUser`. Replace `isWhiteLabelUser` with `isRestrictedUser` for duplicate project (line 91), app auth (line 120), and share button (line 454). **Leave Code button check at line 445 unchanged.**
- **KEY DIFFERENCE from PR #118:** PR #118 hid the Code button; this spec keeps it visible.
- **Dependencies:** 1.2.
- **Status:** not started

### 3.3 PublishFlowDialog — hide GitHub and Plasmic Hosting

- **File:** `platform/wab/src/wab/client/components/TopFrame/TopBar/PublishFlowDialog.tsx`
- **Verified line numbers:**
  - `isWhiteLabelUser` declared at line 112
  - GitHub panel: `!isWhiteLabelUser` at line 332 (within `addGithubPanel.wrap`)
  - Plasmic Hosting panel: `!isWhiteLabelUser` at line 352 (within `addWebsitePanel.wrap`)
  - No existing references to `shouldHideForRestrictedUser` or `isRestrictedUser`
- **What:** Import `shouldHideForRestrictedUser`. Compute `isRestrictedUser`. Replace `!isWhiteLabelUser` with `!isRestrictedUser` at lines 332 and 352.
- **Dependencies:** 1.2.
- **Status:** not started

---

## Phase 4: Code Button Customization

### 4.1 Code content strategy via devflag `appContentBaseUrl`

- **File:** Devflag configuration (database override, no code change)
- **Verified:** `CodeQuickstartDisplay.tsx` line 86 loads iframe from `appCtx.appConfig.appContentBaseUrl`. Line 62 uses `appCtx.appConfig.hiddenQuickstartPlatforms` to hide specific framework tabs.
- **What:** Override `appContentBaseUrl` devflag in EP environment to serve EP integration docs. Override `hiddenQuickstartPlatforms` to hide irrelevant framework tabs. Zero code changes needed.
- **Dependencies:** EP content URL must be hosted.
- **Status:** not started

### 4.2 Filter CodeButton menu items for restricted users

- **File:** `platform/wab/src/wab/client/components/top-bar/CodeButton.tsx`
- **Verified line numbers:**
  - "Documentation" → `window.open("https://docs.plasmic.app/learn")` at lines 104-108
  - "Component API explorer" at lines 110-125 (uses `fillRoute(APP_ROUTES.projectDocs, ...)`)
  - "Plasmic on GitHub" → `window.open("https://www.github.com/plasmicapp/plasmic")` at lines 127-134
  - No existing `isWhiteLabelUser` or restriction checks in this file
- **What:** Import `shouldHideForRestrictedUser`. Conditionally hide the three Plasmic-specific menu items for restricted users. Need to pass `appCtx` (from parent via props or context) and `location.search`.
- **Merge risk:** Low.
- **Dependencies:** 1.2.
- **Status:** not started

---

## Phase 5: Tests

### 5.1 Unit tests for `dashboard-restriction.ts`

- **File:** `platform/wab/src/wab/client/ep/dashboard-restriction.spec.ts` (NEW file)
- **Verified:** No test file exists. PR #118 has a 146-line test file on `feat/hide-dashboard-views` that can serve as reference (commit `4a7644663`), but tests must be updated:
  - Remove tests for `isAdminTeamEmail` / email domain check
  - Add tests for simplified query-param-only escape hatch
  - Add tests for `shouldRedirectAuthRoute` (new function)
- **Test cases:**
  - `isDashboardRestricted` — flag on/off behavior
  - `?adminDashboard=true` bypasses without email check
  - Custom override param name via `adminDashboardOverrideParam`
  - `shouldHideForRestrictedUser` — combines white-label + restriction
  - `shouldRedirectAuthRoute` — identifies auth paths, respects escape hatch
  - Edge cases: empty redirect URL, empty search params, missing flag
- **Dependencies:** 1.2.
- **Status:** not started

### 5.2 Playwright E2E tests

- **File:** `platform/wab/playwright/e2e/dashboard-restriction.spec.ts` (NEW file)
- **Verified:** No E2E test exists. Playwright suite at `platform/wab/playwright/` uses config at `playwright.config.ts` (base URL `http://localhost:3003`, chromium, 400s timeout). PR #118 has a 125-line E2E test on `feat/hide-dashboard-views` (commit `788b105a6`) as reference.
- **Test cases:**
  - Dashboard routes redirect when `hideDashboardViews=true`
  - Auth routes (`/login`, `/signup`, `/sso`, `/forgot-password`, `/reset-password`) redirect to CM
  - `/projects/:id` and `/cms/:dbId` remain accessible
  - `?adminDashboard=true` bypasses all redirects (no email check)
  - UI elements hidden in studio (LeftTabStrip, TopBar, PublishFlowDialog)
  - Code button remains visible
  - Non-logged-in user redirects to CM (not Plasmic login)
- **Dependencies:** Phases 1-4.
- **Status:** not started

---

## Implementation Sequence

```
1.1 Devflags ──► 1.2 Core module ──┬─► 2.1 Dashboard route lockdown ──┐
                                    ├─► 2.2 Auth page lockdown ────────┤
                                    ├─► 2.3 Non-logged-in redirect ────┤
                                    ├─► 3.1 LeftTabStrip ──────────────┤
                                    ├─► 3.2 TopBar ────────────────────┤
                                    ├─► 3.3 PublishFlowDialog ─────────┤
                                    ├─► 4.2 CodeButton menu filter ────┤
                                    └─► 5.1 Unit tests ────────────────┤
                                                                       │
                                    4.1 Content URL (config only) ─────┤
                                                                       │
                                                                       └─► 5.2 E2E tests
```

Items 2.1–5.1 are independent of each other (parallelizable) but all depend on 1.1 + 1.2.

## Upstream File Changes Summary

| File | Verified Lines | Risk |
|------|-------|------|
| `devflags.ts` (line 264-585 DEFAULT_DEVFLAGS) | +3 | Minimal |
| `root-view.tsx` (lines 134, 140-143, 554+) | +50 (auth + dashboard + non-auth) | Low-Moderate |
| `LeftTabStrip.tsx` (lines 93, 234, 335, 342, 349, 360) | ~18 (import + swaps) | Low |
| `TopBar.tsx` (lines 67, 91, 120, 454; NOT 445) | ~13 (import + swaps, NOT code button) | Low |
| `PublishFlowDialog.tsx` (lines 112, 332, 352) | ~12 (import + swaps) | Low |
| `CodeButton.tsx` (lines 104-108, 110-125, 127-134) | ~10 (conditional menu items) | Low |

**New files (zero merge risk):** `ep/dashboard-restriction.ts`, `ep/dashboard-restriction.spec.ts`, `playwright/e2e/dashboard-restriction.spec.ts`

## Key Differences from PR #118

| Aspect | PR #118 (`feat/hide-dashboard-views`) | This Spec |
|--------|---------------------------------------|-----------|
| Escape hatch | Query param + `isAdminTeamEmail` email domain check | Query param only (no email check) |
| `isDashboardRestricted` signature | `(appConfig, userEmail, locationSearch)` | `(appConfig, locationSearch)` — no `userEmail` param |
| `shouldHideForRestrictedUser` signature | `(isWhiteLabel, appConfig, userEmail, locationSearch)` | `(isWhiteLabel, appConfig, locationSearch)` — no `userEmail` param |
| Auth pages | Not handled | Redirect to CM via `shouldRedirectAuthRoute` |
| Code button | Hidden (line 445 swapped) | Visible — do NOT touch line 445 |
| CodeButton menu items | Not filtered | Hide "Documentation", "Component API explorer", "Plasmic on GitHub" |
| Non-logged-in user | Not handled | Redirect to CM instead of Plasmic login |

## Reference Material

- **PR #118 branch:** `feat/hide-dashboard-views` (commits `12574382b`, `4a7644663`, `788b105a6`)
- **PR #118 core file:** `platform/wab/src/wab/client/ep/dashboard-restriction.ts` (on that branch)
- **PR #118 tests:** `ep/dashboard-restriction.spec.ts` and `playwright/e2e/dashboard-restriction.spec.ts` (on that branch)
- **Spec:** `.ralph/specs/ep-studio-lockdown.md`
