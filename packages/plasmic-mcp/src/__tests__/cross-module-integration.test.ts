/**
 * Cross-module integration tests for the WebSocket live sync subsystem.
 *
 * These tests verify the interactions between rebase-engine, undo-manager,
 * batch-manager, update-queue, save-manager, and change-tracker as they
 * coordinate during real editing scenarios. Unit tests for each module mock
 * their collaborators — these tests wire them together to catch integration
 * bugs (e.g. mismatched interfaces, ordering issues, state leaks).
 *
 * Why: A unit test can pass while a rebase silently drops undo entries,
 * or a batch rollback interacts incorrectly with the undo stack. Only
 * cross-module tests catch these emergent failures.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mockWithRecording,
  emptyRecordedChanges,
} from "../__mocks__/wab-observable-model";
import { mockUndoChanges } from "../__mocks__/wab-undo-util";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  undoChangesAndResolveConflicts,
  getEmptyDeletedAssetsSummary,
} from "@/wab/shared/server-updates-utils";
import { setSession, clearSession, requireSession } from "../session";
import { initChangeTracker, getChangeTracker, disposeChangeTracker } from "../change-tracker";
import {
  pushUndoOperation,
  undo,
  getUndoDepth,
  getStack,
  replaceStack,
  clearUndoStack,
} from "../undo-manager";
import {
  beginBatch,
  endBatch,
  isBatchActive,
  accumulateChanges,
  getAccumulatedChanges,
  replaceAccumulatedChanges,
  cancelBatch,
} from "../batch-manager";
import {
  applyServerUpdate,
  type RebaseContext,
} from "../rebase-engine";
import type { ModelUpdateIncremental } from "../types";
import { UpdateQueue } from "../update-queue";
import { isSaving } from "../save-manager";

// --- Helpers ---

function setupSession() {
  const site = {
    components: [
      { name: "Hero", tplTree: {} },
      { name: "Footer", tplTree: {} },
    ],
    projectDependencies: [],
  };
  setSession({
    projectId: "proj-int",
    projectName: "Integration Test",
    site,
    bundler: {
      fastBundle: mockFastBundle,
      bundle: vi.fn().mockReturnValue({}),
      addrOf: mockAddrOf,
      allUuids: vi.fn().mockReturnValue(["uuid-1"]),
      unbundlePartial: vi.fn(),
      objByAddr: vi.fn().mockReturnValue(undefined),
    },
    revisionNum: 10,
    modelVersion: 1,
    hostlessDataVersion: 0,
    projectUuid: "proj-int",
  } as any);
  initChangeTracker(site);
  return site;
}

function makeIncrementalUpdate(
  overrides: Partial<ModelUpdateIncremental> = {}
): ModelUpdateIncremental {
  return {
    data: JSON.stringify({ map: { "1": {} } }),
    revision: 15,
    depPkgs: [],
    deletedIids: [],
    modifiedComponentIids: [],
    ...overrides,
  };
}

function makeRebaseContext(site: any): RebaseContext {
  const session = requireSession();
  const tracker = getChangeTracker();
  return {
    site,
    bundler: session.bundler,
    projectId: session.projectId,
    revisionNum: session.revisionNum,
    recorder: tracker.getRecorder(),
    serverUpdatesSummary: (getEmptyDeletedAssetsSummary as any)(),
    getUndoStack: () => getStack(),
    replaceUndoStack: (stack: any) => replaceStack(stack),
    getAccumulatedChanges: () => getAccumulatedChanges(),
    replaceAccumulatedChanges: (changes: any) =>
      replaceAccumulatedChanges(changes),
  };
}

// --- Setup / Teardown ---

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  clearUndoStack();
  cancelBatch();
  mockFastBundle.mockReturnValue({ map: {}, root: "0" });
  mockWithRecording.mockReturnValue(emptyRecordedChanges());
});

afterEach(() => {
  clearUndoStack();
  cancelBatch();
  disposeChangeTracker();
  clearSession();
  vi.restoreAllMocks();
});

// ==========================================================================
// Integration: Rebase + Undo Stack
//
// When a server update arrives, the rebase engine must:
// 1. Revert all undo stack entries
// 2. Apply server changes
// 3. Re-apply each entry with conflict resolution
// 4. Replace the undo stack with rebased entries
//
// These tests verify that the undo-manager's getStack/replaceStack
// are correctly wired to the rebase engine's RebaseContext.
// ==========================================================================

describe("rebase + undo stack integration", () => {
  it("rebuilds undo stack entries through rebase engine → undo-manager", () => {
    const site = setupSession();

    // Push two undo operations
    pushUndoOperation("edit title", {
      changes: [{ type: "update", changeNode: { inst: {}, field: "title" } }],
      newInsts: [],
      removedInsts: [],
    } as any);
    pushUndoOperation("edit subtitle", {
      changes: [{ type: "update", changeNode: { inst: {}, field: "subtitle" } }],
      newInsts: [],
      removedInsts: [],
    } as any);

    expect(getUndoDepth()).toBe(2);

    // Configure conflict resolution mock to return unique changes per call
    let callIndex = 0;
    (undoChangesAndResolveConflicts as any).mockImplementation(() => {
      callIndex++;
      return {
        changes: [
          { type: "update", changeNode: { inst: { id: callIndex }, field: `resolved-${callIndex}` } },
        ],
        newInsts: [],
        removedInsts: [],
      };
    });

    // Apply a server update through the rebase engine
    const ctx = makeRebaseContext(site);
    const update = makeIncrementalUpdate({ revision: 15 });
    const result = applyServerUpdate(update, ctx);

    expect(result).not.toBeNull();
    expect(result!.hadLocalChanges).toBe(true);

    // Undo stack should now have rebased entries
    // (undoChangesAndResolveConflicts called 2 times = 2 undo entries)
    expect(undoChangesAndResolveConflicts).toHaveBeenCalledTimes(2);
    expect(getUndoDepth()).toBe(2);

    // Entries should have conflict-resolved changes
    const stack = getStack();
    expect(stack[0].description).toBe("edit title");
    expect(stack[0].changes[0].changeNode.field).toBe("resolved-1");
    expect(stack[1].description).toBe("edit subtitle");
    expect(stack[1].changes[0].changeNode.field).toBe("resolved-2");
  });
});

// ==========================================================================
// Integration: Rebase + Batch Manager
//
// When a server update arrives during an active batch, the rebase engine
// must undo the accumulated batch changes, apply server changes, then
// re-apply batch changes with conflict resolution — all through the
// batch-manager's getAccumulatedChanges/replaceAccumulatedChanges API.
// ==========================================================================

describe("rebase + batch manager integration", () => {
  it("rebases accumulated batch changes and replaces them", () => {
    const site = setupSession();

    // Configure mockWithRecording to return non-empty changes so
    // the rebase engine's revert phase produces changes to re-apply
    mockWithRecording.mockReturnValue({
      changes: [{ type: "update", changeNode: { inst: {}, field: "reverted" } }],
      newInsts: [],
      removedInsts: [],
    });

    beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "batch-edit" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    const rebasedBatch = {
      changes: [{ type: "update", changeNode: { inst: { id: 99 }, field: "rebased-batch" } }],
      newInsts: [],
      removedInsts: [],
    };
    (undoChangesAndResolveConflicts as any).mockReturnValue(rebasedBatch);

    const ctx = makeRebaseContext(site);
    const update = makeIncrementalUpdate({ revision: 15 });
    const result = applyServerUpdate(update, ctx);

    expect(result!.hadLocalChanges).toBe(true);
    // undoChangesAndResolveConflicts called once for batch changes
    expect(undoChangesAndResolveConflicts).toHaveBeenCalledTimes(1);
    // Accumulated changes should be replaced with rebased version
    const accumulated = getAccumulatedChanges();
    expect(accumulated!.changes).toEqual(rebasedBatch.changes);
  });
});

// ==========================================================================
// Integration: Rebase + Undo Stack + Batch
//
// Both undo stack entries and batch changes exist when a server update
// arrives. The rebase engine must handle both in the correct order:
// 1. Undo batch, then undo stack (reverse)
// 2. Apply server
// 3. Re-apply stack (forward), then re-apply batch
// ==========================================================================

describe("rebase + undo stack + batch integration", () => {
  it("processes both undo entries and batch changes in correct order", () => {
    const site = setupSession();

    // Configure mockWithRecording to return non-empty changes so
    // both undo stack revert and batch revert produce changes to re-apply
    mockWithRecording.mockReturnValue({
      changes: [{ type: "update", changeNode: { inst: {}, field: "reverted" } }],
      newInsts: [],
      removedInsts: [],
    });

    // Push one undo operation
    pushUndoOperation("undo-edit", {
      changes: [{ type: "update", changeNode: { inst: {}, field: "undo" } }],
      newInsts: [],
      removedInsts: [],
    } as any);

    // Start a batch with accumulated changes
    beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "batch" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    let callOrder = 0;
    const callResults: Array<{ callNum: number; changes: any[] }> = [];
    (undoChangesAndResolveConflicts as any).mockImplementation(() => {
      callOrder++;
      const result = {
        changes: [{ type: "update", changeNode: { inst: { callNum: callOrder }, field: `resolved-${callOrder}` } }],
        newInsts: [],
        removedInsts: [],
      };
      callResults.push({ callNum: callOrder, changes: result.changes });
      return result;
    });

    const ctx = makeRebaseContext(site);
    const update = makeIncrementalUpdate({ revision: 20 });
    const result = applyServerUpdate(update, ctx);

    expect(result!.hadLocalChanges).toBe(true);
    // 1 call for undo entry + 1 call for batch = 2 total
    expect(undoChangesAndResolveConflicts).toHaveBeenCalledTimes(2);

    // Undo stack should have rebased entry
    expect(getUndoDepth()).toBe(1);
    const stack = getStack();
    expect(stack[0].description).toBe("undo-edit");
    expect(stack[0].changes[0].changeNode.field).toBe("resolved-1");

    // Batch should have rebased accumulated changes
    const accumulated = getAccumulatedChanges();
    expect(accumulated!.changes[0].changeNode.field).toBe("resolved-2");
  });
});

// ==========================================================================
// Integration: UpdateQueue + isSaving Coordination
//
// The UpdateQueue gates processing while a save is in flight, preventing
// races between outgoing saves and incoming server updates.
// ==========================================================================

describe("UpdateQueue + save coordination", () => {
  it("queues updates during save and processes after", async () => {
    setupSession();
    const processed: number[] = [];
    let saving = true;

    const handler = vi.fn().mockImplementation(async (data: any) => {
      processed.push(data.rev.revision);
    });

    const queue = new UpdateQueue({
      handler,
      isSaving: () => saving,
    });

    // Enqueue while saving
    queue.enqueue({ projectId: "proj-int", rev: { revision: 11, branchId: null } });
    queue.enqueue({ projectId: "proj-int", rev: { revision: 12, branchId: null } });

    // Wait — should be blocked
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(processed).toEqual([]);

    // Save completes
    saving = false;

    await vi.waitFor(() => {
      expect(processed).toEqual([11, 12]);
    });

    queue.stop();
  });

  it("self-update filtering prevents echo processing", async () => {
    setupSession();
    const session = requireSession();
    session.pendingSavedRevisionNum = 11;

    const processed: number[] = [];
    const handler = vi.fn().mockImplementation(async (data: any) => {
      processed.push(data.rev.revision);
    });

    const queue = new UpdateQueue({
      handler,
      getPendingSavedRevisionNum: () => session.pendingSavedRevisionNum,
    });

    // Our own echo (rev 11, same as pending) — should be skipped
    queue.enqueue({ projectId: "proj-int", rev: { revision: 11, branchId: null } });
    // Another user's update (rev 12) — should be processed
    queue.enqueue({ projectId: "proj-int", rev: { revision: 12, branchId: null } });

    await vi.waitFor(() => {
      expect(processed).toEqual([12]);
    });

    queue.stop();
  });
});

// ==========================================================================
// Integration: Batch → Save → Undo
//
// When a batch is ended, the accumulated changes are saved, then pushed
// as a single undo operation. This tests the full flow.
// ==========================================================================

describe("batch → save → undo flow", () => {
  it("batch creates one undo entry that can be undone", async () => {
    setupSession();
    const api = {
      saveRevision: vi.fn().mockResolvedValue({}),
    };

    // Start batch, accumulate 3 changes
    beginBatch();
    for (let i = 0; i < 3; i++) {
      accumulateChanges(
        {
          changes: [{ type: "update", changeNode: { inst: {}, field: `field-${i}` } }],
          newInsts: [],
          removedInsts: [],
        } as any,
      );
    }

    // End batch — should save and push one undo
    const result = await endBatch(api as any);
    expect(result.operationCount).toBe(3);
    expect(getUndoDepth()).toBe(1);

    // The undo entry description should reference the batch
    const stack = getStack();
    expect(stack[0].description).toBe("batch of 3 edits");

    // Undo the batch
    const undoResult = await undo(api as any);
    expect(undoResult.undone).toBe("batch of 3 edits");
    expect(getUndoDepth()).toBe(0);
  });
});

// ==========================================================================
// Integration: Session State Updates During Rebase
//
// When rebase completes, the session's revisionNum and
// serverUpdatesSummary must be updated to reflect the new state.
// ==========================================================================

describe("session state updates during rebase", () => {
  it("rebase result carries new revision for session update", () => {
    const site = setupSession();
    const session = requireSession();
    expect(session.revisionNum).toBe(10);

    const ctx = makeRebaseContext(site);
    const update = makeIncrementalUpdate({ revision: 25 });
    const result = applyServerUpdate(update, ctx);

    // The rebase engine returns the new revision — the caller (live-sync)
    // is responsible for updating session.revisionNum
    expect(result!.newRevisionNum).toBe(25);
  });
});
