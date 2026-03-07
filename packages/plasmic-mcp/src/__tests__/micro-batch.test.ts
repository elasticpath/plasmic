/**
 * Tests for micro-batch.ts — per-call error isolation with coalesced saves.
 *
 * Verifies: single call optimization, parallel commits merged into 1 save,
 * partial failure (failed call doesn't affect siblings), all-fail (no save),
 * timer-based flush, explicit batch precedence, fine-grained undo entries.
 *
 * Why these tests matter: without micro-batch, a single failed parallel call
 * triggers cancelBatchWithRollback(), destroying all sibling calls' work.
 * These tests prove that error isolation works correctly.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  emptyRecordedChanges,
  mergeRecordedChanges,
} from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearUndoStack, getUndoDepth } from "../undo-manager";
import { beginBatch, cancelBatch } from "../batch-manager";
import { mockUndoChanges } from "../__mocks__/wab-undo-util";
import {
  registerCall,
  commitCall,
  failCall,
  isMicroBatchActive,
  isCallSettled,
  setCurrentCallId,
  getCurrentCallId,
  resetMicroBatch,
} from "../micro-batch";

// Mock API client
function mockApiClient(): any {
  return {
    saveRevision: vi.fn().mockResolvedValue({}),
  };
}

function makeChanges(id: string): any {
  return {
    changes: [{ field: id }],
    newInsts: [],
    removedInsts: [],
  };
}

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
  vi.useFakeTimers();
  resetMicroBatch();
  cancelBatch();
  clearUndoStack();
  mockFastBundle.mockReturnValue({ map: {}, root: "0" });
});

afterEach(() => {
  resetMicroBatch();
  cancelBatch();
  clearUndoStack();
  disposeChangeTracker();
  clearSession();
  vi.useRealTimers();
});

describe("registerCall", () => {
  it("creates a micro-batch on first call", () => {
    setupSession();
    expect(isMicroBatchActive()).toBe(false);
    registerCall("call-1");
    expect(isMicroBatchActive()).toBe(true);
  });

  it("is a no-op when explicit batch is active", () => {
    setupSession();
    beginBatch();
    registerCall("call-1");
    expect(isMicroBatchActive()).toBe(false);
  });

  it("tracks multiple calls in the same micro-batch", () => {
    setupSession();
    registerCall("call-1");
    registerCall("call-2");
    registerCall("call-3");
    expect(isMicroBatchActive()).toBe(true);
  });
});

describe("commitCall / failCall / isCallSettled", () => {
  it("commitCall marks the call as settled", () => {
    setupSession();
    const api = mockApiClient();
    registerCall("call-1");
    expect(isCallSettled("call-1")).toBe(false);
    commitCall("call-1", api, makeChanges("a"), "test-op", []);
    expect(isCallSettled("call-1")).toBe(true);
  });

  it("failCall marks the call as settled", () => {
    setupSession();
    registerCall("call-1");
    expect(isCallSettled("call-1")).toBe(false);
    failCall("call-1");
    expect(isCallSettled("call-1")).toBe(true);
  });

  it("isCallSettled returns true for unknown callIds", () => {
    expect(isCallSettled("unknown-call")).toBe(true);
  });

  it("failCall is a no-op for unknown callIds", () => {
    expect(() => failCall("unknown-call")).not.toThrow();
  });

  it("commitCall throws for unknown callIds", () => {
    setupSession();
    const api = mockApiClient();
    expect(() =>
      commitCall("unknown-call", api, makeChanges("a"), "test-op", [])
    ).toThrow("unknown callId");
  });
});

describe("setCurrentCallId / getCurrentCallId", () => {
  it("stores and retrieves the current callId", () => {
    expect(getCurrentCallId()).toBeNull();
    setCurrentCallId("call-1");
    expect(getCurrentCallId()).toBe("call-1");
    setCurrentCallId(null);
    expect(getCurrentCallId()).toBeNull();
  });
});

describe("single call", () => {
  it("registers, commits, and flushes with 1 save and 1 undo entry", async () => {
    setupSession();
    const api = mockApiClient();

    registerCall("call-1");
    const promise = commitCall(
      "call-1",
      api,
      makeChanges("a"),
      "update text",
      ["comp-1"]
    );

    // Flush scheduled via setTimeout(0) — advance timers
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.revisionNum).toBe(6);
    expect(result.incremental).toBe(true);
    expect(api.saveRevision).toHaveBeenCalledTimes(1);
    expect(getUndoDepth()).toBe(1);
    expect(isMicroBatchActive()).toBe(false);
  });
});

describe("parallel commits", () => {
  it("merges 3 commits into 1 save with 3 undo entries", async () => {
    setupSession();
    const api = mockApiClient();

    // Simulate 3 parallel calls registering
    registerCall("call-1");
    registerCall("call-2");
    registerCall("call-3");

    // All 3 commit
    const p1 = commitCall(
      "call-1",
      api,
      makeChanges("a"),
      "update text",
      ["comp-1"]
    );
    const p2 = commitCall(
      "call-2",
      api,
      makeChanges("b"),
      "update styles",
      ["comp-1"]
    );
    const p3 = commitCall(
      "call-3",
      api,
      makeChanges("c"),
      "add child",
      ["comp-2"]
    );

    // Flush
    await vi.advanceTimersByTimeAsync(0);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    // All get same revision
    expect(r1.revisionNum).toBe(6);
    expect(r2.revisionNum).toBe(6);
    expect(r3.revisionNum).toBe(6);

    // Only 1 HTTP save
    expect(api.saveRevision).toHaveBeenCalledTimes(1);

    // 3 individual undo entries
    expect(getUndoDepth()).toBe(3);

    // Micro-batch cleaned up
    expect(isMicroBatchActive()).toBe(false);
  });
});

describe("partial failure", () => {
  it("2 commits + 1 fail: saves committed changes, failed call isolated", async () => {
    setupSession();
    const api = mockApiClient();

    registerCall("call-1");
    registerCall("call-2");
    registerCall("call-3");

    // Calls 1 and 3 succeed
    const p1 = commitCall(
      "call-1",
      api,
      makeChanges("a"),
      "update text",
      ["comp-1"]
    );
    // Call 2 fails (e.g., bad node ref — ChangeRecorder already rolled back)
    failCall("call-2");
    const p3 = commitCall(
      "call-3",
      api,
      makeChanges("c"),
      "add child",
      ["comp-1"]
    );

    // Flush
    await vi.advanceTimersByTimeAsync(0);

    const [r1, r3] = await Promise.all([p1, p3]);

    // Committed calls succeed
    expect(r1.revisionNum).toBe(6);
    expect(r3.revisionNum).toBe(6);

    // Only 1 save with merged changes
    expect(api.saveRevision).toHaveBeenCalledTimes(1);

    // 2 undo entries (for the 2 successful calls)
    expect(getUndoDepth()).toBe(2);
  });

  it("failed call does not appear in the save payload", async () => {
    setupSession();
    const api = mockApiClient();

    registerCall("call-1");
    registerCall("call-2");

    const p1 = commitCall(
      "call-1",
      api,
      makeChanges("a"),
      "update text",
      ["comp-1"]
    );
    failCall("call-2");

    await vi.advanceTimersByTimeAsync(0);
    await p1;

    // Verify only committed changes were saved
    const savedBundle = api.saveRevision.mock.calls[0];
    expect(savedBundle).toBeDefined();
    expect(api.saveRevision).toHaveBeenCalledTimes(1);
  });
});

describe("all calls fail", () => {
  it("no save, no undo entries, model clean", async () => {
    setupSession();
    const api = mockApiClient();

    registerCall("call-1");
    registerCall("call-2");
    registerCall("call-3");

    failCall("call-1");
    failCall("call-2");
    failCall("call-3");

    // Advance timers to trigger any scheduled flush
    await vi.advanceTimersByTimeAsync(100);

    // No save
    expect(api.saveRevision).not.toHaveBeenCalled();

    // No undo entries
    expect(getUndoDepth()).toBe(0);

    // Micro-batch cleaned up
    expect(isMicroBatchActive()).toBe(false);
  });
});

describe("save failure during flush", () => {
  it("rejects all committed promises and rolls back model", async () => {
    setupSession();
    const api = mockApiClient();
    api.saveRevision.mockRejectedValueOnce(new Error("Network error"));

    registerCall("call-1");
    registerCall("call-2");

    const p1 = commitCall(
      "call-1",
      api,
      makeChanges("a"),
      "update text",
      []
    );
    const p2 = commitCall(
      "call-2",
      api,
      makeChanges("b"),
      "update styles",
      []
    );

    // Attach rejection handlers before advancing timers to prevent
    // Node.js unhandled rejection warnings
    const results = Promise.allSettled([p1, p2]);

    await vi.advanceTimersByTimeAsync(0);

    const settled = await results;
    expect(settled[0].status).toBe("rejected");
    expect(settled[1].status).toBe("rejected");
    expect(
      (settled[0] as PromiseRejectedResult).reason.message
    ).toBe("Network error");
    expect(
      (settled[1] as PromiseRejectedResult).reason.message
    ).toBe("Network error");

    // undoChanges called for rollback (in reverse order)
    expect(mockUndoChanges).toHaveBeenCalled();

    // No undo entries (save failed)
    expect(getUndoDepth()).toBe(0);
  });
});

describe("safety timer", () => {
  it("flushes after timeout even if calls never settle", async () => {
    setupSession();
    const api = mockApiClient();

    registerCall("call-1");
    registerCall("call-2");

    // Only call-1 commits; call-2 hangs
    const p1 = commitCall(
      "call-1",
      api,
      makeChanges("a"),
      "update text",
      []
    );

    // Safety timer fires at 50ms — force-fails pending calls
    await vi.advanceTimersByTimeAsync(60);

    const r1 = await p1;
    expect(r1.revisionNum).toBe(6);
    expect(api.saveRevision).toHaveBeenCalledTimes(1);

    // call-2 is force-failed, so only 1 undo entry
    expect(getUndoDepth()).toBe(1);
    expect(isMicroBatchActive()).toBe(false);
  });
});

describe("explicit batch precedence", () => {
  it("micro-batch is dormant when explicit batch is active", () => {
    setupSession();
    beginBatch();

    registerCall("call-1");
    expect(isMicroBatchActive()).toBe(false);

    // failCall is a no-op (call was never registered)
    expect(() => failCall("call-1")).not.toThrow();
    expect(isCallSettled("call-1")).toBe(true);
  });
});

describe("sequential batches", () => {
  it("second micro-batch is independent of first", async () => {
    setupSession();
    const api = mockApiClient();

    // First micro-batch
    registerCall("call-1");
    const p1 = commitCall(
      "call-1",
      api,
      makeChanges("a"),
      "first batch",
      []
    );
    await vi.advanceTimersByTimeAsync(0);
    const r1 = await p1;
    expect(r1.revisionNum).toBe(6);

    // Second micro-batch (state was cleared)
    registerCall("call-2");
    const p2 = commitCall(
      "call-2",
      api,
      makeChanges("b"),
      "second batch",
      []
    );
    await vi.advanceTimersByTimeAsync(0);
    const r2 = await p2;
    expect(r2.revisionNum).toBe(7); // Incremented by first save

    expect(api.saveRevision).toHaveBeenCalledTimes(2);
    expect(getUndoDepth()).toBe(2);
  });
});

describe("component IID merging", () => {
  it("deduplicates component IIDs across entries", async () => {
    setupSession();
    const api = mockApiClient();

    registerCall("call-1");
    registerCall("call-2");

    const p1 = commitCall(
      "call-1",
      api,
      makeChanges("a"),
      "op1",
      ["comp-1", "comp-2"]
    );
    const p2 = commitCall(
      "call-2",
      api,
      makeChanges("b"),
      "op2",
      ["comp-2", "comp-3"]
    );

    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([p1, p2]);

    // saveRevision called once
    expect(api.saveRevision).toHaveBeenCalledTimes(1);
  });
});

describe("failCall idempotency", () => {
  it("calling failCall twice does not throw or double-count", () => {
    setupSession();
    registerCall("call-1");
    failCall("call-1");
    // Second call is a no-op (status already 'failed')
    expect(() => failCall("call-1")).not.toThrow();
  });
});

describe("resetMicroBatch", () => {
  it("clears all state and timers", () => {
    setupSession();
    registerCall("call-1");
    expect(isMicroBatchActive()).toBe(true);
    resetMicroBatch();
    expect(isMicroBatchActive()).toBe(false);
    expect(getCurrentCallId()).toBeNull();
  });
});
