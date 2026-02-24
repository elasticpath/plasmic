/**
 * Change tracking for incremental saves.
 *
 * Wraps Studio's ChangeRecorder to capture model mutations during edit operations.
 * Each withRecording() call returns the recorded changes, which are used by:
 * - save-manager.ts: to compute the incremental bundle via fastBundle()
 * - undo-manager.ts: to store changes for undo operations
 *
 * Set up after unbundle in the set-project tool handler.
 *
 * Reference: specs/plasmic-incremental-writes.md § MobX Setup
 */

import { ChangeRecorder } from "@/wab/shared/core/observable-model";
import type { RecordedChanges } from "@/wab/shared/core/observable-model";
import { instUtil } from "@/wab/shared/model/InstUtil";

export type { RecordedChanges };

export class ChangeTracker {
  private recorder: ChangeRecorder;

  constructor(site: any) {
    this.recorder = new ChangeRecorder({
      inst: site,
      _instUtil: instUtil,
      incremental: true,
    });
  }

  /**
   * Run a mutation function and capture all model changes.
   * If the function throws, changes are automatically rolled back by ChangeRecorder.
   */
  withRecording(fn: () => void): RecordedChanges {
    return this.recorder.withRecording(fn);
  }

  dispose(): void {
    this.recorder.dispose();
  }
}

// --- Module-level singleton (mirrors session.ts pattern) ---

let currentTracker: ChangeTracker | null = null;

/**
 * Initialize change tracking for a site model.
 * Called during set-project after unbundling.
 * Disposes any previous tracker.
 */
export function initChangeTracker(site: any): ChangeTracker {
  if (currentTracker) {
    currentTracker.dispose();
  }
  currentTracker = new ChangeTracker(site);
  console.error("[plasmic-mcp] Change tracker initialized");
  return currentTracker;
}

/**
 * Get the active change tracker.
 * Throws if no project is loaded.
 */
export function getChangeTracker(): ChangeTracker {
  if (!currentTracker) {
    throw new Error(
      "Change tracker not initialized. Load a project first with set-project."
    );
  }
  return currentTracker;
}

/**
 * Dispose and clear the change tracker.
 * Called when switching projects or clearing session.
 */
export function disposeChangeTracker(): void {
  if (currentTracker) {
    currentTracker.dispose();
    currentTracker = null;
  }
}
