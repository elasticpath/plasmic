# Upstream Merge Runbook

## Schedule

Monthly merge from `upstream/master` (plasmicapp/plasmic) into EP fork `master`.

## Pre-Merge: Audit EP Customizations

Before starting any merge, verify these EP-specific files/dependencies are catalogued. If any new EP customizations have been added since the last merge, add them to the checklist below.

### EP Customization Registry

These are the files and dependencies that MUST survive every upstream merge. If a merge conflict resolution drops any of these, projects will break.

#### Critical Dependencies (loader-bundle-env)

| Package | File | Why |
|---------|------|-----|
| `@elasticpath/plasmic-ep-commerce-elastic-path` | `platform/loader-bundle-env/package.json` | Required by loader/codegen to bundle EP commerce components |

#### Critical Source Files (EP-only, not in upstream)

| File | Purpose |
|------|---------|
| `platform/wab/src/wab/server/auth/custom-api-auth.ts` | EPCC JWT auth (cm.elasticpath.com) |
| `platform/wab/src/wab/server/cm-cors.ts` | CORS for Commerce Manager origins |
| `platform/wab/src/wab/server/routes/provisioning.ts` | User/team/workspace provisioning |
| `platform/wab/src/wab/server/routes/project-provisioning.ts` | Project provisioning |
| `plasmicpkgs/commerce-providers/elastic-path/` | EP commerce package (entire directory) |
| `platform/canvas-packages/src/commerce-elastic-path.ts` | Canvas registration of EP components |
| `packages/plasmic-mcp/` | MCP server (entire directory) |
| `packages/plasmic-mcp-registry/` | MCP registry (entire directory) |

#### Modified Upstream Files (EP changes on top of upstream)

These files exist upstream but have EP-specific modifications. Merge conflicts here need careful resolution — take BOTH upstream changes AND EP additions.

| File | EP Modification |
|------|-----------------|
| `platform/wab/src/wab/server/auth/routes.ts` | Signup invitation gate (line ~185) |
| `platform/wab/src/wab/server/AppServer.ts` | Provisioning route registrations, CORS, custom auth |
| `platform/wab/src/wab/shared/ApiSchema.ts` | Provisioning-related types |
| `platform/wab/src/wab/server/db/DbInit.ts` | EP-specific seed data |
| `platform/loader-bundle-env/package.json` | EP commerce dependency |
| `platform/canvas-packages/package.json` | EP commerce registration |

#### CI/CD & Deployment (EP-only, not in upstream)

| File | Purpose |
|------|---------|
| `.github/workflows/tests.yml` | Full test pipeline |
| `.github/workflows/deploy-integration.yml` | Docker build + GitLab trigger |
| `.github/workflows/deploy-frontend.yml` | Frontend SPA deployment |
| `.github/workflows/publish-hostless.yml` | Hostless package publishing |
| `.github/actions/setup-env/action.yml` | Dependency cache setup |
| `platform/wab/Dockerfile` | Production WAB image |
| `platform/wab/Dockerfile.publish-hostless` | Publish hostless task image |
| `platform/wab/Dockerfile.bootstrap` | DB bootstrap image |

#### Playwright Test Modifications

| File | Modification | Reason |
|------|-------------|--------|
| `platform/wab/playwright/e2e/signup.spec.ts` | Skipped | EP disabled public signup |
| `platform/wab/playwright/e2e/plexus-installation.spec.ts` | Skipped | Global devflags conflict |
| `platform/wab/playwright/e2e/comments-multiplayer.spec.ts` | Skipped | WebSocket flaky in CI |
| `platform/wab/playwright/e2e/multiplayer-cursor.spec.ts` | Skipped | WebSocket flaky in CI |
| `platform/wab/playwright/playwright.config.ts` | Modified workers/timeout | CI resource constraints |

## Merge Process

### Step 1: Prepare

```bash
# Fetch upstream
git fetch upstream

# Create merge branch off master
git checkout master && git pull
git checkout -b merge/upstream-$(date +%Y-%m)

# Start the merge
git merge upstream/master
```

### Step 2: Resolve Conflicts

For each conflicted file, check the EP Customization Registry above:

- **EP-only files** (not in upstream): Keep our version entirely
- **Modified upstream files**: Take BOTH upstream changes AND EP additions
- **Upstream-only files**: Take upstream's version
- **package.json / yarn.lock**: Merge carefully, then run `yarn install` to regenerate lockfile

