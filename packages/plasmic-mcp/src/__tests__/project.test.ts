/**
 * Project domain tests: save/undo integration.
 *
 * These tests exercise the project lifecycle behavior of edit-tools — specifically
 * how mutations interact with persistence (saveRevision) and error recovery
 * (auto-rollback on save failure). The edit-tool functions here (updateStyles,
 * updateText) are used only as convenient mutation triggers; the assertions focus
 * on revision tracking, undo-stack state, and rollback correctness.
 *
 * Extracted from edit-tools.test.ts (the "save integration" and
 * "error recovery: auto-rollback on save failure" describe blocks).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import { updateText, updateStyles } from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import { mockEnsureBaseVariantSetting } from "../__mocks__/wab-tpl-mgr";
import { mockUndoChanges } from "../__mocks__/wab-undo-util";
import { mockApiClient, makeSession, mkTag, mkComponent } from "./test-helpers";

describe("edit-tools", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();

    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });

    // mockWithRecording returns empty changes by default
    mockWithRecording.mockReturnValue({
      changes: [],
      newInsts: [],
      removedInsts: [],
    });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  // Helper to set up session + change tracker with a component
  function setupSession(component: any) {
    const session = makeSession({
      site: { components: [component] },
    });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  describe("save integration", () => {
    it("calls saveRevision after successful mutation", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { color: "red" });

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11,
        expect.objectContaining({ incremental: true })
      );
    });

    it("increments session revision after save", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      const session = setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { color: "red" });

      expect(session.revisionNum).toBe(11);
    });
  });

  describe("error recovery: auto-rollback on save failure", () => {
    it("rolls back model changes when updateStyles save fails", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      // Return non-empty changes so rollback has something to undo
      const fakeChanges = {
        changes: [{ changeNode: { inst: {}, field: "text" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      };
      mockWithRecording.mockReturnValue(fakeChanges);

      setupSession(comp);

      // Make save fail
      api.saveRevision.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow("Network error");

      // undoChanges should have been called to rollback
      expect(mockUndoChanges).toHaveBeenCalledWith(fakeChanges.changes);
    });

    it("rolls back model changes when updateText save fails", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Original",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      const fakeChanges = {
        changes: [{ changeNode: { inst: {}, field: "text" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      };
      mockWithRecording.mockReturnValue(fakeChanges);

      setupSession(comp);

      api.saveRevision.mockRejectedValueOnce(new Error("Save failed"));

      await expect(
        updateText(api, "comp-1", "Title", "New text")
      ).rejects.toThrow("Save failed");

      // undoChanges should have been called to rollback
      expect(mockUndoChanges).toHaveBeenCalledWith(fakeChanges.changes);
    });

    it("does not push to undo stack when save fails", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      setupSession(comp);

      // Clear undo stack before test to isolate from other tests
      const { getUndoDepth, clearUndoStack } = await import("../undo-manager");
      clearUndoStack();

      api.saveRevision.mockRejectedValueOnce(new Error("Server down"));

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow();

      expect(getUndoDepth()).toBe(0);
    });

    it("does not increment revision when save fails", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      const session = setupSession(comp);
      const originalRevision = session.revisionNum;
      api.saveRevision.mockRejectedValueOnce(new Error("Conflict"));

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow();

      expect(session.revisionNum).toBe(originalRevision);
    });

    it("subsequent mutation succeeds after failed save (no refresh needed)", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      setupSession(comp);

      // First call fails
      api.saveRevision.mockRejectedValueOnce(new Error("Temporary error"));
      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow("Temporary error");

      // Second call succeeds (no refresh-project needed)
      api.saveRevision.mockResolvedValueOnce({});
      const result = await updateStyles(api, "comp-1", "Box", { color: "blue" });
      expect(result.save.revisionNum).toBe(11);
    });

    it("validation errors do not accumulate in change tracker", async () => {
      const containerNode = mkTag({
        uuid: "container-1",
        name: "Container",
        children: [mkTag({ uuid: "child-1" })],
      });
      const root = mkTag({ uuid: "root-1", children: [containerNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      setupSession(comp);

      // updateText on a container should fail before any recording
      await expect(
        updateText(api, "comp-1", "Container", "text")
      ).rejects.toThrow("container");

      // No save should have been attempted
      expect(api.saveRevision).not.toHaveBeenCalled();
      // No undo should have been called (no changes to undo)
      expect(mockUndoChanges).not.toHaveBeenCalled();
    });

    it("reports rollback failure with refresh-project guidance", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      setupSession(comp);

      api.saveRevision.mockRejectedValueOnce(new Error("Save failed"));
      // Make undoChanges throw to simulate rollback failure
      mockUndoChanges.mockImplementationOnce(() => {
        throw new Error("Rollback crashed");
      });

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow("refresh-project");
    });
  });
});
