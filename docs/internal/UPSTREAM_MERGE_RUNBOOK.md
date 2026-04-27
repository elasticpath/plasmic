# Upstream Merge Runbook

A weekly GitHub Action opens a draft PR merging `upstream/master` into our fork. This runbook covers what the human does: resolving conflicts, verifying EP customizations, and deploying.

## Resolving Conflicts

When the automated PR has conflicts, check out the branch and resolve them. For each conflicted file, use this guide.

### Files with EP modifications on top of upstream

These files exist upstream AND have EP-specific code. Merge conflicts here are the most dangerous — you must preserve both upstream changes and EP additions.

**`platform/wab/src/wab/server/AppServer.ts`**

EP additions to preserve:
- Imports: `cmCors`, `cmCorsPreflight`, `isCmOriginAllowed` from `@/wab/server/cm-cors` (~line 39)
- Imports: `projectProvisioningRoutes`, `provisioningRoutes` (~lines 41-42)
- Import: `customEPCCCookieAuth` from `./auth/custom-api-auth` (~line 314)
- Middleware: `app.use(customEPCCCookieAuth)` (~line 577)
- CORS preflight routes: `app.options(...)` with `cmCorsPreflight()` (~lines 709-718)
- Provisioning route registrations: `provisionUser`, `provisionTeam`, `provisionWorkspace`, `grantTeamUserPermissions`, `grantWorkspaceUserPermissions` (~lines 1854-1874)

**`platform/wab/src/wab/server/auth/routes.ts`**

EP addition to preserve:
- Signup invitation gate: `hasPendingPermissionsForEmail` check (~line 186) that rejects signups without pending invitations

**`platform/wab/src/wab/server/routes/teams.ts`**

EP addition to preserve:
- `SKIP_GRANT_REVOKE_EMAILS` bypass (~line 366) that skips email sending when env var is set

**`platform/wab/src/wab/server/db/DbInit.ts`**

EP additions to preserve:
- `ensureDbConnections` import (~line 5)
- EP branding in devflags: `logoImgSrc: "https://developer.elasticpath.com/logo/light.svg"` (~lines 117-123)

**`platform/loader-bundle-env/package.json`**

EP dependency to preserve:
- `"@elasticpath/plasmic-ep-commerce-elastic-path": "^0.0.3"` in dependencies

After editing this file, run `cd platform/loader-bundle-env && yarn install` and commit the updated `yarn.lock`.

**`platform/canvas-packages/package.json`**

EP dependency to preserve:
- `"@elasticpath/plasmic-ep-commerce-elastic-path": "^0.0.3"` in dependencies

### EP-only files (not in upstream)

If upstream somehow conflicts with these, always keep our version entirely:

| File/Directory | Purpose |
|------|---------|
| `platform/wab/src/wab/server/auth/custom-api-auth.ts` | EPCC JWT auth |
| `platform/wab/src/wab/server/cm-cors.ts` | Commerce Manager CORS |
| `platform/wab/src/wab/server/cm-cors.spec.ts` | CORS tests |
| `platform/wab/src/wab/server/routes/provisioning.ts` | Provisioning routes |
| `platform/wab/src/wab/server/routes/project-provisioning.ts` | Project provisioning |
| `plasmicpkgs/commerce-providers/elastic-path/` | EP commerce package |
| `platform/canvas-packages/src/commerce-elastic-path.ts` | Canvas registration |
| `packages/plasmic-mcp/` | MCP server |
| `packages/plasmic-mcp-registry/` | MCP registry |
| `.github/workflows/` | All CI/CD workflows |
| `.github/actions/` | Custom actions |
| `platform/wab/Dockerfile` | Production WAB image |
| `platform/wab/Dockerfile.publish-hostless` | Publish hostless image |
| `platform/wab/Dockerfile.bootstrap` | DB bootstrap image |

### Playwright test modifications

These tests are skipped or modified for EP. If upstream changes them, keep our modifications:

