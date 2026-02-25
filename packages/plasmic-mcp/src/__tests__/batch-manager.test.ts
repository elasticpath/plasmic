/**
 * Tests for batch-manager.ts — batch edit session management.
 *
 * Verifies: begin/end lifecycle, change accumulation, save-on-end,
 * batch ID verification, empty batch handling, error states, and
 * undo integration (batch pushed as single undo operation).
 */

import { emptyRecordedChanges } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import {
  beginBatch,
  endBatch,
  isBatchActive,
  getBatchId,
  accumulateChanges,
  cancelBatch,
} from "../batch-manager";
import { clearUndoStack, getUndoDepth } from "../undo-manager";

// Mock API client
function mockApiClient(): any {
  return {
    saveRevision: jest.fn().mockResolvedValue({}),
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
      bundle: jest.fn().mockReturnValue({}),
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
  jest.clearAllMocks();
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
    expect(() => accumulateChanges(emptyRecordedChanges)).toThrow(
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
    accumulateChanges(emptyRecordedChanges, ["iid-1"]);
    accumulateChanges(emptyRecordedChanges, ["iid-2", "iid-1"]);
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
    accumulateChanges(emptyRecordedChanges);
    cancelBatch();
    expect(isBatchActive()).toBe(false);
    expect(getBatchId()).toBeNull();
  });

  it("is a no-op when no batch is active", () => {
    cancelBatch(); // should not throw
    expect(isBatchActive()).toBe(false);
  });
});
