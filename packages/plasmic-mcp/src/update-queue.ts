/**
 * Update queue for processing WebSocket model update events.
 *
 * Wraps Studio's PushPullQueue from @/wab/commons/asyncutil with gating
 * logic for saves and mutations. Ensures updates are processed sequentially
 * (matching Studio's modelChangeQueue pattern) and provides filtering for
 * self-updates and branch mismatches.
 *
 * Reference: StudioCtx.tsx modelChangeQueue (lines 4196-4199)
 */

import { PushPullQueue } from "@/wab/commons/asyncutil";
import type { UpdateEventData } from "./socket-client.js";

export type UpdateHandler = (data: UpdateEventData) => Promise<void>;

/**
 * Manages sequential processing of socket update events with gating.
 */
export class UpdateQueue {
  private queue = new PushPullQueue<UpdateEventData>();
  private processing = false;
  private stopped = false;

  /** Callback invoked for each update after filtering. */
  private handler: UpdateHandler;

  /** Function to check if a save is currently in flight (P0.6 coordination). */
  private isSaving: () => boolean;

  /** Function to get the pending saved revision number for self-update detection. */
  private getPendingSavedRevisionNum: () => number | undefined;

  constructor(opts: {
    handler: UpdateHandler;
    isSaving?: () => boolean;
    getPendingSavedRevisionNum?: () => number | undefined;
  }) {
    this.handler = opts.handler;
    this.isSaving = opts.isSaving ?? (() => false);
    this.getPendingSavedRevisionNum =
      opts.getPendingSavedRevisionNum ?? (() => undefined);
  }

  /**
   * Enqueue an update event for processing.
   * Applies pre-enqueue filtering:
   * - Self-update detection: skip our own echoed saves
   * - Branch filtering: skip updates for branches (MCP doesn't support branches)
   */
  enqueue(data: UpdateEventData): void {
    if (this.stopped) return;

    // Branch filtering: skip non-main-branch updates (MCP doesn't support branches)
    if (data.rev.branchId !== null) {
      console.error(
        `[plasmic-mcp] UpdateQueue: skipping branch update (branch=${data.rev.branchId})`
      );
      return;
    }

    // Self-update filtering: skip our own echoed saves
    const pendingRev = this.getPendingSavedRevisionNum();
    if (pendingRev !== undefined && pendingRev >= data.rev.revision) {
      console.error(
        `[plasmic-mcp] UpdateQueue: skipping self-update (pending=${pendingRev}, rev=${data.rev.revision})`
      );
      return;
    }

    this.queue.push(data);

    // Start processing if not already running
    if (!this.processing) {
      this.processLoop();
    }
  }

  /**
   * Process queued updates sequentially.
   * Pauses when a save is in flight, resumes after.
   */
  private async processLoop(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (!this.stopped) {
        const data = await this.queue.pull();
        if (this.stopped) break;

        // Wait for any in-flight save to complete before processing
        while (this.isSaving() && !this.stopped) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (this.stopped) break;

        try {
          await this.handler(data);
        } catch (err) {
          console.error(
            `[plasmic-mcp] UpdateQueue: handler error for revision ${data.rev.revision}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Stop the queue and discard any pending updates.
   * Called on session clear or project switch.
   */
  stop(): void {
    this.stopped = true;
    // Push a sentinel to unblock the pull() if it's waiting
    this.queue.push({
      projectId: "",
      rev: { revision: -1, branchId: null },
    });
  }

  /**
   * Check if the queue is actively processing updates.
   */
  isProcessing(): boolean {
    return this.processing;
  }
}
