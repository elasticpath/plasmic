# Implementation Plan — EP Studio Lockdown

**Spec:** `.ralph/specs/ep-studio-lockdown.md`
**Branch:** `feat/ep-studio-lockdown`

---

## Status Summary

| Task | Status | Priority |
|------|--------|----------|
| 1.1 Devflags | **completed** | P0 |
| 1.2 Core module | **completed** | P0 |
| 2.1 Dashboard route lockdown | **completed** | P1 |
| 2.2 Auth page lockdown | **completed** | P1 |
| 2.3 Non-logged-in redirect | **completed** | P1 |
| 3.1 LeftTabStrip | **completed** | P2 |
| 3.2 TopBar | **completed** | P2 |
| 3.3 PublishFlowDialog | **completed** | P2 |
| 4.1 Code content URL | **not started** | P3 (config only, no code changes) |
| 4.2 CodeButton menu filter | **completed** | P2 |
| 5.1 Unit tests | **completed** | P2 (21 tests pass) |
| 5.2 E2E tests | **completed** | P3 (12 tests) |

---

## Remaining Work

### 4.1 Code content strategy via devflag `appContentBaseUrl`

- **No code changes required.** Override `appContentBaseUrl` and `hiddenQuickstartPlatforms` devflags in EP environment database to serve EP integration docs.
- **Blocked on:** EP content URL must be hosted first.

---

## Completed Implementation Files

**New files (zero merge risk):**
- `platform/wab/src/wab/client/ep/dashboard-restriction.ts` — core lockdown logic
- `platform/wab/src/wab/client/ep/dashboard-restriction.spec.ts` — 21 unit tests
- `platform/wab/playwright/e2e/dashboard-restriction.spec.ts` — 12 E2E tests

**Modified upstream files (minimal changes):**
- `platform/wab/src/wab/shared/devflags.ts` — 3 new flags
- `platform/wab/src/wab/client/components/root-view.tsx` — route lockdown + auth lockdown + non-logged-in redirect
- `platform/wab/src/wab/client/components/studio/LeftTabStrip.tsx` — hide community/docs/help/splits
- `platform/wab/src/wab/client/components/top-bar/TopBar.tsx` — hide duplicate/auth/share (Code button kept visible)
- `platform/wab/src/wab/client/components/TopFrame/TopBar/PublishFlowDialog.tsx` — hide GitHub/Plasmic Hosting
- `platform/wab/src/wab/client/components/top-bar/CodeButton.tsx` — hide Plasmic-specific menu items

## Implementation Notes

- `shouldHideForRestrictedUser` accepts `boolean | null | undefined` for `isWhiteLabel` because `appCtx.isWhiteLabelUser()` returns `boolean | null`.
- E2E tests cover route redirects (dashboard + auth), escape hatch, allowed routes, and non-logged-in behavior. Studio UI element visibility is covered by unit tests only (loading the full Studio in E2E is prohibitively slow).
- All 21 unit tests pass. TypeCheck passes for all modified files.