**Common traps:**
- `loader-bundle-env/package.json` — upstream version won't have EP commerce dep. Add it back.
- `AppServer.ts` — EP routes, CORS, auth middleware must be preserved
- `auth/routes.ts` — signup invitation gate must be preserved

### Step 3: Verify EP Customizations Survived

Run the automated check (see "Automated Checks" below):

```bash
yarn test:ep-integrity
```

If any check fails, the merge resolution dropped an EP customization. Fix before proceeding.

### Step 4: Run Tests Locally

```bash
# Unit tests (fast, catches import errors)
cd platform/wab
NODE_OPTIONS='--max-old-space-size=8192' yarn test --runInBand --forceExit

# Specific EP-critical tests
NODE_OPTIONS='--max-old-space-size=8192' npx jest --runInBand --forceExit \
  --testPathPattern='loader.spec.ts|WebImporter.spec.ts'
```

### Step 5: Push and Verify CI

```bash
git push origin merge/upstream-$(date +%Y-%m)
```

Create PR targeting `master`. CI should run:
- WAB tests (4 shards) — all should pass
- WAB Loader HTML tests — should pass  
- E2E tests — expect ~135/137 passing
- SDK + Plasmic Packages tests — should pass

**Do NOT merge until all required checks pass.**

### Step 6: Post-Merge Deployment

After merging to master:

1. **Docker image builds automatically** via `deploy-integration.yml` (triggers on push to master)
2. **GitLab picks up new image** via pipeline trigger and deploys to integration
3. **Verify integration** — check Studio loads, projects save, EP commerce components work
4. **Run publish-hostless** for integration via GitHub Actions
5. **Promote to prod** — merge `main → prod` MR in plasmic-terraservices
6. **Run publish-hostless** for each prod environment

## Automated Checks

### EP Fork Integrity Test

Add this test to `platform/wab/src/wab/server/__tests__/ep-fork-integrity.spec.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";

describe("EP Fork Integrity", () => {
  const repoRoot = path.resolve(__dirname, "../../../../../..");

  describe("loader-bundle-env dependencies", () => {
    const pkgJson = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "platform/loader-bundle-env/package.json"),
        "utf8"
      )
    );

    it("includes EP commerce package", () => {
      expect(
        pkgJson.dependencies["@elasticpath/plasmic-ep-commerce-elastic-path"]
      ).toBeDefined();
    });
  });

  describe("EP-specific source files exist", () => {
    const requiredFiles = [
      "platform/wab/src/wab/server/auth/custom-api-auth.ts",
      "platform/wab/src/wab/server/cm-cors.ts",
      "platform/wab/src/wab/server/routes/provisioning.ts",
      "platform/canvas-packages/src/commerce-elastic-path.ts",
      "plasmicpkgs/commerce-providers/elastic-path/package.json",
    ];

    for (const file of requiredFiles) {
      it(`${file} exists`, () => {
        expect(fs.existsSync(path.join(repoRoot, file))).toBe(true);
      });
    }
  });

  describe("EP auth customizations preserved", () => {
    const authRoutes = fs.readFileSync(
      path.join(
        repoRoot,
        "platform/wab/src/wab/server/auth/routes.ts"
      ),
      "utf8"
    );

    it("has signup invitation gate", () => {
      expect(authRoutes).toContain("hasPendingPermissionsForEmail");
    });
  });
});
```

Add to CI by including in the WAB test run. It's fast (file checks only) and will fail immediately if an upstream merge drops EP customizations.

## Reducing CI Feedback Time

### Current state
- WAB tests: ~10 min (4 shards)
- E2E tests: ~60 min (single job)
- Total: ~70 min before you know if the merge is clean

### Quick local validation (< 5 min)
Before pushing, run:
```bash
# 1. Check EP integrity (instant)
yarn test:ep-integrity

# 2. Compile check (catches import errors, ~2 min)
cd platform/wab && npx tsc --noEmit

# 3. Run the specific tests that broke last time (~3 min)
NODE_OPTIONS='--max-old-space-size=8192' npx jest --runInBand --forceExit \
  --testPathPattern='WebImporter.spec.ts|cm-cors.spec.ts'
```

## Version History

| Date | Upstream Range | Commits | Key Issues |
|------|---------------|---------|------------|
| 2026-04 | 517 commits | PR #201 | Duplicate function export, ENOSPC in CI, loader-bundle-env dep dropped, WebImporter merge corruption |
