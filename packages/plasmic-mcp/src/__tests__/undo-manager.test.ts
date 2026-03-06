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
  getStack,
  replaceStack,
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

describe("undo save failure rollback", () => {
  it("rolls back model and re-pushes operation when save fails", async () => {
    setupSession();
    const api = mockApiClient();
    api.saveRevision.mockRejectedValue(new Error("network down"));

    const changes = {
      changes: [{ type: "update", changeNode: { inst: { id: 1 }, field: "text" } }],
      newInsts: [],
      removedInsts: [],
    };
    pushUndoOperation("failed edit", changes as any);

    await expect(undo(api)).rejects.toThrow("network down");

    // Operation should be re-pushed onto the stack for retry
    expect(getUndoDepth()).toBe(1);
    // undoChanges should have been called twice:
    // once for the undo, once for the rollback (reversal of reversal)
    expect(mockUndoChanges).toHaveBeenCalledTimes(2);
  });

  it("preserves stack depth on save failure", async () => {
    setupSession();
    const api = mockApiClient();

    pushUndoOperation("good edit", emptyRecordedChanges());
    pushUndoOperation("failing edit", emptyRecordedChanges());

    // First undo succeeds
    await undo(api);
    expect(getUndoDepth()).toBe(1);

    // Second undo fails
    api.saveRevision.mockRejectedValue(new Error("server error"));
    await expect(undo(api)).rejects.toThrow("server error");
    // Operation should be re-pushed — depth stays 1
    expect(getUndoDepth()).toBe(1);
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

describe("getStack / replaceStack", () => {
  it("getStack returns the live undo stack array", () => {
    pushUndoOperation("op-1", emptyRecordedChanges());
    pushUndoOperation("op-2", emptyRecordedChanges());

    const stack = getStack();
    expect(stack).toHaveLength(2);
    expect(stack[0].description).toBe("op-1");
    expect(stack[1].description).toBe("op-2");
  });

  it("replaceStack replaces the entire undo stack", () => {
    pushUndoOperation("old", emptyRecordedChanges());
    expect(getUndoDepth()).toBe(1);

    replaceStack([
      { description: "rebased-1", changes: [] },
      { description: "rebased-2", changes: [] },
      { description: "rebased-3", changes: [] },
    ]);

    expect(getUndoDepth()).toBe(3);
    const stack = getStack();
    expect(stack.map((e) => e.description)).toEqual([
      "rebased-1",
      "rebased-2",
      "rebased-3",
    ]);
  });

  it("replaceStack with empty array clears the stack", () => {
    pushUndoOperation("a", emptyRecordedChanges());
    replaceStack([]);
    expect(getUndoDepth()).toBe(0);
  });
});

describe("undo rollback CRITICAL log", () => {
  it("logs CRITICAL when rollback itself fails after save error", async () => {
    setupSession();
    const api = mockApiClient();
    api.saveRevision.mockRejectedValue(new Error("save failed"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const changes = {
      changes: [{ type: "update", changeNode: { inst: { id: 1 }, field: "text" } }],
      newInsts: [],
      removedInsts: [],
    };
    pushUndoOperation("failing edit", changes as any);

    // Make the rollback undoChanges call throw (second call)
    let callCount = 0;
    mockUndoChanges.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        throw new Error("rollback explosion");
      }
    });

    await expect(undo(api)).rejects.toThrow("save failed");

    // CRITICAL log should have been emitted
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("CRITICAL: Undo rollback failed")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("rollback explosion")
    );

    // Operation should still be re-pushed for retry
    expect(getUndoDepth()).toBe(1);
    consoleSpy.mockRestore();
  });
});

describe("concurrent undo during save", () => {
  it("second undo proceeds after first completes", async () => {
    setupSession();
    const api = mockApiClient();
    // First save takes a moment
    let resolveFirst!: () => void;
    api.saveRevision
      .mockImplementationOnce(
        () =>
          new Promise<any>((resolve) => {
            resolveFirst = () => resolve({});
          })
      )
      .mockResolvedValueOnce({});

    pushUndoOperation("edit-A", {
      changes: [{ type: "update", changeNode: { inst: {}, field: "a" } }],
      newInsts: [],
      removedInsts: [],
    } as any);
    pushUndoOperation("edit-B", {
      changes: [{ type: "update", changeNode: { inst: {}, field: "b" } }],
      newInsts: [],
      removedInsts: [],
    } as any);

    // Start first undo (it will block on save)
    const undo1Promise = undo(api);

    // Start second undo while first is in-flight
    const undo2Promise = undo(api);

    // Resolve the first save
    resolveFirst();

    const result1 = await undo1Promise;
    const result2 = await undo2Promise;

    // Both should succeed — second picks from remaining stack
    expect(result1.undone).toBe("edit-B");
    expect(result2.undone).toBe("edit-A");
    expect(getUndoDepth()).toBe(0);
  });

  it("second undo fails with empty stack if first consumed the last entry", async () => {
    setupSession();
    const api = mockApiClient();

    let resolveFirst!: () => void;
    api.saveRevision.mockImplementationOnce(
      () =>
        new Promise<any>((resolve) => {
          resolveFirst = () => resolve({});
        })
    );

    pushUndoOperation("only-edit", emptyRecordedChanges());

    const undo1Promise = undo(api);
    // Stack is now empty (pop happened synchronously)
    const undo2Promise = undo(api).catch((e: Error) => e);

    resolveFirst();

    const result1 = await undo1Promise;
    const result2 = await undo2Promise;

    expect(result1.undone).toBe("only-edit");
    expect(result2).toBeInstanceOf(Error);
    expect((result2 as Error).message).toBe("Nothing to undo.");
  });
});
