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

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("mobx", () => ({
  configure: vi.fn(),
}));

import { loadProject } from "../model-loader";
import { mockUnbundle } from "../__mocks__/wab-bundler";
import type { PlasmicApiClient } from "../api-client";

describe("loadProject", () => {
  const mockGetProjectBundle = vi.fn();
  const mockGetLastBundleVersion = vi.fn().mockResolvedValue("256-test-version");
  const mockApiClient = {
    getProjectBundle: mockGetProjectBundle,
    getLastBundleVersion: mockGetLastBundleVersion,
  } as unknown as PlasmicApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default mock return value after clearAllMocks resets it
    mockGetLastBundleVersion.mockResolvedValue("256-test-version");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes MobX with enforceActions: never", async () => {
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Test" },
    });
    mockUnbundle.mockReturnValue(mockSite);

    await loadProject(mockApiClient, "proj1");

    // initMobx() logs when it runs — verify it was called
    expect(console.error).toHaveBeenCalledWith(
      "[plasmic-mcp] MobX initialized (enforceActions: never)"
    );
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

  // P31: PLASMIC_DEV_HOST_URL env var fallback
  it("returns hostUrl from project settings when available", async () => {
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Test", hostUrl: "http://localhost:3001" },
    });
    mockUnbundle.mockReturnValue(mockSite);

    const result = await loadProject(mockApiClient, "proj1");

    expect(result.hostUrl).toBe("http://localhost:3001");
  });

  it("falls back to PLASMIC_DEV_HOST_URL env var when project has no hostUrl", async () => {
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Test" },
      // no hostUrl in project settings
    });
    mockUnbundle.mockReturnValue(mockSite);

    const original = process.env.PLASMIC_DEV_HOST_URL;
    try {
      process.env.PLASMIC_DEV_HOST_URL = "http://localhost:4000";
      const result = await loadProject(mockApiClient, "proj1");
      expect(result.hostUrl).toBe("http://localhost:4000");
    } finally {
      if (original === undefined) {
        delete process.env.PLASMIC_DEV_HOST_URL;
      } else {
        process.env.PLASMIC_DEV_HOST_URL = original;
      }
    }
  });

  it("prefers project hostUrl over PLASMIC_DEV_HOST_URL env var", async () => {
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Test", hostUrl: "http://from-project:3001" },
    });
    mockUnbundle.mockReturnValue(mockSite);

    const original = process.env.PLASMIC_DEV_HOST_URL;
    try {
      process.env.PLASMIC_DEV_HOST_URL = "http://from-env:4000";
      const result = await loadProject(mockApiClient, "proj1");
      expect(result.hostUrl).toBe("http://from-project:3001");
    } finally {
      if (original === undefined) {
        delete process.env.PLASMIC_DEV_HOST_URL;
      } else {
        process.env.PLASMIC_DEV_HOST_URL = original;
      }
    }
  });

  it("returns undefined hostUrl when neither project nor env var provides one", async () => {
    const mockSite = { _type: "Site", components: [] };

    mockGetProjectBundle.mockResolvedValue({
      rev: { data: JSON.stringify({}), revision: 1 },
      project: { id: "proj1", name: "Test" },
    });
    mockUnbundle.mockReturnValue(mockSite);

    const original = process.env.PLASMIC_DEV_HOST_URL;
    try {
      delete process.env.PLASMIC_DEV_HOST_URL;
      const result = await loadProject(mockApiClient, "proj1");
      expect(result.hostUrl).toBeUndefined();
    } finally {
      if (original !== undefined) {
        process.env.PLASMIC_DEV_HOST_URL = original;
      }
    }
  });
});
