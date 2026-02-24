/**
 * Unit tests for model-loader.ts
 *
 * The model loader bridges the Plasmic REST API and the in-memory editing model.
 * It must correctly parse bundles, narrow the unbundled result to a Site,
 * and initialize MobX before any model interaction. Failures here would make
 * every read tool return garbage, so these tests verify the core data pipeline.
 *
 * M2: loadProject now also returns revisionNum, modelVersion, and
 * hostlessDataVersion from the API response for incremental save support.
 */

jest.mock("mobx", () => ({
  configure: jest.fn(),
}));

import { loadProject } from "../model-loader";
import { mockUnbundle } from "../__mocks__/wab-bundler";
import type { PlasmicApiClient } from "../api-client";

describe("loadProject", () => {
  const mockGetProjectBundle = jest.fn();
  const mockApiClient = {
    getProjectBundle: mockGetProjectBundle,
  } as unknown as PlasmicApiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("initializes MobX with enforceActions: never", async () => {
    const mobx = require("mobx");
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Test" },
    });
    mockUnbundle.mockReturnValue(mockSite);

    await loadProject(mockApiClient, "proj1");

    expect(mobx.configure).toHaveBeenCalledWith({ enforceActions: "never" });
  });

  it("fetches bundle, unbundles, and returns a LoadedModel", async () => {
    const mockSite = {
      _type: "Site",
      components: [
        { name: "Page1", uuid: "u1" },
        { name: "Component1", uuid: "u2" },
      ],
    };

    mockGetProjectBundle.mockResolvedValue({
      rev: {
        data: JSON.stringify({ map: {}, root: "0" }),
        revision: 1,
      },
      project: { id: "proj1", name: "Test Project" },
    });
    mockUnbundle.mockReturnValue(mockSite);

    const result = await loadProject(mockApiClient, "proj1");

    expect(mockGetProjectBundle).toHaveBeenCalledWith("proj1");
    expect(result.site).toBe(mockSite);
    expect(result.projectName).toBe("Test Project");
    expect(result.bundler).toBeDefined();
  });

  it("extracts site from ProjectDependency result", async () => {
    const innerSite = { _type: "Site", components: [] };
    const mockDep = { _type: "ProjectDependency", site: innerSite };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Dep Project" },
    });
    mockUnbundle.mockReturnValue(mockDep);

    const result = await loadProject(mockApiClient, "proj1");

    expect(result.site).toBe(innerSite);
  });

  it("throws when unbundled result is neither Site nor ProjectDependency", async () => {
    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Bad" },
    });
    mockUnbundle.mockReturnValue({ _type: "UnexpectedType" });

    await expect(loadProject(mockApiClient, "proj1")).rejects.toThrow(
      "neither a Site nor a ProjectDependency"
    );
  });

  it("falls back to projectId when project.name is missing", async () => {
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      // project field may be undefined in edge cases
    });
    mockUnbundle.mockReturnValue(mockSite);

    const result = await loadProject(mockApiClient, "proj-fallback-id");

    expect(result.projectName).toBe("proj-fallback-id");
  });

  it("passes parsed bundle JSON to FastBundler.unbundle", async () => {
    const bundleData = { map: { "0": { __type: "Site" } }, root: "0" };
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify(bundleData), revision: 3 },
      project: { id: "proj1", name: "Test" },
    });
    mockUnbundle.mockReturnValue(mockSite);

    await loadProject(mockApiClient, "proj1");

    expect(mockUnbundle).toHaveBeenCalledWith(bundleData, "proj1");
  });

  // M2: revision tracking fields
  it("returns revisionNum from API response", async () => {
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 42 },
      project: { id: "proj1", name: "Test" },
    });
    mockUnbundle.mockReturnValue(mockSite);

    const result = await loadProject(mockApiClient, "proj1");

    expect(result.revisionNum).toBe(42);
  });

  it("returns modelVersion and hostlessDataVersion from API response", async () => {
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Test" },
      modelVersion: 7,
      hostlessDataVersion: 3,
    });
    mockUnbundle.mockReturnValue(mockSite);

    const result = await loadProject(mockApiClient, "proj1");

    expect(result.modelVersion).toBe(7);
    expect(result.hostlessDataVersion).toBe(3);
  });

  it("defaults modelVersion and hostlessDataVersion to 0 when missing", async () => {
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Test" },
      // modelVersion and hostlessDataVersion not present
    });
    mockUnbundle.mockReturnValue(mockSite);

    const result = await loadProject(mockApiClient, "proj1");

    expect(result.modelVersion).toBe(0);
    expect(result.hostlessDataVersion).toBe(0);
  });
});
