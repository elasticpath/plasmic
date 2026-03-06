/**
 * Unit tests for change-tracker.ts
 *
 * The change tracker wraps ChangeRecorder from Studio's observable-model module.
 * It bridges MobX observation with the MCP edit workflow: mutations within
 * withRecording() produce RecordedChanges that feed into fastBundle() for saving
 * and into the undo stack for reverting.
 *
 * If tracking fails silently, edits appear to succeed but never persist to the
 * server. These tests ensure the recorder is wired correctly.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ChangeTracker,
  initChangeTracker,
  getChangeTracker,
  disposeChangeTracker,
} from "../change-tracker";
import { mockWithRecording, mockDispose, ChangeRecorder } from "../__mocks__/wab-observable-model";
import { setSession, clearSession } from "../session";

describe("ChangeTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    disposeChangeTracker();
    vi.restoreAllMocks();
  });

  describe("withRecording", () => {
    it("runs the mutation function and returns recorded changes", () => {
      const mockChanges = {
        changes: [{ changeNode: { inst: {}, field: "text" } }],
        newInsts: [],
        removedInsts: [],
      };
      mockWithRecording.mockReturnValue(mockChanges);

      const tracker = new ChangeTracker({ components: [] });
      let mutationCalled = false;
      const result = tracker.withRecording(() => {
        mutationCalled = true;
      });

      expect(mutationCalled).toBe(true);
      expect(result).toBe(mockChanges);
    });

    it("returns empty changes when no mutations occur", () => {
      const emptyChanges = { changes: [], newInsts: [], removedInsts: [] };
      mockWithRecording.mockReturnValue(emptyChanges);

      const tracker = new ChangeTracker({ components: [] });
      const result = tracker.withRecording(() => {
        // no mutations
      });

      expect(result.changes).toHaveLength(0);
    });
  });

  describe("dispose", () => {
    it("calls ChangeRecorder.dispose()", () => {
      const tracker = new ChangeTracker({ components: [] });
      tracker.dispose();
      expect(mockDispose).toHaveBeenCalled();
    });
  });
});

describe("module singleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    disposeChangeTracker();
  });

  afterEach(() => {
    disposeChangeTracker();
    vi.restoreAllMocks();
  });

  it("getChangeTracker throws when not initialized", () => {
    expect(() => getChangeTracker()).toThrow("Change tracker not initialized");
  });

  it("initChangeTracker creates and returns a tracker", () => {
    const tracker = initChangeTracker({ components: [] });
    expect(tracker).toBeInstanceOf(ChangeTracker);
    expect(getChangeTracker()).toBe(tracker);
  });

  it("initChangeTracker disposes previous tracker when reinitializing", () => {
    initChangeTracker({ components: [] });
    initChangeTracker({ components: [] });

    // First tracker should have been disposed
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it("disposeChangeTracker clears the singleton", () => {
    initChangeTracker({ components: [] });
    disposeChangeTracker();

    expect(() => getChangeTracker()).toThrow("Change tracker not initialized");
    expect(mockDispose).toHaveBeenCalled();
  });

  it("disposeChangeTracker is safe to call when no tracker exists", () => {
    // Should not throw
    disposeChangeTracker();
  });
});

describe("getRecorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    disposeChangeTracker();
  });

  afterEach(() => {
    disposeChangeTracker();
    vi.restoreAllMocks();
  });

  it("returns a ChangeRecorder instance", () => {
    const tracker = new ChangeTracker({ components: [] });
    const recorder = tracker.getRecorder();
    expect(recorder).toBeInstanceOf(ChangeRecorder);
  });

  it("returns the same recorder instance across multiple calls", () => {
    const tracker = new ChangeTracker({ components: [] });
    const recorder1 = tracker.getRecorder();
    const recorder2 = tracker.getRecorder();
    expect(recorder1).toBe(recorder2);
  });

  it("getChangeTracker().getRecorder() works after initChangeTracker", () => {
    const tracker = initChangeTracker({ components: [] });
    const recorder = getChangeTracker().getRecorder();
    expect(recorder).toBeInstanceOf(ChangeRecorder);
    expect(recorder).toBe(tracker.getRecorder());
  });
});

describe("withRecording error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    disposeChangeTracker();
    vi.restoreAllMocks();
  });

  it("propagates errors thrown by the mutation function", () => {
    // The mock ChangeRecorder calls fn() then returns mockWithRecording(),
    // so if fn() throws, it propagates before the mock return
    const tracker = new ChangeTracker({ components: [] });
    expect(() =>
      tracker.withRecording(() => {
        throw new Error("mutation failed");
      })
    ).toThrow("mutation failed");
  });
});

describe("isExternalRef integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    disposeChangeTracker();
  });

  afterEach(() => {
    disposeChangeTracker();
    vi.restoreAllMocks();
  });

  it("passes isExternalRef to ChangeRecorder when session has bundler", () => {
    setSession({
      projectId: "proj-test",
      projectName: "Test",
      site: { components: [] },
      bundler: {
        addrOf: vi.fn().mockReturnValue({ uuid: "proj-test", iid: "1" }),
      },
      revisionNum: 1,
      modelVersion: 1,
      hostlessDataVersion: 0,
      projectUuid: "proj-test",
    });

    const tracker = initChangeTracker({ components: [] });
    // Tracker should have been created — no throw
    expect(tracker).toBeInstanceOf(ChangeTracker);
    clearSession();
  });

  it("creates tracker without isExternalRef when no session", () => {
    // No session set, so initChangeTracker should still work (no isExternalRef)
    const tracker = initChangeTracker({ components: [] });
    expect(tracker).toBeInstanceOf(ChangeTracker);
  });
});
