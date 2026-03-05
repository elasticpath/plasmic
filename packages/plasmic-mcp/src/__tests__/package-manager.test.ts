/**
 * Unit tests for package-manager.ts
 *
 * Package management enables MCP users to add, remove, upgrade, and list
 * hostless packages without manual Studio intervention. These tests verify
 * the complete validation flow and model mutations using mocked WAB imports.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import * as sessionModule from "../session";
import {
  listPackages,
  addPackage,
  removePackage,
  upgradePackage,
  listAvailablePackages,
  listPackageComponents,
} from "../package-manager";
import { mockUnbundleProjectDependency } from "../__mocks__/wab-tagged-unbundle";
import {
  mockExtractTransitiveDepsFromComponentDefaultSlots,
  mockExtractTransitiveHostLessPackages,
  mockSyncGlobalContexts,
  mockUpgradeProjectDeps,
} from "../__mocks__/wab-project-deps";
import {
  mockIsHostLessPackage,
  mockGetNonTransitiveDepDefaultComponents,
} from "../__mocks__/wab-sites";
import {
  mockIsReusableComponent,
} from "../__mocks__/wab-components";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockApiClient(overrides: Record<string, any> = {}) {
  return {
    getPkgByProjectId: vi.fn().mockResolvedValue({ pkg: { id: "pkg-1", name: "Test Package", projectId: "source-proj" } }),
    getPkgVersion: vi.fn().mockResolvedValue({
      pkg: { id: "pv-1", pkgId: "pkg-1", version: "1.0.0", model: "{}" },
      depPkgs: [],
    }),
    getPkgVersionMeta: vi.fn().mockResolvedValue({
      pkg: { id: "pv-1", pkgId: "pkg-1", version: "1.0.0" },
      depPkgs: [],
    }),
    getAppAuthPubConfig: vi.fn().mockResolvedValue({
      allowed: true,
      appName: "Test App",
      authScreenProperties: null,
      isAuthEnabled: false,
    }),
    ...overrides,
  } as any;
}

function makeMockSession(overrides: Record<string, any> = {}) {
  return {
    projectId: "my-project",
    projectName: "My Project",
    site: {
      projectDependencies: [],
      components: [],
      globalContexts: [],
      defaultComponents: {},
      ...overrides.site,
    },
    bundler: {},
    revisionNum: 1,
    modelVersion: 1,
    hostlessDataVersion: 1,
    projectUuid: "my-project",
    bundleVersion: "256",
    ...overrides,
  };
}

function makeMockDep(overrides: Record<string, any> = {}) {
  return {
    _type: "ProjectDependency",
    pkgId: "pkg-1",
    version: "1.0.0",
    projectId: "source-proj",
    name: "Test Package",
    site: {
      components: [],
      projectDependencies: [],
      globalContexts: [],
      defaultComponents: {},
      hostLessPackageInfo: {},
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("package-manager", () => {
  let mockSession: any;

  beforeEach(() => {
    mockSession = makeMockSession();
    vi.spyOn(sessionModule, "requireSession").mockReturnValue(mockSession);
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Reset WAB mocks
    mockUnbundleProjectDependency.mockClear();
    mockExtractTransitiveDepsFromComponentDefaultSlots.mockClear();
    mockExtractTransitiveHostLessPackages.mockClear();
    mockSyncGlobalContexts.mockClear();
    mockUpgradeProjectDeps.mockClear();
    mockIsHostLessPackage.mockClear();
    mockGetNonTransitiveDepDefaultComponents.mockClear();
    mockIsReusableComponent.mockClear();

    // Default mock behaviors
    mockUnbundleProjectDependency.mockReturnValue({
      projectDependency: makeMockDep(),
      depPkgs: [],
    });
    mockExtractTransitiveDepsFromComponentDefaultSlots.mockReturnValue([]);
    mockExtractTransitiveHostLessPackages.mockReturnValue([]);
    mockGetNonTransitiveDepDefaultComponents.mockReturnValue({});
    mockIsHostLessPackage.mockReturnValue(true);
    mockIsReusableComponent.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // list-packages
  // ========================================================================

  describe("listPackages", () => {
    it("returns empty array when no dependencies installed", async () => {
      const client = makeMockApiClient();
      const result = await listPackages(client);
      expect(result).toEqual([]);
    });

    it("returns dependency info with latest version", async () => {
      const dep = makeMockDep();
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient({
        getPkgVersionMeta: vi.fn().mockResolvedValue({
          pkg: { id: "pv-1", pkgId: "pkg-1", version: "2.0.0" },
          depPkgs: [],
        }),
      });

      const result = await listPackages(client);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "Test Package",
        pkgId: "pkg-1",
        projectId: "source-proj",
        version: "1.0.0",
        isHostLess: true,
        latestVersion: "2.0.0",
      });
    });

    it("gracefully handles metadata fetch failure", async () => {
      const dep = makeMockDep();
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient({
        getPkgVersionMeta: vi.fn().mockRejectedValue(new Error("Network error")),
      });

      const result = await listPackages(client);

      expect(result).toHaveLength(1);
      expect(result[0].latestVersion).toBeUndefined();
    });
  });

  // ========================================================================
  // add-package
  // ========================================================================

  describe("addPackage", () => {
    it("successfully adds a package", async () => {
      const client = makeMockApiClient();

      const result = await addPackage(client, "source-proj");

      expect(result.name).toBe("Test Package");
      expect(result.pkgId).toBe("pkg-1");
      expect(result.version).toBe("1.0.0");
      expect(mockSession.site.projectDependencies).toHaveLength(1);
    });

    it("calls unbundleProjectDependency with bundler and pkg data", async () => {
      const client = makeMockApiClient();

      await addPackage(client, "source-proj");

      expect(mockUnbundleProjectDependency).toHaveBeenCalledWith(
        mockSession.bundler,
        expect.objectContaining({ pkgId: "pkg-1" }),
        expect.any(Array)
      );
    });

    it("calls syncGlobalContexts after adding", async () => {
      const client = makeMockApiClient();

      await addPackage(client, "source-proj");

      expect(mockSyncGlobalContexts).toHaveBeenCalled();
    });

    it("throws on self-import", async () => {
      const client = makeMockApiClient();

      await expect(addPackage(client, "my-project")).rejects.toThrow(
        "You cannot import the current project."
      );
    });

    it("throws when project has no published versions", async () => {
      const client = makeMockApiClient({
        getPkgByProjectId: vi.fn().mockResolvedValue({ pkg: undefined }),
      });

      await expect(addPackage(client, "source-proj")).rejects.toThrow(
        "has no published versions"
      );
    });

    it("throws when package is already imported", async () => {
      mockSession.site.projectDependencies = [makeMockDep()];
      const client = makeMockApiClient();

      await expect(addPackage(client, "source-proj")).rejects.toThrow(
        "has already been imported"
      );
    });

    it("throws when dependency has auth enabled", async () => {
      const client = makeMockApiClient({
        getAppAuthPubConfig: vi.fn().mockResolvedValue({
          allowed: true,
          appName: "Auth App",
          authScreenProperties: null,
          isAuthEnabled: true,
        }),
      });

      await expect(addPackage(client, "source-proj")).rejects.toThrow(
        "has auth enabled"
      );
    });

    it("throws on circular dependency", async () => {
      // The imported package depends on a package that has our own pkgId
      const depWithCircular = makeMockDep({
        site: {
          components: [],
          projectDependencies: [
            { pkgId: "my-own-pkg", version: "1.0.0", site: { projectDependencies: [] } },
          ],
          globalContexts: [],
          defaultComponents: {},
          hostLessPackageInfo: {},
        },
      });
      mockUnbundleProjectDependency.mockReturnValue({
        projectDependency: depWithCircular,
        depPkgs: [],
      });

      const client = makeMockApiClient({
        // Own project is published as "my-own-pkg"
        getPkgByProjectId: vi.fn()
          .mockResolvedValueOnce({ pkg: { id: "pkg-1", name: "Test Package", projectId: "source-proj" } })
          .mockResolvedValueOnce({ pkg: { id: "my-own-pkg", projectId: "my-project" } }),
      });

      await expect(addPackage(client, "source-proj")).rejects.toThrow(
        "circular dependency"
      );
    });

    it("throws on version conflict", async () => {
      // Site already has dep-a at v1, imported package needs dep-a at v2
      mockSession.site.projectDependencies = [
        makeMockDep({ pkgId: "dep-a", version: "1.0.0", name: "Dep A", site: { projectDependencies: [], hostLessPackageInfo: {} } }),
      ];

      const depWithConflict = makeMockDep({
        pkgId: "pkg-new",
        site: {
          components: [],
          projectDependencies: [
            { pkgId: "dep-a", version: "2.0.0", site: { projectDependencies: [] } },
          ],
          globalContexts: [],
          defaultComponents: {},
          hostLessPackageInfo: {},
        },
      });
      mockUnbundleProjectDependency.mockReturnValue({
        projectDependency: depWithConflict,
        depPkgs: [],
      });

      const client = makeMockApiClient();

      await expect(addPackage(client, "source-proj")).rejects.toThrow(
        "conflicting dependencies"
      );
    });
  });

  // ========================================================================
  // remove-package
  // ========================================================================

  describe("removePackage", () => {
    it("removes a package by pkgId", async () => {
      const dep = makeMockDep();
      mockSession.site.projectDependencies = [dep];
      const client = makeMockApiClient();

      const result = await removePackage(client, "pkg-1");

      expect(result.name).toBe("Test Package");
      expect(result.pkgId).toBe("pkg-1");
      expect(mockSession.site.projectDependencies).toHaveLength(0);
    });

    it("removes a package by name (case-insensitive)", async () => {
      const dep = makeMockDep();
      mockSession.site.projectDependencies = [dep];
      const client = makeMockApiClient();

      const result = await removePackage(client, "test package");

      expect(result.pkgId).toBe("pkg-1");
      expect(mockSession.site.projectDependencies).toHaveLength(0);
    });

    it("throws when package is not installed", async () => {
      const client = makeMockApiClient();

      await expect(removePackage(client, "nonexistent")).rejects.toThrow(
        "is not installed"
      );
    });

    it("throws when other hostless packages depend on it", async () => {
      const dep = makeMockDep({ pkgId: "pkg-base", name: "Base Package" });
      const dependentDep = makeMockDep({
        pkgId: "pkg-dependent",
        name: "Dependent Package",
        site: {
          components: [],
          projectDependencies: [{ pkgId: "pkg-base", version: "1.0.0" }],
          globalContexts: [],
          defaultComponents: {},
          hostLessPackageInfo: {},
        },
      });
      mockSession.site.projectDependencies = [dep, dependentDep];
      mockIsHostLessPackage.mockReturnValue(true);

      const client = makeMockApiClient();

      await expect(removePackage(client, "pkg-base")).rejects.toThrow(
        "is a dependency of"
      );
    });
  });

  // ========================================================================
  // upgrade-package
  // ========================================================================

  describe("upgradePackage", () => {
    it("upgrades a single package to latest version", async () => {
      const dep = makeMockDep({ version: "1.0.0" });
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient({
        getPkgVersionMeta: vi.fn().mockResolvedValue({
          pkg: { id: "pv-2", pkgId: "pkg-1", version: "2.0.0" },
          depPkgs: [],
        }),
        getPkgVersion: vi.fn().mockResolvedValue({
          pkg: { id: "pv-2", pkgId: "pkg-1", version: "2.0.0", model: "{}" },
          depPkgs: [],
        }),
      });

      const newDep = makeMockDep({ version: "2.0.0" });
      mockUnbundleProjectDependency.mockReturnValue({
        projectDependency: newDep,
        depPkgs: [],
      });

      const results = await upgradePackage(client, "pkg-1");

      expect(results).toHaveLength(1);
      expect(results[0].oldVersion).toBe("1.0.0");
      expect(results[0].newVersion).toBe("2.0.0");
      expect(mockUpgradeProjectDeps).toHaveBeenCalledWith(
        mockSession.site,
        [{ oldDep: dep, newDep }]
      );
    });

    it("throws when package is already at latest version", async () => {
      const dep = makeMockDep({ version: "1.0.0" });
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient({
        getPkgVersionMeta: vi.fn().mockResolvedValue({
          pkg: { id: "pv-1", pkgId: "pkg-1", version: "1.0.0" },
          depPkgs: [],
        }),
      });

      await expect(upgradePackage(client, "pkg-1")).rejects.toThrow(
        "already at latest version"
      );
    });

    it("throws when package is not installed", async () => {
      const client = makeMockApiClient();

      await expect(upgradePackage(client, "nonexistent")).rejects.toThrow(
        "is not installed"
      );
    });

    it("returns empty array when all packages are up to date (batch mode)", async () => {
      const dep = makeMockDep({ version: "1.0.0" });
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient({
        getPkgVersionMeta: vi.fn().mockResolvedValue({
          pkg: { id: "pv-1", pkgId: "pkg-1", version: "1.0.0" },
          depPkgs: [],
        }),
      });

      const results = await upgradePackage(client);

      expect(results).toEqual([]);
      expect(mockUpgradeProjectDeps).not.toHaveBeenCalled();
    });

    it("throws on transitive version conflict after upgrade (ensureCanUpgradeDeps)", async () => {
      // dep1 transitively depends on shared-pkg at version 1.0.0
      // dep2's new version transitively depends on shared-pkg at version 2.0.0
      // This should be caught before upgradeProjectDeps is called
      const sharedDepV1 = makeMockDep({
        pkgId: "shared-pkg",
        version: "1.0.0",
        name: "Shared",
        site: { components: [], projectDependencies: [], globalContexts: [], defaultComponents: {}, hostLessPackageInfo: {} },
      });
      const sharedDepV2 = makeMockDep({
        pkgId: "shared-pkg",
        version: "2.0.0",
        name: "Shared",
        site: { components: [], projectDependencies: [], globalContexts: [], defaultComponents: {}, hostLessPackageInfo: {} },
      });

      const dep1 = makeMockDep({
        pkgId: "pkg-1",
        version: "1.0.0",
        name: "Package 1",
        site: { components: [], projectDependencies: [sharedDepV1], globalContexts: [], defaultComponents: {}, hostLessPackageInfo: {} },
      });
      const dep2 = makeMockDep({
        pkgId: "pkg-2",
        version: "1.0.0",
        name: "Package 2",
        site: { components: [], projectDependencies: [], globalContexts: [], defaultComponents: {}, hostLessPackageInfo: {} },
      });
      mockSession.site.projectDependencies = [dep1, dep2];

      // dep2's new version brings in shared-pkg v2.0.0 (conflicts with dep1's shared-pkg v1.0.0)
      const newDep2 = makeMockDep({
        pkgId: "pkg-2",
        version: "2.0.0",
        name: "Package 2",
        site: { components: [], projectDependencies: [sharedDepV2], globalContexts: [], defaultComponents: {}, hostLessPackageInfo: {} },
      });

      const client = makeMockApiClient({
        getPkgVersionMeta: vi.fn().mockResolvedValue({
          pkg: { id: "pv-2", pkgId: "pkg-2", version: "2.0.0" },
          depPkgs: [],
        }),
        getPkgVersion: vi.fn().mockResolvedValue({
          pkg: { id: "pv-2", pkgId: "pkg-2", version: "2.0.0", model: "{}" },
          depPkgs: [],
        }),
      });

      mockUnbundleProjectDependency.mockReturnValue({
        projectDependency: newDep2,
        depPkgs: [],
      });

      await expect(upgradePackage(client, "pkg-2")).rejects.toThrow(
        "conflicting dependencies"
      );
      // upgradeProjectDeps must NOT be called when conflict is detected
      expect(mockUpgradeProjectDeps).not.toHaveBeenCalled();
    });

    it("upgrades all outdated packages in batch mode", async () => {
      const dep1 = makeMockDep({ pkgId: "pkg-1", version: "1.0.0", name: "Package 1" });
      const dep2 = makeMockDep({ pkgId: "pkg-2", version: "1.0.0", name: "Package 2" });
      mockSession.site.projectDependencies = [dep1, dep2];

      const client = makeMockApiClient({
        getPkgVersionMeta: vi.fn()
          .mockResolvedValueOnce({ pkg: { id: "pv-1", pkgId: "pkg-1", version: "2.0.0" }, depPkgs: [] })
          .mockResolvedValueOnce({ pkg: { id: "pv-2", pkgId: "pkg-2", version: "3.0.0" }, depPkgs: [] }),
        getPkgVersion: vi.fn()
          .mockResolvedValueOnce({ pkg: { id: "pv-1", pkgId: "pkg-1", version: "2.0.0", model: "{}" }, depPkgs: [] })
          .mockResolvedValueOnce({ pkg: { id: "pv-2", pkgId: "pkg-2", version: "3.0.0", model: "{}" }, depPkgs: [] }),
      });

      const newDep1 = makeMockDep({ pkgId: "pkg-1", version: "2.0.0" });
      const newDep2 = makeMockDep({ pkgId: "pkg-2", version: "3.0.0" });
      mockUnbundleProjectDependency
        .mockReturnValueOnce({ projectDependency: newDep1, depPkgs: [] })
        .mockReturnValueOnce({ projectDependency: newDep2, depPkgs: [] });

      const results = await upgradePackage(client);

      expect(results).toHaveLength(2);
      expect(results[0].newVersion).toBe("2.0.0");
      expect(results[1].newVersion).toBe("3.0.0");
      expect(mockUpgradeProjectDeps).toHaveBeenCalledWith(
        mockSession.site,
        expect.arrayContaining([
          { oldDep: dep1, newDep: newDep1 },
          { oldDep: dep2, newDep: newDep2 },
        ])
      );
    });
  });

  // ========================================================================
  // list-available-packages
  // ========================================================================

  describe("listAvailablePackages", () => {
    it("returns catalog entries with isInstalled flags", async () => {
      // Dep "source-proj" is installed
      const dep = makeMockDep({ projectId: "source-proj" });
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient({
        getAppConfig: vi.fn().mockResolvedValue({
          config: {
            hostLessComponents: [
              {
                type: "hostless-package",
                name: "Commerce",
                sectionLabel: "Commerce",
                projectId: "source-proj",
                items: [
                  { type: "hostless-component", componentName: "ProductCard", displayName: "Product Card" },
                ],
              },
              {
                type: "hostless-package",
                name: "Analytics",
                sectionLabel: "Data",
                projectId: "other-proj",
                items: [
                  { type: "hostless-component", componentName: "Tracker", displayName: "Tracker" },
                ],
              },
            ],
          },
        }),
      });

      const result = await listAvailablePackages(client);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Commerce");
      expect(result[0].isInstalled).toBe(true);
      expect(result[0].items).toHaveLength(1);
      expect(result[0].items[0].componentName).toBe("ProductCard");
      expect(result[1].name).toBe("Analytics");
      expect(result[1].isInstalled).toBe(false);
    });

    it("returns empty array when app-config endpoint fails", async () => {
      const client = makeMockApiClient({
        getAppConfig: vi.fn().mockRejectedValue(new Error("Not found")),
      });

      const result = await listAvailablePackages(client);

      expect(result).toEqual([]);
    });

    it("excludes hidden packages and hidden items", async () => {
      const client = makeMockApiClient({
        getAppConfig: vi.fn().mockResolvedValue({
          config: {
            hostLessComponents: [
              {
                type: "hostless-package",
                name: "Visible",
                sectionLabel: "General",
                projectId: "vis-proj",
                items: [
                  { type: "hostless-component", componentName: "Comp1", displayName: "Comp 1" },
                  { type: "hostless-component", componentName: "Comp2", displayName: "Comp 2", hidden: true },
                ],
              },
              {
                type: "hostless-package",
                name: "Hidden",
                sectionLabel: "Hidden",
                projectId: "hid-proj",
                hidden: true,
                items: [],
              },
            ],
          },
        }),
      });

      const result = await listAvailablePackages(client);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Visible");
      expect(result[0].items).toHaveLength(1);
      expect(result[0].items[0].componentName).toBe("Comp1");
    });

    it("handles multi-projectId packages (array)", async () => {
      const dep = makeMockDep({ projectId: "proj-b" });
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient({
        getAppConfig: vi.fn().mockResolvedValue({
          config: {
            hostLessComponents: [
              {
                type: "hostless-package",
                name: "Multi",
                sectionLabel: "Multi",
                projectId: ["proj-a", "proj-b"],
                items: [],
              },
            ],
          },
        }),
      });

      const result = await listAvailablePackages(client);

      expect(result).toHaveLength(1);
      expect(result[0].isInstalled).toBe(true);
    });

    it("returns empty array when config has no hostLessComponents", async () => {
      const client = makeMockApiClient({
        getAppConfig: vi.fn().mockResolvedValue({ config: {} }),
      });

      const result = await listAvailablePackages(client);

      expect(result).toEqual([]);
    });
  });

  // ========================================================================
  // list-package-components
  // ========================================================================

  describe("listPackageComponents", () => {
    function makeHostLessDep(overrides: Record<string, any> = {}) {
      return makeMockDep({
        name: "Commerce",
        projectId: "commerce-proj",
        site: {
          components: [
            {
              name: "ProductCard",
              uuid: "comp-1",
              params: [
                {
                  variable: { name: "title" },
                  _type: "PropParam",
                  required: true,
                  description: "Product title",
                },
                {
                  variable: { name: "price" },
                  typeTag: "Num",
                  required: false,
                },
                {
                  variable: { name: "children" },
                  tplSlot: { _type: "TplSlot" },
                  _type: "SlotParam",
                },
                {
                  variable: { name: "onSale" },
                  _type: "BoolType",
                  defaultExpr: { _type: "CustomCode", code: "false" },
                },
                {
                  variable: { name: "dataPath" },
                  _type: "PropParam",
                  defaultExpr: { _type: "ObjectPath", path: ["$ctx", "products"] },
                },
              ],
              projectDependencies: [],
              globalContexts: [],
              defaultComponents: {},
              hostLessPackageInfo: {},
            },
          ],
          projectDependencies: [],
          globalContexts: [],
          defaultComponents: {},
          hostLessPackageInfo: {},
        },
        ...overrides,
      });
    }

    it("returns components with full prop schemas from installed packages", async () => {
      const dep = makeHostLessDep();
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient();
      const result = await listPackageComponents(client);

      expect(result).toHaveLength(1);
      expect(result[0].packageName).toBe("Commerce");
      expect(result[0].name).toBe("ProductCard");
      expect(result[0].props).toHaveLength(5);

      // title: PropParam, required, has description
      const titleProp = result[0].props.find((p: any) => p.name === "title");
      expect(titleProp).toEqual({
        name: "title",
        type: "PropParam",
        required: true,
        isSlot: false,
        description: "Product title",
      });

      // price: has typeTag "Num"
      const priceProp = result[0].props.find((p: any) => p.name === "price");
      expect(priceProp).toEqual({
        name: "price",
        type: "Num",
        required: false,
        isSlot: false,
      });

      // children: slot param
      const childrenProp = result[0].props.find((p: any) => p.name === "children");
      expect(childrenProp?.isSlot).toBe(true);
      expect(childrenProp?.type).toBe("slot");

      // onSale: has CustomCode defaultExpr
      const onSaleProp = result[0].props.find((p: any) => p.name === "onSale");
      expect(onSaleProp?.defaultValue).toBe("false");

      // dataPath: has ObjectPath defaultExpr
      const dataPathProp = result[0].props.find((p: any) => p.name === "dataPath");
      expect(dataPathProp?.defaultValue).toBe("$ctx.products");
    });

    it("filters by packageName (case-insensitive)", async () => {
      const dep1 = makeHostLessDep({ name: "Commerce", projectId: "proj-1" });
      const dep2 = makeHostLessDep({
        name: "Analytics",
        projectId: "proj-2",
        site: {
          components: [
            { name: "Tracker", uuid: "comp-2", params: [] },
          ],
          projectDependencies: [],
          globalContexts: [],
          defaultComponents: {},
          hostLessPackageInfo: {},
        },
      });
      mockSession.site.projectDependencies = [dep1, dep2];

      const client = makeMockApiClient();
      const result = await listPackageComponents(client, "commerce");

      expect(result).toHaveLength(1);
      expect(result[0].packageName).toBe("Commerce");
    });

    it("throws descriptive error for unknown packageName", async () => {
      const dep = makeHostLessDep();
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient();
      await expect(
        listPackageComponents(client, "Nonexistent")
      ).rejects.toThrow('Package "Nonexistent" is not installed');
    });

    it("returns empty array when no packages installed", async () => {
      const client = makeMockApiClient();
      const result = await listPackageComponents(client);
      expect(result).toEqual([]);
    });

    it("excludes non-reusable components", async () => {
      // isReusableComponent mock returns true by default.
      // Override to return false for frame components.
      mockIsReusableComponent.mockImplementation((c: any) => c.name !== "FrameComp");

      const dep = makeMockDep({
        name: "Mixed",
        projectId: "mixed-proj",
        site: {
          components: [
            { name: "Reusable", uuid: "c1", params: [] },
            { name: "FrameComp", uuid: "c2", params: [] },
          ],
          projectDependencies: [],
          globalContexts: [],
          defaultComponents: {},
          hostLessPackageInfo: {},
        },
      });
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient();
      const result = await listPackageComponents(client);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Reusable");
    });

    it("handles params with no type info (unknown type)", async () => {
      const dep = makeMockDep({
        name: "TestPkg",
        projectId: "test-proj",
        site: {
          components: [
            {
              name: "TestComp",
              uuid: "c1",
              params: [
                { variable: { name: "mystery" } },
              ],
            },
          ],
          projectDependencies: [],
          globalContexts: [],
          defaultComponents: {},
          hostLessPackageInfo: {},
        },
      });
      mockSession.site.projectDependencies = [dep];

      const client = makeMockApiClient();
      const result = await listPackageComponents(client);

      expect(result[0].props[0].type).toBe("unknown");
      expect(result[0].props[0].isSlot).toBe(false);
    });
  });
});
