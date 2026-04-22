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
 * - 412 ProjectRevisionError auto-rebases + retries when rebaseOnConflict provided (P2.3)
 * - Rebase failure produces detailed error with both conflict and rebase failure reasons
 * - isSaving flag lifecycle across rebase + retry
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SaveManager, isSaving } from "../save-manager";
import { setSession, clearSession } from "../session";
import {
  mockFastBundle,
  mockAddrOf,
  mockCachedBundle,
  mockCheckExistingReferences,
  mockCheckRefsInBundle,
} from "../__mocks__/wab-bundler";
import { mockAssertSiteInvariants } from "../__mocks__/wab-site-invariants";
import { PlasmicApiError } from "../api-client";
import type { PlasmicApiClient } from "../api-client";
import type { Session } from "../session";

/** Create a mock API client with saveRevision and getLastBundleVersion spies */
function mockApiClient() {
  return {
    saveRevision: vi.fn().mockResolvedValue({}),
    getLastBundleVersion: vi.fn().mockResolvedValue("256-fresh-version"),
    listProjects: vi.fn(),
    getProjectBundle: vi.fn(),
    updateProject: vi.fn(),
  } as unknown as PlasmicApiClient & {
    saveRevision: ReturnType<typeof vi.fn>;
    getLastBundleVersion: ReturnType<typeof vi.fn>;
  };
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
      cachedBundle: mockCachedBundle,
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
        }),
        undefined
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
        }),
        undefined
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
        }),
        undefined
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
        }),
        undefined
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

  // Pre-save bundle validation wires three shared Studio validators into the
  // save path — `assertSiteInvariants`, `checkExistingReferences`,
  // `checkRefsInBundle`. When any of them throws, the save manager must refuse
  // to persist the bundle and surface a "Pre-save bundle validation failed"
  // error. These tests prove that wiring: when a validator throws, the error
  // reaches the caller with the expected prefix and the original message, and
  // `saveRevision` is never called. Without the wiring, a corrupt bundle would
  // reach the server (gap #71).
  describe("pre-save bundle validation", () => {
    it("surfaces assertSiteInvariants errors and skips saveRevision", async () => {
      setSession(makeSession());
      mockCachedBundle.mockReturnValue({ map: {}, root: "0", deps: [] });
      mockAssertSiteInvariants.mockImplementation(() => {
        throw new Error("Duplicated component name: Foo");
      });

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow(
        /Pre-save bundle validation failed: Duplicated component name: Foo/
      );
      expect(api.saveRevision).not.toHaveBeenCalled();
    });

    it("surfaces checkExistingReferences errors and skips saveRevision", async () => {
      setSession(makeSession());
      mockCachedBundle.mockReturnValue({
        map: { "0": { __type: "Site" } },
        root: "0",
        deps: [],
      });
      mockCheckExistingReferences.mockImplementation(() => {
        throw new Error("Missing reference (IID ghost-iid)");
      });

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow(
        /Pre-save bundle validation failed: Missing reference \(IID ghost-iid\)/
      );
      expect(api.saveRevision).not.toHaveBeenCalled();
    });

    it("surfaces checkRefsInBundle errors and skips saveRevision", async () => {
      setSession(makeSession());
      mockCachedBundle.mockReturnValue({
        map: { "0": { __type: "Site" } },
        root: "0",
        deps: [],
      });
      mockCheckRefsInBundle.mockImplementation(() => {
        throw new Error("Unreachable instance has weak refs");
      });

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow(
        /Pre-save bundle validation failed: Unreachable instance has weak refs/
      );
      expect(api.saveRevision).not.toHaveBeenCalled();
    });

    it("includes recovery guidance pointing to refresh-project and gap #71", async () => {
      setSession(makeSession());
      mockCachedBundle.mockReturnValue({ map: {}, root: "0", deps: [] });
      mockAssertSiteInvariants.mockImplementation(() => {
        throw new Error("invariant broken");
      });

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow(/refresh-project/);
      await expect(
        (async () => {
          mockAssertSiteInvariants.mockImplementation(() => {
            throw new Error("invariant broken");
          });
          return saveManager.saveChanges({
            changes: [],
            newInsts: [],
            removedInsts: [],
          } as any);
        })()
      ).rejects.toThrow(/gap #71/);
    });

    it("saves normally when all three validators pass", async () => {
      setSession(makeSession());
      mockCachedBundle.mockReturnValue({ map: {}, root: "0", deps: [] });
      // No validator throws — save must proceed.
      const result = await saveManager.saveChanges({
        changes: [],
        newInsts: [],
        removedInsts: [],
      } as any);

      expect(result.revisionNum).toBe(11);
      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(mockAssertSiteInvariants).toHaveBeenCalled();
      expect(mockCheckExistingReferences).toHaveBeenCalled();
      expect(mockCheckRefsInBundle).toHaveBeenCalled();
    });

    it("skips bundle-level validators when bundler lacks cachedBundle", async () => {
      // Some bundler variants (pre-P0.0) don't expose cachedBundle. Verify
      // the save-manager tolerates that without throwing, and still runs
      // the site-level invariant check.
      const session = makeSession();
      (session.bundler as any).cachedBundle = undefined;
      setSession(session);

      const result = await saveManager.saveChanges({
        changes: [],
        newInsts: [],
        removedInsts: [],
      } as any);

      expect(result.revisionNum).toBe(11);
      expect(mockAssertSiteInvariants).toHaveBeenCalled();
      expect(mockCheckExistingReferences).not.toHaveBeenCalled();
      expect(mockCheckRefsInBundle).not.toHaveBeenCalled();
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

  // Mirrors the saveChanges pre-save tests above — `saveFullBundle` runs the
  // same three validators, so its wiring must also refuse a corrupt bundle.
  describe("saveFullBundle pre-save validation", () => {
    it("surfaces assertSiteInvariants errors and skips saveRevision", async () => {
      setSession(makeSession());
      mockCachedBundle.mockReturnValue({ map: {}, root: "0", deps: [] });
      mockAssertSiteInvariants.mockImplementation(() => {
        throw new Error("site broken");
      });

      await expect(saveManager.saveFullBundle()).rejects.toThrow(
        /Pre-save bundle validation failed: site broken/
      );
      expect(api.saveRevision).not.toHaveBeenCalled();
    });

    it("surfaces checkExistingReferences errors and skips saveRevision", async () => {
      setSession(makeSession());
      mockCachedBundle.mockReturnValue({ map: {}, root: "0", deps: [] });
      mockCheckExistingReferences.mockImplementation(() => {
        throw new Error("dangling __ref");
      });

      await expect(saveManager.saveFullBundle()).rejects.toThrow(
        /Pre-save bundle validation failed: dangling __ref/
      );
      expect(api.saveRevision).not.toHaveBeenCalled();
    });

    it("surfaces checkRefsInBundle errors and skips saveRevision", async () => {
      setSession(makeSession());
      mockCachedBundle.mockReturnValue({ map: {}, root: "0", deps: [] });
      mockCheckRefsInBundle.mockImplementation(() => {
        throw new Error("weak ref to unreachable");
      });

      await expect(saveManager.saveFullBundle()).rejects.toThrow(
        /Pre-save bundle validation failed: weak ref to unreachable/
      );
      expect(api.saveRevision).not.toHaveBeenCalled();
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
        }),
        undefined
      );
      expect(result.incremental).toBe(false);
    });

    it("passes bundleVersion to bundler.bundle()", async () => {
      const session = makeSession({ bundleVersion: "256-wrap-page-meta-og-image-in-ref" });
      setSession(session);

      await saveManager.saveFullBundle();

      // bundler.bundle() must be called with (site, projectId, freshBundleVersion)
      // The fresh version comes from getLastBundleVersion(), not the session's stale value
      expect(session.bundler.bundle).toHaveBeenCalledWith(
        session.site,
        "proj1",
        "256-fresh-version"
      );
    });

    it("re-fetches bundleVersion from server before saving", async () => {
      setSession(makeSession());

      await saveManager.saveFullBundle();

      expect(api.getLastBundleVersion).toHaveBeenCalledTimes(1);
    });

    it("updates session.bundleVersion with fresh value from server", async () => {
      const session = makeSession({ bundleVersion: "255-old-version" });
      setSession(session);
      api.getLastBundleVersion = vi.fn().mockResolvedValue("256-new-version");

      await saveManager.saveFullBundle();

      expect(session.bundleVersion).toBe("256-new-version");
    });

    it("rejects when re-fetched bundleVersion is empty", async () => {
      setSession(makeSession());
      api.getLastBundleVersion = vi.fn().mockResolvedValue("");

      await expect(saveManager.saveFullBundle()).rejects.toThrow(
        "Failed to get a valid bundle version"
      );
    });

    it("handles SchemaMismatchError with user-friendly message", async () => {
      setSession(makeSession());
      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Schema mismatch", 412, "SchemaMismatchError")
      );

      await expect(saveManager.saveFullBundle()).rejects.toThrow(
        "Schema mismatch"
      );
      await expect(saveManager.saveFullBundle()).rejects.toThrow(
        "refresh-project"
      );
    });

    it("handles ProjectRevisionError with conflict guidance", async () => {
      setSession(makeSession());
      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Stale revision", 412, "ProjectRevisionError")
      );

      await expect(saveManager.saveFullBundle()).rejects.toThrow(
        "Save conflict"
      );
      await expect(saveManager.saveFullBundle()).rejects.toThrow(
        "refresh-project"
      );
    });
  });

  describe("SchemaMismatchError handling in saveChanges", () => {
    it("throws user-friendly error on SchemaMismatchError", async () => {
      setSession(makeSession());
      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Schema mismatch", 412, "SchemaMismatchError")
      );

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow("Schema mismatch");
    });

    it("SchemaMismatchError suggests refresh-project", async () => {
      setSession(makeSession());
      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Schema mismatch", 412, "SchemaMismatchError")
      );

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow("refresh-project");
    });
  });

  describe("isSaving flag", () => {
    it("is false by default", () => {
      expect(isSaving()).toBe(false);
    });

    it("is true during save and false after", async () => {
      const session = makeSession();
      setSession(session);

      let savedDuringSave = false;
      api.saveRevision = vi.fn().mockImplementation(async () => {
        savedDuringSave = isSaving();
        return {};
      });

      await saveManager.saveChanges({
        changes: [],
        newInsts: [],
        removedInsts: [],
      } as any);

      expect(savedDuringSave).toBe(true);
      expect(isSaving()).toBe(false);
    });

    it("is false after save failure", async () => {
      setSession(makeSession());
      api.saveRevision = vi.fn().mockRejectedValue(new Error("network error"));

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow("network error");

      expect(isSaving()).toBe(false);
    });
  });

  describe("pendingSavedRevisionNum tracking", () => {
    it("sets pendingSavedRevisionNum before save", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      let revDuringSave: number | undefined;
      api.saveRevision = vi.fn().mockImplementation(async () => {
        revDuringSave = session.pendingSavedRevisionNum;
        return {};
      });

      await saveManager.saveChanges({
        changes: [],
        newInsts: [],
        removedInsts: [],
      } as any);

      expect(revDuringSave).toBe(11); // revisionNum + 1
    });
  });

  // --- P2.3: Auto-rebase on 412 ProjectRevisionError ---

  describe("rebaseOnConflict: ProjectRevisionError auto-retry", () => {
    const emptyChanges = { changes: [], newInsts: [], removedInsts: [] } as any;

    it("rebases and retries with full bundle on ProjectRevisionError", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      const rebaseOnConflict = vi.fn().mockImplementation(async () => {
        // Simulate rebase: session revision advances to server's latest
        session.revisionNum = 15;
      });

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      // First call (incremental) fails with ProjectRevisionError
      // Second call (full bundle retry) succeeds
      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Stale revision", 412, "ProjectRevisionError")
        )
        .mockResolvedValueOnce({});

      const result = await mgr.saveChanges(emptyChanges);

      expect(rebaseOnConflict).toHaveBeenCalledTimes(1);
      expect(api.saveRevision).toHaveBeenCalledTimes(2);

      // Retry should be a full bundle save (non-incremental)
      const retryCall = (api.saveRevision as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(retryCall[2].incremental).toBe(false);

      // Result reflects the full bundle retry
      expect(result.incremental).toBe(false);
    });

    it("uses updated revision number after rebase for retry", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      const rebaseOnConflict = vi.fn().mockImplementation(async () => {
        session.revisionNum = 25; // Server is at 25
      });

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Stale", 412, "ProjectRevisionError")
        )
        .mockResolvedValueOnce({});

      await mgr.saveChanges(emptyChanges);

      // Retry should use revisionNum 26 (25 + 1), not 11 (10 + 1)
      const retryCall = (api.saveRevision as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(retryCall[1]).toBe(26);
    });

    it("updates session revision after successful retry", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      const rebaseOnConflict = vi.fn().mockImplementation(async () => {
        session.revisionNum = 20;
      });

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Stale", 412, "ProjectRevisionError")
        )
        .mockResolvedValueOnce({});

      await mgr.saveChanges(emptyChanges);

      // Session revision should be 21 (20 after rebase + 1 from retry save)
      expect(session.revisionNum).toBe(21);
    });

    it("throws detailed error when rebase fails", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      const rebaseOnConflict = vi.fn().mockRejectedValue(
        new Error("server requires full reload")
      );

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Stale", 412, "ProjectRevisionError")
      );

      await expect(mgr.saveChanges(emptyChanges)).rejects.toThrow(
        "Save conflict"
      );
      await expect(mgr.saveChanges(emptyChanges)).rejects.toThrow(
        "Auto-rebase failed"
      );
      await expect(mgr.saveChanges(emptyChanges)).rejects.toThrow(
        "server requires full reload"
      );
    });

    it("throws detailed error when retry save also fails", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      const rebaseOnConflict = vi.fn().mockImplementation(async () => {
        session.revisionNum = 15;
      });

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      // Both incremental and full bundle saves fail with ProjectRevisionError
      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Stale", 412, "ProjectRevisionError")
      );

      // The retry's saveFullBundle also throws ProjectRevisionError
      // which bubbles up as a regular "Save conflict" error (no second retry)
      await expect(mgr.saveChanges(emptyChanges)).rejects.toThrow(
        "Save conflict"
      );
    });

    it("does not rebase without rebaseOnConflict callback", async () => {
      setSession(makeSession());

      // SaveManager without rebaseOnConflict (backward compatible)
      const mgr = new SaveManager(api as any);

      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Stale", 412, "ProjectRevisionError")
      );

      await expect(mgr.saveChanges(emptyChanges)).rejects.toThrow(
        "Save conflict"
      );

      // Only one save attempt — no retry
      expect(api.saveRevision).toHaveBeenCalledTimes(1);
    });

    it("does not rebase on SchemaMismatchError even with callback", async () => {
      setSession(makeSession());

      const rebaseOnConflict = vi.fn();
      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Schema mismatch", 412, "SchemaMismatchError")
      );

      await expect(mgr.saveChanges(emptyChanges)).rejects.toThrow(
        "Schema mismatch"
      );

      // Rebase should NOT be called for schema errors
      expect(rebaseOnConflict).not.toHaveBeenCalled();
    });

    it("does not rebase on UnknownReferencesError (uses full bundle instead)", async () => {
      setSession(makeSession());

      const rebaseOnConflict = vi.fn();
      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Unknown refs", 412, "UnknownReferencesError")
        )
        .mockResolvedValueOnce({});

      await mgr.saveChanges(emptyChanges);

      // Rebase should NOT be called — UnknownReferencesError uses full bundle retry
      expect(rebaseOnConflict).not.toHaveBeenCalled();
      expect(api.saveRevision).toHaveBeenCalledTimes(2);
    });

    it("logs rebase attempt on conflict", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      const rebaseOnConflict = vi.fn().mockImplementation(async () => {
        session.revisionNum = 15;
      });

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Stale", 412, "ProjectRevisionError")
        )
        .mockResolvedValueOnce({});

      await mgr.saveChanges(emptyChanges);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("ProjectRevisionError on incremental save, attempting rebase")
      );
    });

    it("logs rebase failure details", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      const rebaseOnConflict = vi.fn().mockRejectedValue(
        new Error("network timeout during rebase")
      );

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Stale", 412, "ProjectRevisionError")
      );

      await expect(mgr.saveChanges(emptyChanges)).rejects.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Rebase after conflict failed")
      );
    });
  });

  describe("isSaving flag during rebase retry", () => {
    it("remains true during rebase callback", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      let savingDuringRebase = false;
      const rebaseOnConflict = vi.fn().mockImplementation(async () => {
        savingDuringRebase = isSaving();
        session.revisionNum = 15;
      });

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Stale", 412, "ProjectRevisionError")
        )
        .mockResolvedValueOnce({});

      await mgr.saveChanges({
        changes: [],
        newInsts: [],
        removedInsts: [],
      } as any);

      // isSaving should have been true during the rebase callback
      expect(savingDuringRebase).toBe(true);
    });

    it("is false after rebase + retry completes", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      const rebaseOnConflict = vi.fn().mockImplementation(async () => {
        session.revisionNum = 15;
      });

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Stale", 412, "ProjectRevisionError")
        )
        .mockResolvedValueOnce({});

      await mgr.saveChanges({
        changes: [],
        newInsts: [],
        removedInsts: [],
      } as any);

      expect(isSaving()).toBe(false);
    });

    it("is false after rebase failure", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      const rebaseOnConflict = vi.fn().mockRejectedValue(
        new Error("rebase exploded")
      );

      const mgr = new SaveManager(api as any, { rebaseOnConflict });

      api.saveRevision = vi.fn().mockRejectedValue(
        new PlasmicApiError("Stale", 412, "ProjectRevisionError")
      );

      await expect(
        mgr.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow();

      expect(isSaving()).toBe(false);
    });
  });

  describe("UnknownReferencesError full bundle retry (detailed)", () => {
    it("re-fetches bundleVersion from server for full bundle retry", async () => {
      setSession(makeSession());

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Unknown refs", 412, "UnknownReferencesError")
        )
        .mockResolvedValueOnce({});

      await saveManager.saveChanges({
        changes: [{ changeNode: { inst: {}, field: "x" } }],
        newInsts: [],
        removedInsts: [],
      } as any);

      // getLastBundleVersion should have been called for the full bundle fallback
      expect(api.getLastBundleVersion).toHaveBeenCalledTimes(1);
    });

    it("uses fresh bundleVersion in the full bundle retry", async () => {
      const session = makeSession({ bundleVersion: "255-old" });
      setSession(session);
      api.getLastBundleVersion = vi.fn().mockResolvedValue("256-server-fresh");

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Unknown refs", 412, "UnknownReferencesError")
        )
        .mockResolvedValueOnce({});

      await saveManager.saveChanges({
        changes: [{ changeNode: { inst: {}, field: "x" } }],
        newInsts: [],
        removedInsts: [],
      } as any);

      // bundler.bundle should have received the fresh version
      expect(session.bundler.bundle).toHaveBeenCalledWith(
        session.site,
        "proj1",
        "256-server-fresh"
      );
    });

    it("updates session.bundleVersion after successful retry", async () => {
      const session = makeSession({ bundleVersion: "255-old" });
      setSession(session);
      api.getLastBundleVersion = vi.fn().mockResolvedValue("256-new");

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Unknown refs", 412, "UnknownReferencesError")
        )
        .mockResolvedValueOnce({});

      await saveManager.saveChanges({
        changes: [{ changeNode: { inst: {}, field: "x" } }],
        newInsts: [],
        removedInsts: [],
      } as any);

      expect(session.bundleVersion).toBe("256-new");
    });

    it("increments revision after successful retry", async () => {
      const session = makeSession({ revisionNum: 10 });
      setSession(session);

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Unknown refs", 412, "UnknownReferencesError")
        )
        .mockResolvedValueOnce({});

      await saveManager.saveChanges({
        changes: [{ changeNode: { inst: {}, field: "x" } }],
        newInsts: [],
        removedInsts: [],
      } as any);

      expect(session.revisionNum).toBe(11);
    });

    it("propagates error when full bundle retry also fails", async () => {
      setSession(makeSession());

      api.saveRevision = vi.fn()
        .mockRejectedValueOnce(
          new PlasmicApiError("Unknown refs", 412, "UnknownReferencesError")
        )
        .mockRejectedValueOnce(new Error("Full bundle also failed"));

      await expect(
        saveManager.saveChanges({
          changes: [{ changeNode: { inst: {}, field: "x" } }],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toThrow("Full bundle also failed");
    });
  });

  describe("non-412 error passthrough", () => {
    it("rethrows non-PlasmicApiError errors unchanged", async () => {
      setSession(makeSession());

      const originalError = new Error("Internal server error");
      api.saveRevision = vi.fn().mockRejectedValue(originalError);

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toBe(originalError);
    });

    it("rethrows non-412 PlasmicApiError unchanged", async () => {
      setSession(makeSession());

      const apiError = new PlasmicApiError("Not found", 404, "NotFoundError");
      api.saveRevision = vi.fn().mockRejectedValue(apiError);

      await expect(
        saveManager.saveChanges({
          changes: [],
          newInsts: [],
          removedInsts: [],
        } as any)
      ).rejects.toBe(apiError);
    });
  });
});
