/**
 * Unit tests for save-manager.ts
 *
 * The save manager is the critical path between in-memory model mutations
 * and persistent storage. If it misconstructs the save request (wrong revision,
 * missing IIDs, incorrect bundle), edits are silently lost or corrupt the project.
 *
 * Tests verify:
 * - fastBundle is called with correct changed instances
 * - HTTP POST uses the right endpoint and body format
 * - Revision number is incremented on success
 * - 412 ProjectRevisionError reports conflict with guidance
 * - 412 UnknownReferencesError auto-retries with full bundle
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SaveManager } from "../save-manager";
import { setSession, clearSession } from "../session";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import { PlasmicApiError } from "../api-client";
import type { PlasmicApiClient } from "../api-client";
import type { Session } from "../session";

/** Create a mock API client with saveRevision spy */
function mockApiClient() {
  return {
    saveRevision: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn(),
    getProjectBundle: vi.fn(),
    updateProject: vi.fn(),
  } as unknown as PlasmicApiClient & { saveRevision: ReturnType<typeof vi.fn> };
}

/** Create a valid session for tests */
function makeSession(overrides?: Partial<Session>): Session {
  return {
    projectId: "proj1",
    projectName: "Test",
    site: { components: [] },
    bundler: {
      fastBundle: mockFastBundle,
      addrOf: mockAddrOf,
      bundle: vi.fn().mockReturnValue({ map: {}, root: "0", version: "256-test-version" }),
    },
    revisionNum: 10,
    modelVersion: 5,
    hostlessDataVersion: 2,
    bundleVersion: "256-test-version",
    projectUuid: "proj1",
    ...overrides,
  };
}

describe("SaveManager", () => {
  let api: ReturnType<typeof mockApiClient>;
  let saveManager: SaveManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    api = mockApiClient();
    saveManager = new SaveManager(api as any);
    mockFastBundle.mockReturnValue({ map: { "1": { __type: "Site" } }, root: "0" });
  });

  afterEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  describe("saveChanges", () => {
    it("calls fastBundle with changed instances and posts to save endpoint", async () => {
      const session = makeSession();
      setSession(session);

      const changes = {
        changes: [
          { changeNode: { inst: { id: "inst1" }, field: "text" } },
          { changeNode: { inst: { id: "inst2" }, field: "children" } },
        ],
        newInsts: [],
        removedInsts: [],
      };

      const result = await saveManager.saveChanges(changes as any);

      // fastBundle called with site, projectId, and changed instances
      expect(mockFastBundle).toHaveBeenCalledWith(
        session.site,
        "proj1",
        [
          { inst: { id: "inst1" }, field: "text" },
          { inst: { id: "inst2" }, field: "children" },
        ]
      );

      // saveRevision called with correct endpoint params
      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11, // revisionNum + 1
        expect.objectContaining({
          incremental: true,
          modelVersion: 5,
          hostlessDataVersion: 2,
          toDeleteIids: [],
          modifiedComponentIids: [],
        })
      );

      expect(result.revisionNum).toBe(11);
      expect(result.incremental).toBe(true);
    });

    it("increments session revisionNum on success", async () => {
      const session = makeSession({ revisionNum: 20 });
      setSession(session);

      await saveManager.saveChanges({
        changes: [],
        newInsts: [],
        removedInsts: [],
      } as any);

      expect(session.revisionNum).toBe(21);
    });

    it("computes toDeleteIids from removed instances", async () => {
      const removedInst = { id: "removed-1" };
      mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "iid-42" });

      setSession(makeSession());

      await saveManager.saveChanges({
        changes: [],
        newInsts: [],
        removedInsts: [removedInst],
      } as any);

      expect(mockAddrOf).toHaveBeenCalledWith(removedInst);
      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11,
        expect.objectContaining({
          toDeleteIids: ["iid-42"],
        })
      );
    });

    it("passes modifiedComponentIids when provided", async () => {
      setSession(makeSession());

      await saveManager.saveChanges(
        { changes: [], newInsts: [], removedInsts: [] } as any,
        ["comp-iid-1", "comp-iid-2"]
      );

      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11,
        expect.objectContaining({
          modifiedComponentIids: ["comp-iid-1", "comp-iid-2"],
        })
      );
    });

    it("serializes bundle data as JSON string", async () => {
      const mockBundle = { map: { "5": { __type: "TplTag" } }, root: "5" };
      mockFastBundle.mockReturnValue(mockBundle);
      setSession(makeSession());

      await saveManager.saveChanges({
        changes: [{ changeNode: { inst: {}, field: "x" } }],
        newInsts: [],
        removedInsts: [],
      } as any);

      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11,
        expect.objectContaining({
          data: JSON.stringify(mockBundle),
        })
      );
    });

    it("throws session error when no project loaded", async () => {
      clearSession();

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow("No active project");
    });
  });

  describe("412 error handling", () => {
    it("throws conflict error on ProjectRevisionError", async () => {
      setSession(makeSession());

      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Stale revision", 412, "ProjectRevisionError")
      );

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow("Save conflict");
    });

    it("conflict error suggests refresh-project", async () => {
      setSession(makeSession());

      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Stale revision", 412, "ProjectRevisionError")
      );

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow("refresh-project");
    });

    it("auto-retries with full bundle on UnknownReferencesError", async () => {
      const session = makeSession();
      setSession(session);

      // First call (incremental) fails with UnknownReferencesError
      // Second call (full bundle) succeeds
      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Unknown refs", 412, "UnknownReferencesError")
        )
        .mockResolvedValueOnce({});

      const result = await saveManager.saveChanges({
        changes: [{ changeNode: { inst: {}, field: "text" } }],
        newInsts: [],
        removedInsts: [],
      } as any);

      // Should have been called twice: once incremental, once full
      expect(api.saveRevision).toHaveBeenCalledTimes(2);

      // Second call should be non-incremental
      const secondCall = (api.saveRevision as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall[2].incremental).toBe(false);

      expect(result.incremental).toBe(false);
    });

    it("does not increment revision on conflict error", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Conflict", 412, "ProjectRevisionError")
      );

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow();

      // Revision should not have been incremented
      expect(session.revisionNum).toBe(10);
    });
  });

  describe("saveFullBundle", () => {
    it("saves with incremental: false", async () => {
      setSession(makeSession());

      const result = await saveManager.saveFullBundle();

      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11,
        expect.objectContaining({
          incremental: false,
          toDeleteIids: [],
          modifiedComponentIids: [],
        })
      );
      expect(result.incremental).toBe(false);
    });

    it("passes bundleVersion to bundler.bundle()", async () => {
      const session = makeSession({ bundleVersion: "256-wrap-page-meta-og-image-in-ref" });
      setSession(session);

      await saveManager.saveFullBundle();

      // bundler.bundle() must be called with (site, projectId, bundleVersion)
      // matching Studio's StudioCtx.bundleChanges() which passes appCtx.lastBundleVersion
      expect(session.bundler.bundle).toHaveBeenCalledWith(
        session.site,
        "proj1",
        "256-wrap-page-meta-og-image-in-ref"
      );
    });
  });
});
