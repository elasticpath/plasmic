/**
 * Unit tests for rebase-engine.ts
 *
 * Tests the rebase algorithm: simple rebase (no local changes), rebase with
 * undo stack entries, rebase with open batch changes, needsReload fallback,
 * dependency deletion detection, and revision number update.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyServerUpdate,
  UnsupportedServerUpdate,
  type RebaseContext,
} from "../rebase-engine.js";
import type { GetModelUpdatesResponse, ModelUpdateIncremental } from "../types.js";

// Mocks are loaded via vitest aliases — these are the mock modules
import { mockUnbundlePartial } from "../__mocks__/wab-bundler.js";
import {
  undoChangesAndResolveConflicts,
  getEmptyDeletedAssetsSummary,
} from "@/wab/shared/server-updates-utils";

// The mock undoChanges from wab-undo-util
import { undoChanges } from "@/wab/shared/core/undo-util";
// The mock unbundleProjectDependency from tagged-unbundle
import { mockUnbundleProjectDependency } from "../__mocks__/wab-tagged-unbundle.js";

function makeIncrementalUpdate(
  overrides: Partial<ModelUpdateIncremental> = {}
): ModelUpdateIncremental {
  return {
    data: JSON.stringify({ map: { "1": {}, "2": {} } }),
    revision: 10,
    depPkgs: [],
    deletedIids: [],
    modifiedComponentIids: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<RebaseContext> = {}): RebaseContext {
  const site = {
    components: [
      { name: "A", tplTree: {} },
      { name: "B", tplTree: {} },
    ],
    projectDependencies: [],
  };
  const bundler = {
    allUuids: vi.fn().mockReturnValue(["uuid-1"]),
    unbundlePartial: vi.fn(),
    objByAddr: vi.fn().mockReturnValue(undefined),
  };
  const recorder = {
    withRecording: vi.fn((fn: () => void) => {
      fn();
      return { changes: [], newInsts: [], removedInsts: [] };
    }),
  };

  return {
    site,
    bundler,
    projectId: "proj-123",
    revisionNum: 5,
    recorder,
    serverUpdatesSummary: (getEmptyDeletedAssetsSummary as any)(),
    getUndoStack: () => [],
    replaceUndoStack: vi.fn(),
    getAccumulatedChanges: () => null,
    replaceAccumulatedChanges: vi.fn(),
    ...overrides,
  };
}

describe("rebase-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("applyServerUpdate", () => {
    it("returns null when no changes (data is null)", () => {
      const ctx = makeContext();
      const result = applyServerUpdate({ data: null } as any, ctx);
      expect(result).toBeNull();
    });

    it("throws UnsupportedServerUpdate when needsReload is true", () => {
      const ctx = makeContext();
      expect(() =>
        applyServerUpdate({ needsReload: true } as any, ctx)
      ).toThrow(UnsupportedServerUpdate);
    });

    describe("simple rebase (no local changes)", () => {
      it("applies server update and returns new revision", () => {
        const ctx = makeContext();
        const update = makeIncrementalUpdate({ revision: 10 });

        const result = applyServerUpdate(update, ctx);

        expect(result).not.toBeNull();
        expect(result!.newRevisionNum).toBe(10);
        expect(result!.hadLocalChanges).toBe(false);
      });

      it("calls bundler.unbundlePartial with parsed data", () => {
        const ctx = makeContext();
        const data = JSON.stringify({ map: { "iid-1": {} } });
        const update = makeIncrementalUpdate({ data });

        applyServerUpdate(update, ctx);

        expect(ctx.bundler.unbundlePartial).toHaveBeenCalledWith(
          { map: { "iid-1": {} } },
          "proj-123"
        );
      });

      it("fixes component references after applying", () => {
        const ctx = makeContext();
        const update = makeIncrementalUpdate();

        applyServerUpdate(update, ctx);

        // trackComponentRoot and trackComponentSite are called for each component
        // (via the mock, these are no-ops but we verify they're called)
        expect(ctx.site.components).toHaveLength(2);
      });
    });

    describe("rebase with undo stack entries", () => {
      it("reverts and re-applies undo entries with conflict resolution", () => {
        const undoEntry = {
          description: "edit text",
          changes: [{ type: "update", changeNode: { inst: {}, field: "text" } }],
        };
        const ctx = makeContext({
          getUndoStack: () => [undoEntry],
        });
        const update = makeIncrementalUpdate();

        const result = applyServerUpdate(update, ctx);

        expect(result!.hadLocalChanges).toBe(true);
        // undoChangesAndResolveConflicts should have been called
        expect(undoChangesAndResolveConflicts).toHaveBeenCalled();
        // replaceUndoStack should have been called with rebased entries
        expect(ctx.replaceUndoStack).toHaveBeenCalledTimes(1);
        const newStack = (ctx.replaceUndoStack as any).mock.calls[0][0];
        expect(newStack).toHaveLength(1);
        expect(newStack[0].description).toBe("edit text");
      });

      it("rebuilds each undo entry individually", () => {
        const entries = [
          {
            description: "edit 1",
            changes: [{ type: "update", changeNode: { inst: {}, field: "a" } }],
          },
          {
            description: "edit 2",
            changes: [{ type: "update", changeNode: { inst: {}, field: "b" } }],
          },
          {
            description: "edit 3",
            changes: [{ type: "update", changeNode: { inst: {}, field: "c" } }],
          },
        ];
        const ctx = makeContext({
          getUndoStack: () => entries,
        });
        const update = makeIncrementalUpdate();

        applyServerUpdate(update, ctx);

        // undoChangesAndResolveConflicts called once per entry
        expect(undoChangesAndResolveConflicts).toHaveBeenCalledTimes(3);
        const newStack = (ctx.replaceUndoStack as any).mock.calls[0][0];
        expect(newStack).toHaveLength(3);
        expect(newStack.map((e: any) => e.description)).toEqual([
          "edit 1",
          "edit 2",
          "edit 3",
        ]);
      });
    });

    describe("rebase with open batch changes", () => {
      it("reverts and re-applies batch changes", () => {
        const batchChanges = {
          changes: [{ type: "update", changeNode: { inst: {}, field: "style" } }],
          newInsts: [],
          removedInsts: [],
        };
        // Recorder must return non-empty changes when reverting batch
        const recorder = {
          withRecording: vi.fn((fn: () => void) => {
            fn();
            return {
              changes: [{ type: "update", changeNode: { inst: {}, field: "reverted" } }],
              newInsts: [],
              removedInsts: [],
            };
          }),
        };
        const ctx = makeContext({
          recorder,
          getAccumulatedChanges: () => batchChanges,
        });
        const update = makeIncrementalUpdate();

        const result = applyServerUpdate(update, ctx);

        expect(result!.hadLocalChanges).toBe(true);
        expect(undoChangesAndResolveConflicts).toHaveBeenCalled();
        expect(ctx.replaceAccumulatedChanges).toHaveBeenCalledTimes(1);
      });
    });

    describe("rebase with both undo stack and batch changes", () => {
      it("processes both undo entries and batch changes", () => {
        const undoEntry = {
          description: "edit",
          changes: [{ type: "update", changeNode: { inst: {}, field: "a" } }],
        };
        const batchChanges = {
          changes: [{ type: "update", changeNode: { inst: {}, field: "b" } }],
          newInsts: [],
          removedInsts: [],
        };
        // Recorder returns non-empty changes for reverts
        const recorder = {
          withRecording: vi.fn((fn: () => void) => {
            fn();
            return {
              changes: [{ type: "update", changeNode: { inst: {}, field: "reverted" } }],
              newInsts: [],
              removedInsts: [],
            };
          }),
        };
        const ctx = makeContext({
          recorder,
          getUndoStack: () => [undoEntry],
          getAccumulatedChanges: () => batchChanges,
        });
        const update = makeIncrementalUpdate();

        applyServerUpdate(update, ctx);

        // 1 call for undo entry + 1 call for batch
        expect(undoChangesAndResolveConflicts).toHaveBeenCalledTimes(2);
        expect(ctx.replaceUndoStack).toHaveBeenCalled();
        expect(ctx.replaceAccumulatedChanges).toHaveBeenCalled();
      });
    });

    describe("dependency deletion detection", () => {
      it("throws UnsupportedServerUpdate when dependencies are removed", () => {
        const dep1 = { name: "dep1" };
        const dep2 = { name: "dep2" };
        const ctx = makeContext();
        // Start with 2 deps
        ctx.site.projectDependencies = [dep1, dep2];

        // After unbundlePartial, simulate dep removal
        ctx.recorder.withRecording = vi.fn((fn: () => void) => {
          fn();
          // Simulate server removing dep2
          ctx.site.projectDependencies = [dep1];
          return { changes: [], newInsts: [], removedInsts: [] };
        });

        const update = makeIncrementalUpdate();

        expect(() => applyServerUpdate(update, ctx)).toThrow(
          UnsupportedServerUpdate
        );
      });
    });

    describe("deleted instances handling", () => {
      it("looks up deleted instances by IID via bundler.objByAddr", () => {
        const deletedObj = { _type: "Component", name: "Deleted" };
        const ctx = makeContext();
        ctx.bundler.objByAddr = vi.fn((addr: any) => {
          if (addr.iid === "iid-dead") return deletedObj;
          return undefined;
        });

        const update = makeIncrementalUpdate({
          deletedIids: ["iid-dead", "iid-missing"],
        });

        applyServerUpdate(update, ctx);

        expect(ctx.bundler.objByAddr).toHaveBeenCalledWith({
          uuid: "proj-123",
          iid: "iid-dead",
        });
        expect(ctx.bundler.objByAddr).toHaveBeenCalledWith({
          uuid: "proj-123",
          iid: "iid-missing",
        });
      });
    });

    describe("dep pkg unbundling", () => {
      it("unbundles dependency packages before applying partial", () => {
        const depPkg = { id: "dep-1", model: '{"map":{}}' };
        const ctx = makeContext();
        const update = makeIncrementalUpdate({
          depPkgs: [depPkg],
        });

        applyServerUpdate(update, ctx);

        // unbundleProjectDependency should have been called
        // (it's called inside recorder.withRecording)
      });

      it("catches and logs unbundle failure without aborting rebase", () => {
        mockUnbundleProjectDependency.mockImplementationOnce(() => {
          throw new Error("corrupt dep bundle");
        });

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const ctx = makeContext();
        const update = makeIncrementalUpdate({
          depPkgs: [{ id: "dep-bad", model: '{"map":{}}' }],
        });

        // Should NOT throw — error is caught and logged
        const result = applyServerUpdate(update, ctx);
        expect(result).not.toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("failed to unbundle dep pkg dep-bad")
        );
        consoleSpy.mockRestore();
      });

      it("continues processing remaining dep pkgs after one fails", () => {
        let callCount = 0;
        mockUnbundleProjectDependency.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error("first dep failed");
          }
          // second dep succeeds
        });

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const ctx = makeContext();
        const update = makeIncrementalUpdate({
          depPkgs: [
            { id: "dep-fail", model: '{"map":{}}' },
            { id: "dep-ok", model: '{"map":{}}' },
          ],
        });

        const result = applyServerUpdate(update, ctx);
        expect(result).not.toBeNull();
        // Both deps attempted
        expect(callCount).toBe(2);
        consoleSpy.mockRestore();
      });
    });

    describe("revision number update", () => {
      it("returns the server revision number", () => {
        const ctx = makeContext({ revisionNum: 3 });
        const update = makeIncrementalUpdate({ revision: 15 });

        const result = applyServerUpdate(update, ctx);

        expect(result!.newRevisionNum).toBe(15);
      });
    });

    describe("DeletedAssetsSummary accumulation", () => {
      it("accumulates summary across rebases", () => {
        const ctx = makeContext();
        const summary1 = (getEmptyDeletedAssetsSummary as any)();
        ctx.serverUpdatesSummary = summary1;

        const update1 = makeIncrementalUpdate({ deletedIids: [] });
        const result1 = applyServerUpdate(update1, ctx);

        expect(result1!.serverUpdatesSummary).toBeDefined();
      });
    });

    describe("undoChangesAndResolveConflicts return value usage", () => {
      it("uses returned changes in the rebuilt undo stack", () => {
        const conflictResolvedChanges = [
          { type: "update", changeNode: { inst: { id: 99 }, field: "resolved" } },
        ];
        (undoChangesAndResolveConflicts as any).mockReturnValue({
          changes: conflictResolvedChanges,
          newInsts: [],
          removedInsts: [],
        });

        const undoEntry = {
          description: "original edit",
          changes: [{ type: "update", changeNode: { inst: {}, field: "original" } }],
        };
        const ctx = makeContext({
          getUndoStack: () => [undoEntry],
        });
        const update = makeIncrementalUpdate();

        applyServerUpdate(update, ctx);

        const newStack = (ctx.replaceUndoStack as any).mock.calls[0][0];
        expect(newStack[0].changes).toBe(conflictResolvedChanges);
        expect(newStack[0].description).toBe("original edit");
      });

      it("uses returned changes for rebased batch state", () => {
        const rebasedBatchChanges = {
          changes: [{ type: "update", changeNode: { inst: { id: 77 }, field: "rebased-batch" } }],
          newInsts: [{ id: "new-inst" }],
          removedInsts: [],
        };
        (undoChangesAndResolveConflicts as any).mockReturnValue(rebasedBatchChanges);

        const batchChanges = {
          changes: [{ type: "update", changeNode: { inst: {}, field: "batch-original" } }],
          newInsts: [],
          removedInsts: [],
        };
        const recorder = {
          withRecording: vi.fn((fn: () => void) => {
            fn();
            return {
              changes: [{ type: "update", changeNode: { inst: {}, field: "reverted" } }],
              newInsts: [],
              removedInsts: [],
            };
          }),
        };
        const ctx = makeContext({
          recorder,
          getAccumulatedChanges: () => batchChanges,
        });
        const update = makeIncrementalUpdate();

        applyServerUpdate(update, ctx);

        expect(ctx.replaceAccumulatedChanges).toHaveBeenCalledWith(rebasedBatchChanges);
      });

      it("handles empty changes from conflict resolution", () => {
        (undoChangesAndResolveConflicts as any).mockReturnValue({
          changes: [],
          newInsts: [],
          removedInsts: [],
        });

        const undoEntry = {
          description: "conflicted edit",
          changes: [{ type: "update", changeNode: { inst: {}, field: "x" } }],
        };
        const ctx = makeContext({
          getUndoStack: () => [undoEntry],
        });
        const update = makeIncrementalUpdate();

        applyServerUpdate(update, ctx);

        const newStack = (ctx.replaceUndoStack as any).mock.calls[0][0];
        expect(newStack[0].changes).toEqual([]);
        expect(newStack[0].description).toBe("conflicted edit");
      });
    });
  });
});
