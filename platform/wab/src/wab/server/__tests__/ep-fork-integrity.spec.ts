/**
 * EP Fork Integrity Tests
 *
 * These tests verify that Elastic Path-specific customizations survive
 * upstream merges from plasmicapp/plasmic. They run as part of the WAB
 * test suite in CI and catch dropped dependencies, missing files, or
 * removed code before deployment.
 *
 * When adding a new EP customization, add a corresponding test here.
 *
 * See: docs/internal/UPSTREAM_MERGE_RUNBOOK.md
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../../../../..");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function readJson(relativePath: string): any {
  return JSON.parse(readFile(relativePath));
}

describe("EP Fork Integrity", () => {
  describe("loader-bundle-env dependencies", () => {
    const pkgJson = readJson("platform/loader-bundle-env/package.json");

    it("includes @elasticpath/plasmic-ep-commerce-elastic-path", () => {
      expect(
        pkgJson.dependencies["@elasticpath/plasmic-ep-commerce-elastic-path"]
      ).toBeDefined();
    });

    it("includes @plasmicpkgs/commerce (required by EP commerce)", () => {
      expect(pkgJson.dependencies["@plasmicpkgs/commerce"]).toBeDefined();
    });
  });

  describe("canvas-packages registers EP commerce", () => {
    it("commerce-elastic-path registration file exists", () => {
      expect(
        fileExists("platform/canvas-packages/src/commerce-elastic-path.ts")
      ).toBe(true);
    });

    it("canvas-packages package.json includes EP commerce dependency", () => {
      const pkgJson = readJson("platform/canvas-packages/package.json");
      expect(
        pkgJson.dependencies[
          "@elasticpath/plasmic-ep-commerce-elastic-path"
        ] ||
          pkgJson.devDependencies[
            "@elasticpath/plasmic-ep-commerce-elastic-path"
          ]
      ).toBeDefined();
    });
  });

  describe("canvas-packages registers the EP Custom API CMS loader", () => {
    it("ep-custom-api-cms registration file exists", () => {
      expect(
        fileExists("platform/canvas-packages/src/ep-custom-api-cms.ts")
      ).toBe(true);
    });

    it("canvas-packages package.json includes the loader dependency", () => {
      const pkgJson = readJson("platform/canvas-packages/package.json");
      expect(
        pkgJson.dependencies["@elasticpath/plasmic-ep-custom-api-cms"] ||
          pkgJson.devDependencies["@elasticpath/plasmic-ep-custom-api-cms"]
      ).toBeDefined();
    });

    it("hostlessList includes the loader, so a hostless project is created for it", () => {
      const hostlessList: string[] = readJson(
        "platform/canvas-packages/hostlessList.json"
      );
      expect(hostlessList).toContain("ep-custom-api-cms");
    });

    it("hostless metadata maps the loader to its published Elastic Path name", () => {
      // Without this override the seed derives "@plasmicpkgs/ep-custom-api-cms",
      // which is not a package that exists, and generated code imports it.
      const metadata = readFile(
        "platform/wab/src/wab/server/db/seed/hostless-metadata.ts"
      );
      expect(metadata).toContain(
        '"ep-custom-api-cms": "@elasticpath/plasmic-ep-custom-api-cms"'
      );
    });
  });

  describe("EP Custom API CMS loader package exists", () => {
    it("package directory exists", () => {
      expect(fileExists("plasmicpkgs/ep-custom-api-cms/package.json")).toBe(
        true
      );
    });

    it("has correct package name", () => {
      const pkgJson = readJson("plasmicpkgs/ep-custom-api-cms/package.json");
      expect(pkgJson.name).toBe("@elasticpath/plasmic-ep-custom-api-cms");
    });
  });

  describe("EP commerce provider package exists", () => {
    it("elastic-path commerce provider directory exists", () => {
      expect(
        fileExists("plasmicpkgs/commerce-providers/elastic-path/package.json")
      ).toBe(true);
    });

    it("has correct package name", () => {
      const pkgJson = readJson(
        "plasmicpkgs/commerce-providers/elastic-path/package.json"
      );
      expect(pkgJson.name).toBe(
        "@elasticpath/plasmic-ep-commerce-elastic-path"
      );
    });
  });

  describe("EP authentication customizations", () => {
    it("custom EPCC cookie auth exists", () => {
      expect(
        fileExists(
          "platform/wab/src/wab/server/auth/custom-api-auth.ts"
        )
      ).toBe(true);
    });

    it("auth routes contain signup invitation gate", () => {
      const authRoutes = readFile(
        "platform/wab/src/wab/server/auth/routes.ts"
      );
      expect(authRoutes).toContain("hasPendingPermissionsForEmail");
    });
  });

  describe("EP CORS configuration", () => {
    it("cm-cors module exists", () => {
      expect(
        fileExists("platform/wab/src/wab/server/cm-cors.ts")
      ).toBe(true);
    });

    it("cm-cors tests exist", () => {
      expect(
        fileExists("platform/wab/src/wab/server/cm-cors.spec.ts")
      ).toBe(true);
    });
  });

  describe("EP provisioning routes", () => {
    it("provisioning route exists", () => {
      expect(
        fileExists(
          "platform/wab/src/wab/server/routes/provisioning.ts"
        )
      ).toBe(true);
    });

    it("project provisioning route exists", () => {
      expect(
        fileExists(
          "platform/wab/src/wab/server/routes/project-provisioning.ts"
        )
      ).toBe(true);
    });

    it("AppServer registers provisioning routes", () => {
      const appServer = readFile(
        "platform/wab/src/wab/server/AppServer.ts"
      );
      expect(appServer).toContain("provisionUser");
      expect(appServer).toContain("provisionTeam");
      expect(appServer).toContain("provisionWorkspace");
    });

    it("AppServer registers EP CORS and custom auth", () => {
      const appServer = readFile(
        "platform/wab/src/wab/server/AppServer.ts"
      );
      expect(appServer).toContain("cmCors");
      expect(appServer).toContain("customEPCCCookieAuth");
    });

    // CM reads/writes these for the Visual Builder config surfaces; without
    // cmCors they fall back to wildcard CORS and break credentialed requests.
    it("applies cmCors to the CM-called teams and project-meta routes", () => {
      const appServer = readFile(
        "platform/wab/src/wab/server/AppServer.ts"
      );
      expect(appServer).toContain('app.options("/api/v1/teams"');
      expect(appServer).toContain('app.options("/api/v1/teams/*"');
      expect(appServer).toMatch(/"\/api\/v1\/teams\/:teamId",\s*cmCors/);
      expect(appServer).toMatch(
        /"\/api\/v1\/projects\/:projectId\/meta",\s*cmCors/
      );
    });
  });

  describe("EP grant-revoke email bypass", () => {
    it("teams route supports SKIP_GRANT_REVOKE_EMAILS", () => {
      const teamsRoute = readFile(
        "platform/wab/src/wab/server/routes/teams.ts"
      );
      expect(teamsRoute).toContain("SKIP_GRANT_REVOKE_EMAILS");
    });
  });

  describe("EP CI/CD workflows", () => {
    const requiredWorkflows = [
      ".github/workflows/tests.yml",
      ".github/workflows/deploy-integration.yml",
      ".github/workflows/deploy-frontend.yml",
      ".github/workflows/publish-hostless.yml",
    ];

    for (const workflow of requiredWorkflows) {
      it(`${path.basename(workflow)} exists`, () => {
        expect(fileExists(workflow)).toBe(true);
      });
    }

    it("setup-env action exists", () => {
      expect(fileExists(".github/actions/setup-env/action.yml")).toBe(true);
    });
  });

  describe("EP rate limiting", () => {
    it("ep-rate-limit module and tests exist", () => {
      expect(fileExists("platform/wab/src/wab/server/ep-rate-limit.ts")).toBe(
        true
      );
      expect(
        fileExists("platform/wab/src/wab/server/ep-rate-limit.spec.ts")
      ).toBe(true);
    });

    it("AppServer wires the EP rate limiters", () => {
      const appServer = readFile("platform/wab/src/wab/server/AppServer.ts");
      expect(appServer).toContain("createGeneralApiRateLimiter");
      expect(appServer).toContain("createPreviewRateLimiter");
    });
  });

  describe("EP admin-only resource creation gates", () => {
    it("AppServer applies adminOnly middleware", () => {
      const appServer = readFile("platform/wab/src/wab/server/AppServer.ts");
      expect(appServer).toContain("adminOnly");
    });
  });

  describe("EP CloudFront invalidation on publish", () => {
    it("prefill worker invalidates published CDN paths", () => {
      const prefill = readFile(
        "platform/wab/src/wab/server/workers/prefill-cloudfront.ts"
      );
      expect(prefill).toContain("CreateInvalidationCommand");
      expect(prefill).toContain("CLOUDFRONT_DISTRIBUTION_ID");
    });

    it("wab depends on the CloudFront SDK", () => {
      const pkgJson = readJson("platform/wab/package.json");
      expect(
        pkgJson.dependencies["@aws-sdk/client-cloudfront"]
      ).toBeDefined();
    });
  });

  describe("EP loader URL split (Service Connect topology)", () => {
    it("urls.ts keeps the internal/public/data URL functions", () => {
      const urls = readFile("platform/wab/src/wab/shared/urls.ts");
      expect(urls).toContain("getLoaderInternalUrl");
      expect(urls).toContain("getCodegenPublicUrl");
      expect(urls).toContain("getDataUrl");
    });

    it("gen-html-bundle sets the SSR prepass data host", () => {
      const genHtml = readFile(
        "platform/wab/src/wab/server/loader/gen-html-bundle.ts"
      );
      expect(genHtml).toContain("__PLASMIC_DATA_HOST");
    });
  });

  describe("EP loader performance instrumentation", () => {
    it("server-timing module and ep-s3-cache exist", () => {
      expect(
        fileExists("platform/wab/src/wab/server/util/server-timing.ts")
      ).toBe(true);
      expect(fileExists("platform/wab/src/wab/server/util/ep-s3-cache.ts")).toBe(
        true
      );
    });

    it("apm-util records Server-Timing entries", () => {
      const apmUtil = readFile(
        "platform/wab/src/wab/server/util/apm-util.ts"
      );
      expect(apmUtil).toContain("recordTiming");
    });

    it("s3-util keeps the early S3 cache check", () => {
      const s3Util = readFile("platform/wab/src/wab/server/util/s3-util.ts");
      expect(s3Util).toContain("tryGetS3CacheEntry");
    });

    it("versioned loader route keeps semaphore and Server-Timing", () => {
      const loader = readFile(
        "platform/wab/src/wab/server/routes/loader.ts"
      );
      expect(loader).toContain("htmlPreviewSemaphore");
      expect(loader).toContain("runWithServerTiming");
    });
  });

  describe("EP Datadog observability (no Sentry regression)", () => {
    it("datadog observability module exists", () => {
      expect(
        fileExists("platform/wab/src/wab/server/observability/datadog.ts")
      ).toBe(true);
    });

    // Upstream error-handling refactors tend to reintroduce Sentry calls in
    // these files; EP migrated them to Datadog.
    const migratedFiles = [
      "platform/wab/src/wab/server/github/pages.ts",
      "platform/wab/src/wab/server/cdn/images.ts",
      "platform/wab/src/wab/server/routes/data-source.ts",
    ];
    for (const file of migratedFiles) {
      it(`${path.basename(file)} does not import Sentry`, () => {
        expect(readFile(file)).not.toContain("@sentry/");
      });
    }
  });

  describe("EP bundle migrations", () => {
    it("EP migration 255-fix-ep-addtocart-import-path is present and listed", () => {
      expect(
        fileExists(
          "platform/wab/src/wab/server/bundle-migrations/255-fix-ep-addtocart-import-path.ts"
        )
      ).toBe(true);
      const list = readFile(
        "platform/wab/src/wab/server/db/migrations-list.txt"
      );
      expect(list).toContain("255-fix-ep-addtocart-import-path.ts");
    });

    it("migration numbers are unique (renumbering collisions resolved)", () => {
      const list = readFile(
        "platform/wab/src/wab/server/db/migrations-list.txt"
      );
      const numbers = list
        .split("\n")
        .filter((line) => line.includes("bundle-migrations/"))
        .map((line) => line.match(/bundle-migrations\/(\d+)-/)?.[1])
        .filter((n): n is string => !!n);
      expect(new Set(numbers).size).toBe(numbers.length);
    });
  });

  describe("EP monorepo tooling (yarn, MCP workspaces)", () => {
    const rootPkg = readJson("package.json");

    it("root stays on yarn", () => {
      expect(rootPkg.packageManager).toMatch(/^yarn@/);
    });

    it("workspaces include the MCP packages", () => {
      expect(rootPkg.workspaces).toContain("packages/plasmic-mcp");
      expect(rootPkg.workspaces).toContain("packages/plasmic-mcp-registry");
    });
  });

  describe("EP wab runtime dependencies", () => {
    const pkgJson = readJson("platform/wab/package.json");
    const epDeps = ["dd-trace", "ioredis", "passport-jwt"];

    for (const dep of epDeps) {
      it(`includes ${dep}`, () => {
        expect(pkgJson.dependencies[dep]).toBeDefined();
      });
    }

    it("start-backend uses the EP pm2 ecosystem config", () => {
      expect(pkgJson.scripts["start-backend"]).toContain(
        "ecosystem.config.js"
      );
      expect(fileExists("platform/wab/ecosystem.config.js")).toBe(true);
    });
  });

  describe("EP branding", () => {
    it("DbInit seeds the Elastic Path logo", () => {
      const dbInit = readFile("platform/wab/src/wab/server/db/DbInit.ts");
      expect(dbInit).toContain("developer.elasticpath.com/logo");
    });
  });

  describe("EP Dockerfiles", () => {
    it("WAB Dockerfile exists", () => {
      expect(fileExists("platform/wab/Dockerfile")).toBe(true);
    });

    it("publish-hostless Dockerfile exists", () => {
      expect(fileExists("platform/wab/Dockerfile.publish-hostless")).toBe(
        true
      );
    });

    it("publish-hostless queries WAB container by name not index", () => {
      const workflow = readFile(
        ".github/workflows/publish-hostless.yml"
      );
      // The deployed image lookup must filter by container name, not use
      // index [0] which could be a sidecar (Fluent Bit, Datadog).
      expect(workflow).toContain("name=='wab'");
    });
  });
});
