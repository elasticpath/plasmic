/**
 * Tests for batch-manager.ts — batch edit session management.
 *
 * Verifies: begin/end lifecycle, change accumulation, save-on-end,
 * batch ID verification, empty batch handling, error states, and
 * undo integration (batch pushed as single undo operation).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { emptyRecordedChanges } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import {
  beginBatch,
  endBatch,
  isBatchActive,
  getBatchId,
  getAccumulatedChanges,
  replaceAccumulatedChanges,
  accumulateChanges,
  cancelBatch,
  cancelBatchWithRollback,
} from "../batch-manager";
import { clearUndoStack, getUndoDepth } from "../undo-manager";
import { mockUndoChanges } from "../__mocks__/wab-undo-util";

// Mock API client
function mockApiClient(): any {
  return {
    saveRevision: vi.fn().mockResolvedValue({}),
  };
}

// Standard test session
function setupSession() {
  const site = { components: [] };
  setSession({
    projectId: "proj-1",
    projectName: "Test",
    site,
    bundler: {
      fastBundle: mockFastBundle,
      bundle: vi.fn().mockReturnValue({}),
      addrOf: mockAddrOf,
    },
    revisionNum: 5,
    modelVersion: 1,
    hostlessDataVersion: 0,
    projectUuid: "proj-1",
  });
  initChangeTracker(site);
  return site;
}

beforeEach(() => {
  vi.clearAllMocks();
  cancelBatch();
  clearUndoStack();
  mockFastBundle.mockReturnValue({ map: {}, root: "0" });
});

afterEach(() => {
  cancelBatch();
  clearUndoStack();
  disposeChangeTracker();
  clearSession();
});

describe("beginBatch", () => {
  it("starts a batch session and returns a batch ID", () => {
    setupSession();
    const batchId = beginBatch();
    expect(batchId).toBeDefined();
    expect(typeof batchId).toBe("string");
    expect(batchId.length).toBeGreaterThan(0);
    expect(isBatchActive()).toBe(true);
    expect(getBatchId()).toBe(batchId);
  });

  it("throws if a batch is already active", () => {
    setupSession();
    beginBatch();
    expect(() => beginBatch()).toThrow("batch session is already active");
  });
});

describe("isBatchActive / getBatchId", () => {
  it("returns false / null when no batch is active", () => {
    expect(isBatchActive()).toBe(false);
    expect(getBatchId()).toBeNull();
  });

  it("returns true / id after beginBatch", () => {
    setupSession();
    const id = beginBatch();
    expect(isBatchActive()).toBe(true);
    expect(getBatchId()).toBe(id);
  });
});

describe("accumulateChanges", () => {
  it("throws if no batch is active", () => {
    expect(() => accumulateChanges(emptyRecordedChanges())).toThrow(
      "No batch session is active"
    );
  });

  it("accumulates changes during a batch", () => {
    setupSession();
    beginBatch();
    const changes1 = {
      changes: [{ type: "update", changeNode: { inst: {}, field: "text" } }],
      newInsts: [],
      removedInsts: [],
    };
    const changes2 = {
      changes: [{ type: "update", changeNode: { inst: {}, field: "style" } }],
      newInsts: [{}],
      removedInsts: [],
    };
    accumulateChanges(changes1 as any);
    accumulateChanges(changes2 as any);
    // No error means accumulation succeeded
    expect(isBatchActive()).toBe(true);
  });

  it("accumulates modifiedComponentIids", () => {
    setupSession();
    beginBatch();
    accumulateChanges(emptyRecordedChanges(), ["iid-1"]);
    accumulateChanges(emptyRecordedChanges(), ["iid-2", "iid-1"]);
    // Deduplication tested via endBatch
    expect(isBatchActive()).toBe(true);
  });
});

describe("endBatch", () => {
  it("saves accumulated changes and returns result", async () => {
    setupSession();
    const api = mockApiClient();
    beginBatch();

    const changes = {
      changes: [{ type: "update", changeNode: { inst: {}, field: "text" } }],
      newInsts: [],
      removedInsts: [],
    };
    accumulateChanges(changes as any, ["iid-1"]);
    accumulateChanges(changes as any, ["iid-2"]);

    const result = await endBatch(api);
    expect(result.operationCount).toBe(2);
    expect(result.save.revisionNum).toBe(6); // 5 + 1
    expect(api.saveRevision).toHaveBeenCalledTimes(1);
    expect(isBatchActive()).toBe(false);
  });

  it("throws if no batch is active", async () => {
    await expect(endBatch(mockApiClient())).rejects.toThrow(
      "No batch session is active"
    );
  });

  it("throws on batch ID mismatch", async () => {
    setupSession();
    beginBatch();
    await expect(endBatch(mockApiClient(), "wrong-id")).rejects.toThrow(
      "Batch ID mismatch"
    );
  });

  it("handles empty batch (no changes)", async () => {
    setupSession();
    beginBatch();
    const result = await endBatch(mockApiClient());
    expect(result.operationCount).toBe(0);
    expect(result.save.revisionNum).toBe(5); // current revision, no save
    expect(isBatchActive()).toBe(false);
  });

  it("clears batch state before saving (error recovery)", async () => {
    setupSession();
    const api = mockApiClient();
    api.saveRevision.mockRejectedValueOnce(new Error("Server error"));

    beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "x" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    await expect(endBatch(api)).rejects.toThrow("Server error");
    // Batch should be cleared even though save failed
    expect(isBatchActive()).toBe(false);
  });

  it("pushes batch as single undo operation", async () => {
    setupSession();
    const api = mockApiClient();
    beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "a" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "b" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    await endBatch(api);
    expect(getUndoDepth()).toBe(1); // entire batch = 1 undo operation
  });

  it("passes correct batchId when provided", async () => {
    setupSession();
    const api = mockApiClient();
    const batchId = beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "x" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    const result = await endBatch(api, batchId);
    expect(result.save.revisionNum).toBe(6);
  });
});

describe("cancelBatch", () => {
  it("cancels an active batch without saving", () => {
    setupSession();
    beginBatch();
    accumulateChanges(emptyRecordedChanges());
    cancelBatch();
    expect(isBatchActive()).toBe(false);
    expect(getBatchId()).toBeNull();
  });

  it("is a no-op when no batch is active", () => {
    cancelBatch(); // should not throw
    expect(isBatchActive()).toBe(false);
  });
});

// ==========================================================================
// Error recovery: batch rollback on failure
//
// When a mutation fails during a batch, the entire batch must be cancelled
// and all accumulated changes rolled back so the model stays clean.
// When endBatch's save fails, accumulated changes must also be rolled back.
// ==========================================================================

describe("cancelBatchWithRollback", () => {
  it("cancels batch and rolls back accumulated changes", () => {
    setupSession();
    beginBatch();
    const changes = {
      changes: [
        { type: "update", changeNode: { inst: {}, field: "text" } },
        { type: "update", changeNode: { inst: {}, field: "style" } },
      ],
      newInsts: [],
      removedInsts: [],
    };
    accumulateChanges(changes as any);

    cancelBatchWithRollback();

    expect(isBatchActive()).toBe(false);
    // undoChanges should have been called with the accumulated changes
    expect(mockUndoChanges).toHaveBeenCalledWith(changes.changes);
  });

  it("is a no-op when no batch is active", () => {
    cancelBatchWithRollback(); // should not throw
    expect(isBatchActive()).toBe(false);
    expect(mockUndoChanges).not.toHaveBeenCalled();
  });

  it("does not call undoChanges for empty batch", () => {
    setupSession();
    beginBatch();
    // No accumulateChanges called — 0 operations
    cancelBatchWithRollback();

    expect(isBatchActive()).toBe(false);
    expect(mockUndoChanges).not.toHaveBeenCalled();
  });

  it("handles rollback failure gracefully (logs but does not throw)", () => {
    setupSession();
    beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "x" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    // Make undoChanges throw
    mockUndoChanges.mockImplementationOnce(() => {
      throw new Error("Rollback failed");
    });

    // Should not throw — rollback failure is logged, not re-thrown
    expect(() => cancelBatchWithRollback()).not.toThrow();
    expect(isBatchActive()).toBe(false);
  });
});

describe("endBatch error recovery", () => {
  it("rolls back accumulated changes when save fails", async () => {
    setupSession();
    const api = mockApiClient();
    api.saveRevision.mockRejectedValueOnce(new Error("Save failed"));

    beginBatch();
    const changes = {
      changes: [{ type: "update", changeNode: { inst: {}, field: "text" } }],
      newInsts: [],
      removedInsts: [],
    };
    accumulateChanges(changes as any);
    accumulateChanges(changes as any);

    await expect(endBatch(api)).rejects.toThrow("Save failed");

    // Batch should be cleared
    expect(isBatchActive()).toBe(false);
    // Accumulated changes should have been rolled back
    expect(mockUndoChanges).toHaveBeenCalled();
    // Undo stack should be empty (save didn't succeed)
    expect(getUndoDepth()).toBe(0);
  });

  it("logs CRITICAL and re-throws save error when rollback also fails", async () => {
    setupSession();
    const api = mockApiClient();
    api.saveRevision.mockRejectedValueOnce(new Error("save broke"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "x" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    // Make rollback throw
    mockUndoChanges.mockImplementationOnce(() => {
      throw new Error("rollback exploded");
    });

    await expect(endBatch(api)).rejects.toThrow("save broke");

    // Batch is still cleared
    expect(isBatchActive()).toBe(false);
    // CRITICAL log emitted about rollback failure
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("CRITICAL: Rollback failed")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("rollback exploded")
    );
    consoleSpy.mockRestore();
  });
});

describe("replaceAccumulatedChanges (rebase integration)", () => {
  it("replaces batch changes mid-batch for rebase engine", () => {
    setupSession();
    beginBatch();

    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "original" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    const rebasedChanges = {
      changes: [{ type: "update", changeNode: { inst: {}, field: "rebased" } }],
      newInsts: [{ id: "new-inst" }],
      removedInsts: [],
    };
    replaceAccumulatedChanges(rebasedChanges as any);

    const accumulated = getAccumulatedChanges();
    expect(accumulated).not.toBeNull();
    expect(accumulated!.changes).toEqual(rebasedChanges.changes);
    expect(accumulated!.newInsts).toEqual(rebasedChanges.newInsts);
  });

  it("endBatch saves rebased changes after replaceAccumulatedChanges", async () => {
    setupSession();
    const api = mockApiClient();
    beginBatch();

    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "pre-rebase" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    // Simulate rebase replacing the changes
    const rebasedChanges = {
      changes: [{ type: "update", changeNode: { inst: { id: 42 }, field: "post-rebase" } }],
      newInsts: [],
      removedInsts: [],
    };
    replaceAccumulatedChanges(rebasedChanges as any);

    const result = await endBatch(api);
    // operationCount is still 1 (from the original accumulate)
    expect(result.operationCount).toBe(1);
    expect(result.save.revisionNum).toBe(6);
    expect(isBatchActive()).toBe(false);
  });

  it("replaceAccumulatedChanges is no-op when no batch active", () => {
    // Should not throw
    replaceAccumulatedChanges({
      changes: [],
      newInsts: [],
      removedInsts: [],
    } as any);
    expect(getAccumulatedChanges()).toBeNull();
  });
});

describe("sequential batches", () => {
  it("second batch is independent from first", async () => {
    setupSession();
    const api = mockApiClient();

    // First batch
    beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "batch1" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );
    const result1 = await endBatch(api);
    expect(result1.operationCount).toBe(1);
    expect(getUndoDepth()).toBe(1);

    // Second batch — starts clean
    const batchId2 = beginBatch();
    expect(getAccumulatedChanges()!.changes).toHaveLength(0);

    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "batch2-a" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "batch2-b" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );

    const result2 = await endBatch(api, batchId2);
    expect(result2.operationCount).toBe(2);
    // Two undo operations total (one per batch)
    expect(getUndoDepth()).toBe(2);
  });

  it("failed first batch does not affect second batch", async () => {
    setupSession();
    const api = mockApiClient();

    // First batch fails on save
    api.saveRevision.mockRejectedValueOnce(new Error("first batch failed"));
    beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "fail" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );
    await expect(endBatch(api)).rejects.toThrow("first batch failed");
    expect(isBatchActive()).toBe(false);

    // Second batch succeeds
    api.saveRevision.mockResolvedValueOnce({});
    beginBatch();
    accumulateChanges(
      {
        changes: [{ type: "update", changeNode: { inst: {}, field: "succeed" } }],
        newInsts: [],
        removedInsts: [],
      } as any,
    );
    const result = await endBatch(api);
    expect(result.operationCount).toBe(1);
    expect(isBatchActive()).toBe(false);
  });
});
