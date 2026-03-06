# EP Studio Lockdown

## Overview

Lock down Plasmic Studio so Elastic Path users can only access the Studio editor
(`/projects/:projectId`) and CMS views (`/cms/:databaseId/*`). All other routes —
dashboard, auth, management, settings — redirect to Commerce Manager (CM).

Based on PR #118 (`feat/hide-dashboard-views`) which is open/unmerged. This spec
supersedes that PR with expanded scope and simplified escape hatch.

## Jobs to Be Done

- As an EP user, I want Studio and CMS to feel like native parts of Commerce Manager
  so that I never encounter Plasmic's standalone management UI
- As an EP admin, I want an escape hatch to access Plasmic's full UI when needed for
  debugging or advanced configuration
- As a developer, I want this lockdown configured via devflags so it can be toggled
  per-environment without redeploying

## Configuration (Devflags)

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `hideDashboardViews` | boolean | `false` | Master toggle for EP lockdown mode |
| `dashboardRedirectUrl` | string | `""` | CM URL to redirect locked routes to |
| `adminDashboardOverrideParam` | string | `"adminDashboard"` | Query param name for escape hatch |

### Escape Hatch

Any user (no email domain check) can bypass the lockdown by adding
`?adminDashboard=true` to any URL. This is simplified from PR #118 which required
both the query param AND an admin email domain match.

## Acceptance Criteria

### Route Lockdown

- [ ] `/projects/:projectId` — accessible (Studio editor)
- [ ] `/cms/:databaseId/*` — accessible (CMS views)
- [ ] `/projects` (all projects) — redirects to `dashboardRedirectUrl`
- [ ] `/orgs/:teamId` — redirects to `dashboardRedirectUrl`
- [ ] `/orgs/:teamId/settings` — redirects to `dashboardRedirectUrl`
- [ ] `/settings` — redirects to `dashboardRedirectUrl`
- [ ] `/workspaces/:workspaceId` — redirects to `dashboardRedirectUrl`
- [ ] `/playground` — redirects to `dashboardRedirectUrl`
- [ ] `/` (dashboard root) — redirects to `dashboardRedirectUrl`
- [ ] `/admin/*` — redirects to `dashboardRedirectUrl`

### Auth Page Lockdown

- [ ] `/login` — redirects to `dashboardRedirectUrl`
- [ ] `/signup` — redirects to `dashboardRedirectUrl`
- [ ] `/forgot-password` — redirects to `dashboardRedirectUrl`
- [ ] `/reset-password` — redirects to `dashboardRedirectUrl`
- [ ] `/sso` — redirects to `dashboardRedirectUrl`

### Studio UI Element Lockdown

- [ ] Community links hidden (Slack, Forum) — LeftTabStrip
- [ ] Documentation link hidden — LeftTabStrip
- [ ] Help/support link hidden — LeftTabStrip
- [ ] Splits (A/B testing) tab hidden — LeftTabStrip
- [ ] Duplicate project menu item hidden — TopBar
- [ ] App auth configuration hidden — TopBar
- [ ] Share button hidden — TopBar
- [ ] GitHub panel hidden — PublishFlowDialog
- [ ] Plasmic Hosting panel hidden — PublishFlowDialog
- [ ] Code button visible but customized for EP — TopBar (see below)

### Code Button Customization

- [ ] Code button remains visible (NOT hidden like PR #118)
- [ ] Code panel shows EP-specific integration guidance instead of default Plasmic
      codegen/loader instructions

### Escape Hatch

- [ ] `?adminDashboard=true` on any URL bypasses all route redirects
- [ ] `?adminDashboard=true` restores hidden UI elements in Studio
- [ ] No email domain check required (simplified from PR #118)

### Devflag Configuration

- [ ] `hideDashboardViews: false` by default — no behavior change unless enabled
- [ ] `dashboardRedirectUrl` configurable per environment via devflag override
- [ ] Lockdown only activates when `hideDashboardViews === true`

## Happy Path

1. EP user navigates to `https://studio.ep.com/projects/abc123` from CM
2. Studio editor loads normally — user designs pages, edits components
3. User clicks any navigation that would go to dashboard/settings/projects list
4. Browser redirects to CM (`dashboardRedirectUrl`)
5. Community links, pricing links, and Plasmic-specific UI elements are hidden
6. Code button shows EP integration guidance

## Edge Cases

| Scenario | Expected Behaviour |
|----------|-------------------|
| User manually types `/login` | Redirect to CM |
| User manually types `/projects` (no ID) | Redirect to CM |
| User has `?adminDashboard=true` in URL | Full Plasmic UI accessible |
| `dashboardRedirectUrl` is empty/unset | Redirect to `/` (fallback) |
| `hideDashboardViews` is `false` | Normal Plasmic behavior, no lockdown |
| User navigates `/cms/:dbId` | CMS loads normally |
| Non-logged-in user hits any route | Redirect to CM (not Plasmic login) |
| User bookmarks a Studio project URL | Works — project URLs are not restricted |

## Out of Scope

- Replacing external links with EP-specific documentation URLs (links are hidden
  for now; replacement is a follow-up task)
- CMS-specific access restrictions beyond what routing provides
- Server-side route protection (this is client-side redirect only)

## Notes

### Branding (Already Available)

Custom branding is already supported via the `brands` devflag, keyed by team ID.
Set `brands.YOUR_TEAM_ID.logoImgSrc`, `logoHref`, and `logoTooltip` in the devflag
overrides to apply EP branding. This is consumed in the Studio TopBar, Dashboard
DefaultLayout, and CMS TopBar — no code changes needed.

## Implementation Notes

### File Strategy (Upstream Merge Safety)

Per AGENTS.md, prefer new files over modifying upstream files. PR #118's approach
of an isolated `ep/dashboard-restriction.ts` module is correct.

**New files (zero merge conflict risk):**
- `platform/wab/src/wab/client/ep/dashboard-restriction.ts` — core lockdown logic
- `platform/wab/src/wab/client/ep/dashboard-restriction.spec.ts` — unit tests

**Minimal upstream modifications:**
- `platform/wab/src/wab/shared/devflags.ts` — add 3 devflag defaults (3 lines)
- `platform/wab/src/wab/client/components/root-view.tsx` — add restricted route branch
- `platform/wab/src/wab/client/components/studio/LeftTabStrip.tsx` — swap isWhiteLabelUser → isRestrictedUser
- `platform/wab/src/wab/client/components/top-bar/TopBar.tsx` — swap checks, keep Code button
- `platform/wab/src/wab/client/components/TopFrame/TopBar/PublishFlowDialog.tsx` — swap checks

### Key Difference from PR #118

| Aspect | PR #118 | This Spec |
|--------|---------|-----------|
| Auth pages | Not handled | Redirect to CM |
| Escape hatch | Query param + admin email domain | Query param only |
| Code button | Hidden | Visible, customized for EP |
| External links | Only community links hidden | All Plasmic links hidden |
| Scope | Dashboard routes only | Dashboard + auth + UI elements |