| File | What we changed |
|------|----------------|
| `playwright/e2e/signup.spec.ts` | Skipped — EP disabled public signup |
| `playwright/e2e/plexus-installation.spec.ts` | Skipped — global devflags conflict |
| `playwright/e2e/comments-multiplayer.spec.ts` | Skipped — WebSocket flaky in CI |
| `playwright/e2e/multiplayer-cursor.spec.ts` | Skipped — WebSocket flaky in CI |
| `playwright/playwright.config.ts` | Workers: 4, navigationTimeout: 30s, timeout: 600s |

### yarn.lock files

Never manually merge `yarn.lock`. After resolving `package.json` conflicts:
```bash
# Accept either version of the lockfile, then regenerate
git checkout --theirs platform/loader-bundle-env/yarn.lock
cd platform/loader-bundle-env && yarn install
git add yarn.lock
```

Repeat for any other workspace with lockfile conflicts (root `yarn.lock`, etc.).

## Verifying the Merge

After resolving all conflicts, before pushing:

```bash
# 1. EP integrity tests (~1 second)
cd platform/wab
NODE_OPTIONS='--max-old-space-size=8192' npx jest --runInBand --forceExit \
  --testPathPattern='ep-fork-integrity' --no-coverage

# 2. Quick compile check (~2 min, catches broken imports)
npx tsc --noEmit

# 3. Tests that broke in the April 2026 merge (~3 min)
NODE_OPTIONS='--max-old-space-size=8192' npx jest --runInBand --forceExit \
  --testPathPattern='WebImporter.spec.ts|cm-cors.spec.ts' --no-coverage
```

If any of these fail, the conflict resolution dropped something. Fix before pushing.

After pushing, CI runs the full suite. The EP integrity tests also run as a standalone fast job that gives signal within 2 minutes.

## Database Migrations

### TypeORM schema migrations
Run automatically at container startup. No manual action needed. Verify by checking the WAB service logs after deployment for `No migrations are pending` or `X migrations executed`.

### Dev bundle migrations (local development only)
After merging, update your local dev bundles:
```bash
cd platform/wab
yarn migrate-dev-bundles
```
This transforms the JSON bundle format in your local DB to match the new code. Safe — only modifies bundle JSON, not users/projects/workspaces.

### publish-hostless (per environment, post-deploy)
Re-publishes built-in component libraries with the new bundle format. Must run after deploying new WAB images.

- **Integration**: GitHub Actions > "Publish Hostless Packages" > Run workflow > select `integration`
- **Prod**: Update `container_image` in `services/publish-hostless/config/{prod-eu,prod-us}.tfvars` in plasmic-terraservices, merge to trigger the GitLab pipeline

## Deployment Checklist

After the merge PR is approved and merged to master:

1. Docker image builds automatically (`deploy-integration.yml` triggers on push to master)
2. GitLab deploys to integration automatically (triggered by step 1)
3. Verify integration: Studio loads, projects save, EP commerce components render
4. Run publish-hostless for integration (GitHub Actions)
5. Promote to prod: merge `main → prod` MR in plasmic-terraservices
6. Run publish-hostless for prod (update tfvars in terraservices)
7. Verify prod: spot-check Studio and EP commerce on both regions

## EP Customization Registry

For maintaining these tests, the full list of EP-specific customizations is checked by `platform/wab/src/wab/server/__tests__/ep-fork-integrity.spec.ts`. When adding a new EP customization:

1. Add the file/dependency
2. Add a test for it in `ep-fork-integrity.spec.ts`
3. Add an entry to the "Resolving Conflicts" section above if it modifies an upstream file

## Per-merge playbooks

When a merge needs more than the generic guidance above, capture the specific resolution as a playbook in `docs/internal/merges/` and link it here. Future-you will thank present-you.

- [PR #256 — April 2026 (29 commits, PLA-11988 server queries, migration 255/256/257 ordering)](merges/PR-256-april-2026.md)

## History

| Date | Commits | Issues encountered |
|------|---------|-------------------|
| 2026-04 | 517 | Duplicate function export, ENOSPC in CI, loader-bundle-env dep dropped, WebImporter test corruption, publish-hostless picking wrong container image |
| 2026-04-27 | 29 | Migration 255/256 collision (PR #256 — see playbook); `schemaDrivenForms` devflag removed upstream; data-sources API breaking change |
