/**
 * Unit tests for update-queue.ts
 *
 * Tests sequential processing, save-in-flight gating, rapid event queuing,
 * self-update filtering, and branch filtering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UpdateQueue } from "../update-queue.js";
import type { UpdateEventData } from "../socket-client.js";

function makeUpdate(revision: number, branchId: string | null = null): UpdateEventData {
  return {
    projectId: "proj-123",
    rev: { revision, branchId },
  };
}

describe("UpdateQueue", () => {
  let handler: ReturnType<typeof vi.fn>;
  let queue: UpdateQueue;

  beforeEach(() => {
    handler = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    queue?.stop();
  });

  describe("sequential processing", () => {
    it("processes updates in order", async () => {
      const processed: number[] = [];
      handler = vi.fn().mockImplementation(async (data: UpdateEventData) => {
        processed.push(data.rev.revision);
      });
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1));
      queue.enqueue(makeUpdate(2));
      queue.enqueue(makeUpdate(3));

      // Wait for processing
      await vi.waitFor(() => {
        expect(processed).toEqual([1, 2, 3]);
      });
    });

    it("processes rapid events sequentially (not in parallel)", async () => {
      let concurrency = 0;
      let maxConcurrency = 0;

      handler = vi.fn().mockImplementation(async () => {
        concurrency++;
        maxConcurrency = Math.max(maxConcurrency, concurrency);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrency--;
      });
      queue = new UpdateQueue({ handler });

      // Enqueue several updates rapidly
      for (let i = 1; i <= 5; i++) {
        queue.enqueue(makeUpdate(i));
      }

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(5);
      });

      expect(maxConcurrency).toBe(1);
    });
  });

  describe("branch filtering", () => {
    it("skips updates for non-null branches when on main (default)", async () => {
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1, "branch-abc"));

      // Give it a moment — should NOT be processed
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(handler).not.toHaveBeenCalled();
    });

    it("processes updates for null branch when on main (default)", async () => {
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1, null));

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });

    it("processes updates matching the active branch", async () => {
      queue = new UpdateQueue({
        handler,
        getActiveBranchId: () => "branch-abc",
      });

      queue.enqueue(makeUpdate(1, "branch-abc"));

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });

    it("skips main-branch updates when on a feature branch", async () => {
      queue = new UpdateQueue({
        handler,
        getActiveBranchId: () => "branch-abc",
      });

      queue.enqueue(makeUpdate(1, null));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(handler).not.toHaveBeenCalled();
    });

    it("skips updates for a different branch", async () => {
      queue = new UpdateQueue({
        handler,
        getActiveBranchId: () => "branch-abc",
      });

      queue.enqueue(makeUpdate(1, "branch-xyz"));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(handler).not.toHaveBeenCalled();
    });

    it("tracks branch changes dynamically", async () => {
      let activeBranch: string | null = null;
      const processed: Array<{ rev: number; branch: string | null }> = [];
      handler = vi.fn().mockImplementation(async (data: UpdateEventData) => {
        processed.push({ rev: data.rev.revision, branch: data.rev.branchId });
      });

      queue = new UpdateQueue({
        handler,
        getActiveBranchId: () => activeBranch,
      });

      // On main branch — accept main, reject feature
      queue.enqueue(makeUpdate(1, null));
      queue.enqueue(makeUpdate(2, "branch-abc"));

      await vi.waitFor(() => {
        expect(processed).toHaveLength(1);
      });
      expect(processed[0]).toEqual({ rev: 1, branch: null });

      // Switch to feature branch — accept feature, reject main
      activeBranch = "branch-abc";
      queue.enqueue(makeUpdate(3, null));
      queue.enqueue(makeUpdate(4, "branch-abc"));

      await vi.waitFor(() => {
        expect(processed).toHaveLength(2);
      });
      expect(processed[1]).toEqual({ rev: 4, branch: "branch-abc" });
    });
  });

  describe("self-update filtering", () => {
    it("skips updates when pendingSavedRevisionNum >= revision", async () => {
      queue = new UpdateQueue({
        handler,
        getPendingSavedRevisionNum: () => 5,
      });

      queue.enqueue(makeUpdate(4));
      queue.enqueue(makeUpdate(5));

      // Give it a moment — should NOT be processed
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(handler).not.toHaveBeenCalled();
    });

    it("processes updates when revision > pendingSavedRevisionNum", async () => {
      queue = new UpdateQueue({
        handler,
        getPendingSavedRevisionNum: () => 5,
      });

      queue.enqueue(makeUpdate(6));

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });

    it("processes all updates when no pending save", async () => {
      queue = new UpdateQueue({
        handler,
        getPendingSavedRevisionNum: () => undefined,
      });

      queue.enqueue(makeUpdate(1));
      queue.enqueue(makeUpdate(2));

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("save-in-flight gating", () => {
    it("pauses processing while save is in flight", async () => {
      let saving = true;
      const processed: number[] = [];
      handler = vi.fn().mockImplementation(async (data: UpdateEventData) => {
        processed.push(data.rev.revision);
      });

      queue = new UpdateQueue({
        handler,
        isSaving: () => saving,
      });

      queue.enqueue(makeUpdate(1));

      // Wait a bit — should be blocked
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(processed).toEqual([]);

      // Unblock
      saving = false;

      await vi.waitFor(() => {
        expect(processed).toEqual([1]);
      });
    });
  });

  describe("error handling", () => {
    it("continues processing after handler error", async () => {
      const processed: number[] = [];
      handler = vi.fn().mockImplementation(async (data: UpdateEventData) => {
        if (data.rev.revision === 2) {
          throw new Error("processing failed");
        }
        processed.push(data.rev.revision);
      });
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1));
      queue.enqueue(makeUpdate(2)); // will throw
      queue.enqueue(makeUpdate(3));

      await vi.waitFor(() => {
        expect(processed).toEqual([1, 3]);
      });
    });
  });

  describe("stop", () => {
    it("stops processing and ignores new enqueues", async () => {
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1));
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      queue.stop();
      queue.enqueue(makeUpdate(2));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("enqueue after stop is silently ignored (race condition safety)", async () => {
      const processed: number[] = [];
      handler = vi.fn().mockImplementation(async (data: UpdateEventData) => {
        processed.push(data.rev.revision);
        // Slow handler — gives time for stop+enqueue race
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1));

      // Wait for handler to start processing rev 1
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      // Stop while handler is still running
      queue.stop();

      // Enqueue after stop — should be silently dropped
      queue.enqueue(makeUpdate(2));
      queue.enqueue(makeUpdate(3));

      await new Promise((resolve) => setTimeout(resolve, 100));
      // Only rev 1 should have been processed (stop breaks the loop)
      expect(processed).toEqual([1]);
    });
  });

  describe("isProcessing", () => {
    it("returns false when idle", () => {
      queue = new UpdateQueue({ handler });
      expect(queue.isProcessing()).toBe(false);
    });

    it("returns true while handler is running", async () => {
      let resolveHandler!: () => void;
      handler = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveHandler = resolve;
          })
      );
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1));

      // Wait for handler to be called
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      expect(queue.isProcessing()).toBe(true);

      // Complete the handler
      resolveHandler();

      // Give processLoop time to loop back and wait on pull()
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Still processing because processLoop is waiting on next pull()
      expect(queue.isProcessing()).toBe(true);
    });

    it("returns false after stop", async () => {
      handler = vi.fn().mockResolvedValue(undefined);
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1));
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      queue.stop();
      // Give processLoop time to break and set processing = false
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(queue.isProcessing()).toBe(false);
    });
  });

  describe("handler error + concurrent enqueue", () => {
    it("processes enqueued item during handler error recovery", async () => {
      const processed: number[] = [];
      handler = vi.fn().mockImplementation(async (data: UpdateEventData) => {
        if (data.rev.revision === 1) {
          // Simulate slow error
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new Error("handler failed on rev 1");
        }
        processed.push(data.rev.revision);
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1)); // will fail

      // Wait for rev 1 to start processing, then enqueue rev 2
      await new Promise((resolve) => setTimeout(resolve, 5));
      queue.enqueue(makeUpdate(2));

      await vi.waitFor(() => {
        expect(processed).toEqual([2]);
      });

      // Error should have been logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("handler error for revision 1")
      );
      consoleSpy.mockRestore();
    });
  });
});
