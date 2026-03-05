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
    it("skips updates for non-null branches", async () => {
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1, "branch-abc"));

      // Give it a moment — should NOT be processed
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(handler).not.toHaveBeenCalled();
    });

    it("processes updates for null branch (main)", async () => {
      queue = new UpdateQueue({ handler });

      queue.enqueue(makeUpdate(1, null));

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });
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
  });
});
