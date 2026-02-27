/**
 * Tests for undo-manager.ts — undo stack management.
 *
 * Verifies: push/pop operations, undoChanges() invocation, empty stack error,
 * multiple sequential undos, undo stack clearing, and save integration.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mockWithRecording,
  emptyRecordedChanges,
} from "../__mocks__/wab-observable-model";
import { mockUndoChanges } from "../__mocks__/wab-undo-util";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import {
  pushUndoOperation,
  undo,
  getUndoDepth,
  clearUndoStack,
  MAX_UNDO_DEPTH,
} from "../undo-manager";

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
  clearUndoStack();
  mockFastBundle.mockReturnValue({ map: {}, root: "0" });
  mockWithRecording.mockReturnValue(emptyRecordedChanges());
});

afterEach(() => {
  clearUndoStack();
  disposeChangeTracker();
  clearSession();
});

describe("pushUndoOperation", () => {
  it("pushes an operation onto the stack", () => {
    const changes = {
      changes: [{ type: "update", changeNode: { inst: {}, field: "text" } }],
      newInsts: [],
      removedInsts: [],
    };
    pushUndoOperation("update text", changes as any);
    expect(getUndoDepth()).toBe(1);
  });

  it("supports multiple pushes", () => {
    pushUndoOperation("op 1", emptyRecordedChanges());
    pushUndoOperation("op 2", emptyRecordedChanges());
    pushUndoOperation("op 3", emptyRecordedChanges());
    expect(getUndoDepth()).toBe(3);
  });
});

describe("undo", () => {
  it("throws when stack is empty", async () => {
    setupSession();
    await expect(undo(mockApiClient())).rejects.toThrow("Nothing to undo.");
  });

  it("pops the last operation and calls undoChanges", async () => {
    setupSession();
    const api = mockApiClient();
    const changes = {
      changes: [
        { type: "update", changeNode: { inst: { id: 1 }, field: "text" } },
      ],
      newInsts: [],
      removedInsts: [],
    };

    pushUndoOperation("update text on Hero", changes as any);
    const result = await undo(api);

    expect(result.undone).toBe("update text on Hero");
    expect(result.save.revisionNum).toBe(6); // 5 + 1
    expect(mockUndoChanges).toHaveBeenCalledWith(changes.changes);
    expect(getUndoDepth()).toBe(0);
  });

  it("saves the reversed changes", async () => {
    setupSession();
    const api = mockApiClient();
    pushUndoOperation("update styles", {
      changes: [{ type: "update", changeNode: { inst: {}, field: "rs" } }],
      newInsts: [],
      removedInsts: [],
    } as any);

    await undo(api);
    expect(api.saveRevision).toHaveBeenCalledTimes(1);
  });

  it("supports multiple sequential undos (LIFO order)", async () => {
    setupSession();
    const api = mockApiClient();

    pushUndoOperation("first edit", {
      changes: [{ type: "update", changeNode: { inst: {}, field: "a" } }],
      newInsts: [],
      removedInsts: [],
    } as any);
    pushUndoOperation("second edit", {
      changes: [{ type: "update", changeNode: { inst: {}, field: "b" } }],
      newInsts: [],
      removedInsts: [],
    } as any);

    const result1 = await undo(api);
    expect(result1.undone).toBe("second edit");
    expect(getUndoDepth()).toBe(1);

    const result2 = await undo(api);
    expect(result2.undone).toBe("first edit");
    expect(getUndoDepth()).toBe(0);
  });

  it("does not push an undo-of-undo onto the stack", async () => {
    setupSession();
    const api = mockApiClient();
    pushUndoOperation("edit", emptyRecordedChanges());

    await undo(api);
    // Stack should be empty — undo itself was NOT pushed
    expect(getUndoDepth()).toBe(0);
  });

  it("increments revision number after undo", async () => {
    setupSession();
    const api = mockApiClient();
    pushUndoOperation("edit", emptyRecordedChanges());

    const result = await undo(api);
    expect(result.save.revisionNum).toBe(6);
  });
});

describe("getUndoDepth", () => {
  it("returns 0 when stack is empty", () => {
    expect(getUndoDepth()).toBe(0);
  });

  it("tracks depth accurately", () => {
    pushUndoOperation("a", emptyRecordedChanges());
    expect(getUndoDepth()).toBe(1);
    pushUndoOperation("b", emptyRecordedChanges());
    expect(getUndoDepth()).toBe(2);
  });
});

describe("MAX_UNDO_DEPTH enforcement", () => {
  it("drops the oldest operation when depth exceeds limit", () => {
    for (let i = 0; i < MAX_UNDO_DEPTH + 5; i++) {
      pushUndoOperation(`op-${i}`, emptyRecordedChanges());
    }
    expect(getUndoDepth()).toBe(MAX_UNDO_DEPTH);
  });

  it("preserves the most recent operations after overflow", async () => {
    setupSession();
    const api = mockApiClient();
    for (let i = 0; i < MAX_UNDO_DEPTH + 3; i++) {
      pushUndoOperation(`op-${i}`, emptyRecordedChanges());
    }
    // The most recent should be op-(MAX_UNDO_DEPTH+2)
    const result = await undo(api);
    expect(result.undone).toBe(`op-${MAX_UNDO_DEPTH + 2}`);
  });

  it("does not exceed limit even with many pushes", () => {
    for (let i = 0; i < 200; i++) {
      pushUndoOperation(`op-${i}`, emptyRecordedChanges());
    }
    expect(getUndoDepth()).toBe(MAX_UNDO_DEPTH);
  });
});

describe("clearUndoStack", () => {
  it("clears all operations", () => {
    pushUndoOperation("a", emptyRecordedChanges());
    pushUndoOperation("b", emptyRecordedChanges());
    clearUndoStack();
    expect(getUndoDepth()).toBe(0);
  });

  it("is a no-op when stack is already empty", () => {
    clearUndoStack(); // should not throw
    expect(getUndoDepth()).toBe(0);
  });
});
