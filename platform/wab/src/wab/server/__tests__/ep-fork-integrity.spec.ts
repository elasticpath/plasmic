/**
 * EP Fork Integrity Tests
 *
 * Two jobs, both filesystem assertions from the repository root.
 *
 * Presence: Elastic Path customizations survive upstream merges from
 * plasmicapp/plasmic. When adding a new EP customization, add a test here.
 *
 * Absence: what the token-architecture work removed stays removed. A browser
 * Elastic Path client, the parallel cart routes and the shopper-context
 * request header are each one re-import away from coming back, and nothing
 * else would notice.
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

const EP_PKG = "plasmicpkgs/commerce-providers/elastic-path";

/** Every .ts/.tsx under `relativeDir`, tests excluded. */
function sourceFiles(relativeDir: string): string[] {
  const root = path.join(REPO_ROOT, relativeDir);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") {
          continue;
        }
        walk(full);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\.tsx?$/.test(entry.name)
      ) {
        out.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  walk(root);
  return out;
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

  describe("EP monorepo tooling (pnpm root, yarn platform apps)", () => {
    const rootPkg = readJson("package.json");

    it("root uses pnpm, matching upstream", () => {
      expect(rootPkg.packageManager).toMatch(/^pnpm@/);
    });

    it("root has no yarn.lock", () => {
      expect(fileExists("yarn.lock")).toBe(false);
    });

    it("pnpm lockfile has importers for the EP-only packages", () => {
      const lock = readFile("pnpm-lock.yaml");
      for (const dir of [
        "packages/plasmic-mcp",
        "packages/plasmic-mcp-registry",
        "plasmicpkgs/commerce-providers/elastic-path",
      ]) {
        expect(lock).toContain(`\n  ${dir}:\n`);
      }
    });

    it("pnpm does not prompt to reinstall before running scripts", () => {
      expect(readFile("pnpm-workspace.yaml")).toContain(
        "verifyDepsBeforeRun: false"
      );
    });

    // Upstream keeps these pins current through `lerna version`, which rewrites
    // dependents. EP bumps its own packages by hand, so nothing updates the
    // harness — elastic-path silently fell three versions behind this way.
    it("plasmicpkgs-dev pins EP packages at their workspace version", () => {
      const dirs = ["packages", "plasmicpkgs", "plasmicpkgs/commerce-providers"];
      const workspaceVersions: Record<string, string> = {};
      for (const dir of dirs) {
        for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir))) {
          const manifest = `${dir}/${entry}/package.json`;
          if (!fileExists(manifest)) {
            continue;
          }
          const pkg = readJson(manifest);
          if (pkg.name) {
            workspaceVersions[pkg.name] = pkg.version;
          }
        }
      }

      const deps = readJson("plasmicpkgs-dev/package.json").dependencies ?? {};
      for (const [name, range] of Object.entries(deps)) {
        if (name in workspaceVersions) {
          expect(`${name}@${range}`).toBe(`${name}@${workspaceVersions[name]}`);
        }
      }
    });

    it("every platform project pins yarn so it survives the pnpm root", () => {
      const projects = [
        "platform/canvas-packages",
        "platform/host-test",
        "platform/integration-tests",
        "platform/live-frame",
        "platform/loader-bundle-env",
        "platform/loader-html-hydrate",
        "platform/loader-tests",
        "platform/react-renderer",
        "platform/react-web-bundle",
        "platform/sub",
        "platform/wab",
        "platform/wab/playwright",
      ];
      for (const project of projects) {
        expect(readJson(`${project}/package.json`).packageManager).toMatch(
          /^yarn@1\./
        );
      }
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

  describe("EP commerce package build", () => {
    it("build.mjs keeps the --mjs flag", () => {
      expect(readFile("build.mjs")).toContain('"--mjs"');
    });

    it("elastic-path builds /server with --mjs", () => {
      const pkgJson = readJson(
        "plasmicpkgs/commerce-providers/elastic-path/package.json"
      );
      expect(pkgJson.scripts["build:server"]).toContain("--mjs");
    });

    it("attw keeps its own typescript", () => {
      expect(readFile("pnpm-workspace.yaml")).toContain(
        '"@arethetypeswrong/core>typescript"'
      );
    });

    it("CI builds and verifies the elastic-path package", () => {
      const workflow = readFile(".github/workflows/tests.yml");
      expect(workflow).toContain("pnpm verify:package");
    });
  });


  // -------------------------------------------------------------------------
  // Absence guards — elasticpath/plasmic#544. One token surface: the shopper
  // envelope, held by the server.
  // -------------------------------------------------------------------------

  describe("the browser holds no Elastic Path credential", () => {
    const removedModules = [
      "src/client.ts",
      "src/cart/server-routes.ts",
      "src/shopper-context/useShopperFetch.ts",
      "src/shopper-context/useShopperContext.ts",
      "src/shopper-context/use-cart.ts",
      "src/shopper-context/use-add-item.ts",
      "src/shopper-context/use-update-item.ts",
      "src/shopper-context/use-remove-item.ts",
      "src/shopper-context/server/resolve-cart-id.ts",
      "src/shopper-context/server/cart-cookie.ts",
    ];

    for (const module of removedModules) {
      it(`${module} stays deleted`, () => {
        expect(fileExists(`${EP_PKG}/${module}`)).toBe(false);
      });
    }

    const removedExports = [
      "createCartRoutes",
      "resolveCartId",
      "parseShopperHeader",
      "useShopperFetch",
      "useShopperContext",
      "useCart",
      "useAddItem",
      "useUpdateItem",
      "useRemoveItem",
      "ShopperOverrides",
      "buildCartCookieHeader",
    ];

    for (const name of removedExports) {
      it(`neither entry point exports ${name}`, () => {
        const declared = new RegExp(`\\b${name}\\b`);
        expect(readFile(`${EP_PKG}/api/index.api.md`)).not.toMatch(declared);
        expect(readFile(`${EP_PKG}/api/server.api.md`)).not.toMatch(declared);
      });
    }

    it("no header can assert which shopper a request is for", () => {
      for (const file of sourceFiles(EP_PKG + "/src")) {
        expect(readFile(file).toLowerCase()).not.toContain("x-shopper-context");
      }
    });

    it("the parallel cart route contract is gone", () => {
      expect(
        fileExists("examples/ep-commerce-app-router/app/api/ep/cart")
      ).toBe(false);
    });

    it("only server modules build an Elastic Path client", () => {
      const allowed = [
        `${EP_PKG}/src/api/endpoints/`,
        `${EP_PKG}/src/checkout/session/`,
        `${EP_PKG}/src/ep-server-functions/`,
      ];
      const builders = sourceFiles(EP_PKG + "/src").filter((file) =>
        readFile(file).includes("createShopperClient")
      );
      expect(builders.length).toBeGreaterThan(0);
      expect(
        builders.filter(
          (file) => !allowed.some((prefix) => file.startsWith(prefix))
        )
      ).toEqual([]);
    });

    it("a shopper cannot write a discount to their own basket", () => {
      const promoInput = readFile(
        `${EP_PKG}/src/checkout/composable/EPPromoCodeInput.tsx`
      );
      expect(promoInput).toContain("epApplyPromoCode");
      expect(promoInput).not.toMatch(/custom_discount|amount:\s*-/);
    });
  });

  describe("registrations that cannot be removed are inert", () => {
    it("EP Shopper Context says so in its display name", () => {
      expect(
        readFile(`${EP_PKG}/src/shopper-context/registerShopperContext.ts`)
      ).toContain('displayName: "EP Shopper Context (deprecated)"');
    });

    it("EP Shopper Context provides no context of its own", () => {
      const source = readFile(
        `${EP_PKG}/src/shopper-context/ShopperContext.tsx`
      );
      expect(source).not.toContain("createContext");
      expect(source).toContain("return <>{children}</>");
    });

    it("every deprecated prop description leads with the same words", () => {
      const sources = [
        "src/shopper-context/registerShopperContext.ts",
        "src/registerCommerceProvider.tsx",
        "src/checkout/composable/EPPromoCodeInput.tsx",
      ].map((file) => readFile(`${EP_PKG}/${file}`));
      for (const source of sources) {
        expect(source).toContain("Deprecated — ignored.");
        expect(source).not.toContain("Retired.");
      }
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

  describe("Elastic Path branch-merge performance (not yet upstream)", () => {
    // These checks guard speedups that are not upstream yet. If an upstream
    // merge drops one, no other test fails. Branch merges only become slower.
    const modelTreeUtil = () =>
      readFile("platform/wab/src/wab/shared/model/model-tree-util.ts");
    const modelMeta = () =>
      readFile("platform/wab/src/wab/shared/model/model-meta.ts");

    it("nextCtx builds keyPath without lodash zip", () => {
      expect(modelTreeUtil()).not.toContain("zip(ctx.path");
    });

    it("walkModelTree walks values without a context per value", () => {
      expect(modelTreeUtil()).toContain("function walkFieldValue(");
    });

    it("withoutUids builds its copy without lodash omit", () => {
      const src = modelMeta();
      expect(src).not.toContain('omit(x, "uid", "uuid")');
      expect(src).toContain("keysIn(x)");
    });

    it("model initializer leaves __type out instead of deleting it", () => {
      const src = modelMeta();
      expect(src).toContain("const { __type, ...rest } =");
      expect(src).not.toContain('delete inst["__type"]');
    });

    it("usedTokensForExp builds the token dictionary only when a ref needs it", () => {
      const src = readFile(
        "platform/wab/src/wab/shared/core/site-style-tokens.ts"
      );
      expect(src).not.toMatch(
        /const\s+allTokensDict\s*=\s*siteFinalStyleTokensAllDepsDict\(/
      );
      expect(src).toMatch(/\?\?=\s*siteFinalStyleTokensAllDepsDict\(/);
    });

    it("tplToUsedImageAssets builds the asset dictionary only when a ref needs it", () => {
      const src = readFile("platform/wab/src/wab/shared/cached-selectors.ts");
      expect(src).not.toMatch(
        /const\s+allAssetsDict\s*=\s*siteToAllImageAssetsDict\(/
      );
      expect(src).toMatch(/allAssetsDict\s*\?\?=\s*siteToAllImageAssetsDict\(/);
    });

    it("compareSites builds the token dictionary once per site", () => {
      const src = readFile("platform/wab/src/wab/shared/site-diffs/index.ts");
      expect(src).not.toMatch(
        /const\s+allTokensDict\s*=\s*siteFinalStyleTokensAllDepsDict\(/
      );
      expect(src).toContain("getTokensDict");
    });

    it("tryMergeBranch reads the head pkg versions without their model", () => {
      const src = readFile("platform/wab/src/wab/server/db/DbMgr.ts");
      expect(src).toContain("private async getPkgVersionHead(");
      expect(src).toContain("await this.getPkgVersionHead(pkg.id, toBranchId)");
    });

    it("tryMergeBranch loads the merge's sites in a separate method", () => {
      const src = readFile("platform/wab/src/wab/server/db/DbMgr.ts");
      expect(src).toContain("private async _prepareMerge(");
      expect(src).toContain("await this._prepareMerge(");
    });

    it("final style tokens are classified with set lookups", () => {
      expect(
        readFile("platform/wab/src/wab/shared/core/tokens.ts")
      ).toMatch(/export function setMembership\(/);
      expect(
        readFile("platform/wab/src/wab/shared/core/site-style-tokens.ts")
      ).toMatch(/setMembership\(\)/);
    });
  });
});
