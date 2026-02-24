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

import {
  ChangeTracker,
  initChangeTracker,
  getChangeTracker,
  disposeChangeTracker,
} from "../change-tracker";
import { mockWithRecording, mockDispose } from "../__mocks__/wab-observable-model";

describe("ChangeTracker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    disposeChangeTracker();
    jest.restoreAllMocks();
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
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    disposeChangeTracker();
  });

  afterEach(() => {
    disposeChangeTracker();
    jest.restoreAllMocks();
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
