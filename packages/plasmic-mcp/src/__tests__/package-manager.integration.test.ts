/**
 * Integration tests for package-manager against real WAB model classes.
 *
 * Unlike unit tests (which mock all WAB functions via vitest aliases),
 * these tests use REAL MobX-observed model instances from a genuine
 * Plasmic bundle fixture. Only two WAB functions are mocked:
 *
 *   - unbundleProjectDependency: needs PkgVersion bundles (fixtures have
 *     project revision bundles, which are incompatible)
 *   - upgradeProjectDeps: needs two different package versions (fixtures
 *     only provide one version per dependency)
 *
 * All other WAB functions run for REAL, validating that package management
 * works correctly with actual MobX-observed model instances:
 *   - isHostLessPackage: real `site.hostLessPackageInfo != null` check
 *   - isReusableComponent: real component type filtering
 *   - TplMgr: real site manipulation with MobX observation
 *   - extractTransitiveHostLessPackages: real dependency tree traversal
 *   - extractTransitiveDepsFromComponentDefaultSlots: real slot analysis
 *   - syncGlobalContexts: real global context merging
 *   - getNonTransitiveDepDefaultComponents: real default component extraction
 *
 * Why this matters:
 * - Real WAB model instances use MobX observables with class methods,
 *   not plain objects. Package management must correctly mutate these.
 * - isHostLessPackage checks `site.hostLessPackageInfo != null` on real
 *   instances — duck-typed mocks may behave differently.
 * - TplMgr.removeProjectDep works on real MobX-observed arrays.
 * - extractTransitiveHostLessPackages walks real dependency trees with
 *   real ProjectDependency instances.
 *
 * Fixture: platform/wab/cypress/bundles/active-screen-variant-group.json
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Partial mocks — only unbundleProjectDependency and upgradeProjectDeps.
// All other WAB imports remain REAL in integration mode.
// ---------------------------------------------------------------------------

const mockUnbundleProjectDependency = vi.fn();
const mockUpgradeProjectDeps = vi.fn();

vi.mock("@/wab/shared/core/tagged-unbundle", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/wab/shared/core/tagged-unbundle")
  >();
  return {
    ...original,
    unbundleProjectDependency: mockUnbundleProjectDependency,
  };
});

vi.mock("@/wab/shared/core/project-deps", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/wab/shared/core/project-deps")
  >();
  return {
    ...original,
    upgradeProjectDeps: mockUpgradeProjectDeps,
  };
});

// ---------------------------------------------------------------------------
// Module references (dynamically imported after MobX initialization)
// ---------------------------------------------------------------------------

let listPackages: typeof import("../package-manager").listPackages;
let addPackage: typeof import("../package-manager").addPackage;
let removePackage: typeof import("../package-manager").removePackage;
let upgradePackage: typeof import("../package-manager").upgradePackage;
let setSession: typeof import("../session").setSession;
let clearSession: typeof import("../session").clearSession;

let site: any;
let bundler: any;
let components: any[];
let originalDeps: any[];
let mainProjectId: string;

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  const mobx = await import("mobx");
  mobx.configure({ enforceActions: "never" });

  // Load the real Plasmic bundle fixture
  const fixturePath = resolve(
    __dirname,
    "../../../../platform/wab/cypress/bundles/active-screen-variant-group.json"
  );
  const fixtureData = JSON.parse(readFileSync(fixturePath, "utf-8"));
  const [[depProjectId, depBundleJson], [_mainProjectId, mainBundleJson]] =
    fixtureData;
  mainProjectId = _mainProjectId;

  // Import real WAB modules
  const { FastBundler } = await import("@/wab/shared/bundler");
  const { meta } = await import("@/wab/shared/model/classes-metas");
  const classesModule = await import("@/wab/shared/model/classes");
  const tpls = await import("@/wab/shared/core/tpls");

  // Unbundle fixture into real MobX-observed model instances
  bundler = new FastBundler(meta, classesModule);

  const depBundle =
    typeof depBundleJson === "string"
      ? JSON.parse(depBundleJson)
      : depBundleJson;
  bundler.unbundle(depBundle, depProjectId);

  const mainBundle =
    typeof mainBundleJson === "string"
      ? JSON.parse(mainBundleJson)
      : mainBundleJson;
  const result = bundler.unbundle(mainBundle, mainProjectId);

  // Extract Site from unbundled result
  if (classesModule.Site.isKnown(result)) {
    site = result;
  } else if (classesModule.ProjectDependency.isKnown(result)) {
    site = (result as any).site;
  } else {
    throw new Error("Could not extract Site from bundle fixture");
  }

  // Track components (required for TplMgr and other WAB operations)
  components = site.components ?? [];
  for (const comp of components) {
    tpls.trackComponentRoot(comp);
    tpls.trackComponentSite(comp, site);
  }

  // Save original deps for test isolation
  originalDeps = [...(site.projectDependencies ?? [])];

  // Import modules under test (resolved to real WAB in integration mode,
  // except the two mocked functions above)
  const pkgManager = await import("../package-manager.js");
  listPackages = pkgManager.listPackages;
  addPackage = pkgManager.addPackage;
  removePackage = pkgManager.removePackage;
  upgradePackage = pkgManager.upgradePackage;

  const sessionModule = await import("../session.js");
  setSession = sessionModule.setSession;
  clearSession = sessionModule.clearSession;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockApiClient(overrides: Record<string, any> = {}) {
  return {
    getPkgByProjectId: vi.fn().mockResolvedValue({ pkg: undefined }),
    getPkgVersion: vi.fn().mockResolvedValue({ pkg: {}, depPkgs: [] }),
    getPkgVersionMeta: vi
      .fn()
      .mockRejectedValue(new Error("not configured")),
    getAppAuthPubConfig: vi
      .fn()
      .mockResolvedValue({ isAuthEnabled: false }),
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("package-manager real WAB integration", () => {
  beforeEach(() => {
    // Restore site deps to original state for test isolation
    site.projectDependencies = [...originalDeps];

    // Set up session with real site and bundler
    setSession({
      projectId: mainProjectId,
      projectName: "Integration Test Project",
      site,
      bundler,
      revisionNum: 1,
      modelVersion: 1,
      hostlessDataVersion: 0,
      projectUuid: mainProjectId,
      bundleVersion: "256",
    });

    mockUnbundleProjectDependency.mockClear();
    mockUpgradeProjectDeps.mockClear();
  });

  afterEach(() => {
    clearSession();
  });

  // ========================================================================
  // listPackages — real isHostLessPackage on real model instances
  // ========================================================================

  describe("listPackages", () => {
    it("returns PackageInfo for all installed dependencies", async () => {
      const client = makeMockApiClient();
      const result = await listPackages(client);

      expect(result).toHaveLength(originalDeps.length);
      for (const info of result) {
        expect(info).toHaveProperty("name");
        expect(info).toHaveProperty("pkgId");
        expect(info).toHaveProperty("version");
        expect(info).toHaveProperty("projectId");
        expect(typeof info.isHostLess).toBe("boolean");
      }
    });

    it("populates latestVersion from server metadata", async () => {
      if (originalDeps.length === 0) return;

      const client = makeMockApiClient({
        getPkgVersionMeta: vi
          .fn()
          .mockResolvedValue({ pkg: { version: "99.0.0" } }),
      });

      const result = await listPackages(client);
      expect(result[0].latestVersion).toBe("99.0.0");
    });

    it("gracefully omits latestVersion on metadata fetch failure", async () => {
      if (originalDeps.length === 0) return;

      const client = makeMockApiClient({
        getPkgVersionMeta: vi
          .fn()
          .mockRejectedValue(new Error("Network error")),
      });

      const result = await listPackages(client);
      expect(result[0].latestVersion).toBeUndefined();
    });

    it("uses real isHostLessPackage on real Site instances", async () => {
      if (originalDeps.length === 0) return;

      const client = makeMockApiClient();
      const result = await listPackages(client);

      // Verify each dep's isHostLess matches the real model check
      for (let i = 0; i < result.length; i++) {
        const depSite = originalDeps[i].site;
        const expected = depSite?.hostLessPackageInfo != null;
        expect(result[i].isHostLess).toBe(expected);
      }
    });
  });

  // ========================================================================
  // addPackage — validation and mutation with real model instances
  // ========================================================================

  describe("addPackage", () => {
    it("throws on self-import", async () => {
      const client = makeMockApiClient();

      await expect(addPackage(client, mainProjectId)).rejects.toThrow(
        "You cannot import the current project."
      );
    });

    it("throws when project has no published versions", async () => {
      const client = makeMockApiClient({
        getPkgByProjectId: vi.fn().mockResolvedValue({ pkg: undefined }),
      });

      await expect(addPackage(client, "new-source")).rejects.toThrow(
        "has no published versions"
      );
    });

    it("throws when package is already imported (real model comparison)", async () => {
      if (originalDeps.length === 0) return;

      const existingDep = site.projectDependencies[0];
      const client = makeMockApiClient({
        getPkgByProjectId: vi.fn().mockResolvedValue({
          pkg: {
            id: existingDep.pkgId,
            name: "Existing Package",
            projectId: "source-proj",
          },
        }),
      });

      await expect(addPackage(client, "source-proj")).rejects.toThrow(
        "has already been imported"
      );
    });

    it("throws when dependency has auth enabled", async () => {
      const client = makeMockApiClient({
        getPkgByProjectId: vi.fn().mockResolvedValue({
          pkg: { id: "new-pkg", name: "Auth Pkg", projectId: "auth-proj" },
        }),
        getAppAuthPubConfig: vi
          .fn()
          .mockResolvedValue({ isAuthEnabled: true }),
      });

      await expect(addPackage(client, "auth-proj")).rejects.toThrow(
        "has auth enabled"
      );
    });

    it("adds package and mutates real MobX-observed site.projectDependencies", async () => {
      if (originalDeps.length === 0) return;

      // Remove all deps so we can re-add one via addPackage
      const depToReAdd = originalDeps[0];
      site.projectDependencies = [];

      mockUnbundleProjectDependency.mockReturnValue({
        projectDependency: depToReAdd,
        depPkgs: [],
      });

      const client = makeMockApiClient({
        getPkgByProjectId: vi
          .fn()
          .mockResolvedValueOnce({
            pkg: {
              id: depToReAdd.pkgId,
              name: depToReAdd.name ?? "Test Pkg",
              projectId: "source-proj",
            },
          })
          .mockResolvedValueOnce({ pkg: undefined }), // own project not published
        getPkgVersion: vi.fn().mockResolvedValue({
          pkg: {
            id: "pv-1",
            pkgId: depToReAdd.pkgId,
            version: "1.0.0",
            model: "{}",
          },
          depPkgs: [],
        }),
      });

      const result = await addPackage(client, "source-proj");

      expect(result.pkgId).toBe(depToReAdd.pkgId);
      // Dep was pushed to site.projectDependencies (may include transitives)
      expect(site.projectDependencies.length).toBeGreaterThanOrEqual(1);
      expect(site.projectDependencies).toContain(depToReAdd);
    });

    it("runs real extractTransitiveHostLessPackages during add", async () => {
      // Verifies that real WAB tree traversal functions run without error
      // on real model instances during the add-dependency flow.
      if (originalDeps.length === 0) return;

      const depToReAdd = originalDeps[0];
      site.projectDependencies = [];

      mockUnbundleProjectDependency.mockReturnValue({
        projectDependency: depToReAdd,
        depPkgs: [],
      });

      const client = makeMockApiClient({
        getPkgByProjectId: vi
          .fn()
          .mockResolvedValueOnce({
            pkg: {
              id: depToReAdd.pkgId,
              name: "Dep With Subs",
              projectId: "source-proj",
            },
          })
          .mockResolvedValueOnce({ pkg: undefined }),
        getPkgVersion: vi.fn().mockResolvedValue({
          pkg: {
            id: "pv-1",
            pkgId: depToReAdd.pkgId,
            version: "1.0.0",
            model: "{}",
          },
          depPkgs: [],
        }),
      });

      // Should not throw — real WAB functions handle the real model
      const result = await addPackage(client, "source-proj");
      expect(result).toBeDefined();
      expect(result.componentCount).toBeGreaterThanOrEqual(0);
    });

    it("detects circular dependency via real buildDependencyMap traversal", async () => {
      site.projectDependencies = [];

      const circularDep = {
        pkgId: "new-pkg",
        name: "Circular Dep",
        version: "1.0.0",
        projectId: "circular-proj",
        site: {
          projectDependencies: [
            {
              pkgId: "my-own-pkg",
              version: "1.0.0",
              site: { projectDependencies: [] },
            },
          ],
          components: [],
          globalContexts: [],
        },
      };

      mockUnbundleProjectDependency.mockReturnValue({
        projectDependency: circularDep,
        depPkgs: [],
      });

      const client = makeMockApiClient({
        getPkgByProjectId: vi
          .fn()
          .mockResolvedValueOnce({
            pkg: {
              id: "new-pkg",
              name: "Circular Dep",
              projectId: "circular-proj",
            },
          })
          .mockResolvedValueOnce({
            pkg: { id: "my-own-pkg", projectId: mainProjectId },
          }),
        getPkgVersion: vi.fn().mockResolvedValue({
          pkg: {
            id: "pv-1",
            pkgId: "new-pkg",
            version: "1.0.0",
            model: "{}",
          },
          depPkgs: [],
        }),
      });

      await expect(addPackage(client, "circular-proj")).rejects.toThrow(
        "circular dependency"
      );
    });

    it("detects version conflict via real buildDependencyMap traversal", async () => {
      if (originalDeps.length === 0) return;

      const existingDep = originalDeps[0];

      // New dep requires the same pkgId at a different version
      const conflictDep = {
        pkgId: "conflict-pkg",
        name: "Conflict Dep",
        version: "1.0.0",
        projectId: "conflict-proj",
        site: {
          projectDependencies: [
            {
              pkgId: existingDep.pkgId,
              version: existingDep.version + "-different",
              site: { projectDependencies: [] },
            },
          ],
          components: [],
          globalContexts: [],
        },
      };

      mockUnbundleProjectDependency.mockReturnValue({
        projectDependency: conflictDep,
        depPkgs: [],
      });

      const client = makeMockApiClient({
        getPkgByProjectId: vi
          .fn()
          .mockResolvedValueOnce({
            pkg: {
              id: "conflict-pkg",
              name: "Conflict Dep",
              projectId: "conflict-proj",
            },
          })
          .mockResolvedValueOnce({ pkg: undefined }),
        getPkgVersion: vi.fn().mockResolvedValue({
          pkg: {
            id: "pv-1",
            pkgId: "conflict-pkg",
            version: "1.0.0",
            model: "{}",
          },
          depPkgs: [],
        }),
      });

      await expect(addPackage(client, "conflict-proj")).rejects.toThrow(
        "conflicting dependencies"
      );
    });
  });

  // ========================================================================
  // removePackage — real TplMgr and hostless dependent checks
  // ========================================================================

  describe("removePackage", () => {
    it("removes package from real MobX-observed site", async () => {
      if (originalDeps.length === 0) return;

      const dep = site.projectDependencies[0];
      const pkgId = dep.pkgId;
      const initialCount = site.projectDependencies.length;
      const client = makeMockApiClient();

      const result = await removePackage(client, pkgId);

      expect(result.pkgId).toBe(pkgId);
      expect(site.projectDependencies.length).toBe(initialCount - 1);
    });

    it("removes by name (case-insensitive) on real model", async () => {
      if (originalDeps.length === 0) return;

      const dep = site.projectDependencies[0];
      const name = dep.name ?? dep.site?.name ?? "";
      if (!name) return;

      const client = makeMockApiClient();
      const result = await removePackage(client, name.toUpperCase());

      expect(result.pkgId).toBe(dep.pkgId);
    });

    it("throws when package is not found", async () => {
      const client = makeMockApiClient();

      await expect(
        removePackage(client, "nonexistent-pkg")
      ).rejects.toThrow("is not installed");
    });

    it("throws when hostless package has dependents (real isHostLessPackage)", async () => {
      if (originalDeps.length === 0) return;

      const baseDep = site.projectDependencies[0];

      // Add a synthetic hostless package that depends on baseDep.
      // The real isHostLessPackage checks `site.hostLessPackageInfo != null`.
      const dependentDep = {
        pkgId: "pkg-dependent",
        name: "Dependent Package",
        version: "1.0.0",
        site: {
          hostLessPackageInfo: {},
          projectDependencies: [
            { pkgId: baseDep.pkgId, version: baseDep.version },
          ],
          components: [],
          globalContexts: [],
        },
      };
      site.projectDependencies.push(dependentDep);

      const client = makeMockApiClient();

      await expect(
        removePackage(client, baseDep.pkgId)
      ).rejects.toThrow("is a dependency of");
    });
  });

  // ========================================================================
  // upgradePackage — version comparison with real model instances
  // ========================================================================

  describe("upgradePackage", () => {
    it("throws when package is not installed", async () => {
      const client = makeMockApiClient();

      await expect(
        upgradePackage(client, "nonexistent")
      ).rejects.toThrow("is not installed");
    });

    it("throws when already at latest version", async () => {
      if (originalDeps.length === 0) return;

      const dep = site.projectDependencies[0];
      const client = makeMockApiClient({
        getPkgVersionMeta: vi
          .fn()
          .mockResolvedValue({ pkg: { version: dep.version } }),
      });

      await expect(upgradePackage(client, dep.pkgId)).rejects.toThrow(
        "already at latest version"
      );
    });

    it("returns empty array when all deps are current (batch mode)", async () => {
      if (originalDeps.length === 0) return;

      const client = makeMockApiClient({
        getPkgVersionMeta: vi
          .fn()
          .mockImplementation(async (pkgId: string) => {
            const dep = site.projectDependencies.find(
              (d: any) => d.pkgId === pkgId
            );
            return { pkg: { version: dep?.version ?? "1.0.0" } };
          }),
      });

      const results = await upgradePackage(client);
      expect(results).toEqual([]);
      expect(mockUpgradeProjectDeps).not.toHaveBeenCalled();
    });

    it("upgrades single package and calls upgradeProjectDeps", async () => {
      if (originalDeps.length === 0) return;

      const dep = site.projectDependencies[0];
      const newVersion = dep.version + ".1";

      const newDep = {
        pkgId: dep.pkgId,
        name: dep.name,
        version: newVersion,
        site: { projectDependencies: [], components: [] },
      };

      mockUnbundleProjectDependency.mockReturnValue({
        projectDependency: newDep,
        depPkgs: [],
      });

      const client = makeMockApiClient({
        getPkgVersionMeta: vi
          .fn()
          .mockResolvedValue({ pkg: { version: newVersion } }),
        getPkgVersion: vi.fn().mockResolvedValue({
          pkg: {
            id: "pv-new",
            pkgId: dep.pkgId,
            version: newVersion,
            model: "{}",
          },
          depPkgs: [],
        }),
      });

      const results = await upgradePackage(client, dep.pkgId);

      expect(results).toHaveLength(1);
      expect(results[0].oldVersion).toBe(dep.version);
      expect(results[0].newVersion).toBe(newVersion);
      expect(mockUpgradeProjectDeps).toHaveBeenCalledWith(site, [
        { oldDep: dep, newDep },
      ]);
    });

    it("upgrades all outdated packages in batch mode", async () => {
      if (originalDeps.length === 0) return;

      const client = makeMockApiClient({
        getPkgVersionMeta: vi
          .fn()
          .mockImplementation(async (pkgId: string) => {
            const dep = site.projectDependencies.find(
              (d: any) => d.pkgId === pkgId
            );
            return {
              pkg: { version: (dep?.version ?? "1.0.0") + ".upgraded" },
            };
          }),
        getPkgVersion: vi
          .fn()
          .mockImplementation(async (pkgId: string) => {
            const dep = site.projectDependencies.find(
              (d: any) => d.pkgId === pkgId
            );
            return {
              pkg: {
                id: "pv-" + pkgId,
                pkgId,
                version: (dep?.version ?? "1.0.0") + ".upgraded",
                model: "{}",
              },
              depPkgs: [],
            };
          }),
      });

      mockUnbundleProjectDependency.mockImplementation(
        (_bundler: any, pkgInfo: any) => ({
          projectDependency: {
            pkgId: pkgInfo.pkgId,
            version: pkgInfo.version,
            name: "Upgraded",
            site: { projectDependencies: [], components: [] },
          },
          depPkgs: [],
        })
      );

      const results = await upgradePackage(client);

      expect(results.length).toBe(originalDeps.length);
      for (const r of results) {
        expect(r.newVersion).toContain(".upgraded");
      }
      expect(mockUpgradeProjectDeps).toHaveBeenCalledTimes(1);
    });
  });
});
