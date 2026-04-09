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
