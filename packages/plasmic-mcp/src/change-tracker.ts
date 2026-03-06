/**
 * Change tracking for incremental saves.
 *
 * Wraps Studio's ChangeRecorder to capture model mutations during edit operations.
 * Each withRecording() call returns the recorded changes, which are used by:
 * - save-manager.ts: to compute the incremental bundle via fastBundle()
 * - undo-manager.ts: to store changes for undo operations
 *
 * Set up after unbundle in the project.set tool handler.
 *
 * Reference: specs/plasmic-incremental-writes.md § MobX Setup
 */

import { ChangeRecorder } from "@/wab/shared/core/observable-model";
import type { RecordedChanges } from "@/wab/shared/core/observable-model";
import { instUtil } from "@/wab/shared/model/InstUtil";
import { makeIsExternalRef } from "./bundler-helpers.js";
import { getSession } from "./session.js";

export type { RecordedChanges };

export class ChangeTracker {
  private recorder: ChangeRecorder;

  constructor(site: any, isExternalRef?: (obj: any) => boolean) {
    this.recorder = new ChangeRecorder({
      inst: site,
      _instUtil: instUtil,
      incremental: true,
      ...(isExternalRef ? { isExternalRef } : {}),
    });
  }

  /**
   * Run a mutation function and capture all model changes.
   * If the function throws, changes are automatically rolled back by ChangeRecorder.
   */
  withRecording(fn: () => void): RecordedChanges {
    return this.recorder.withRecording(fn);
  }

  /**
   * Get the underlying ChangeRecorder instance.
   * Needed by the rebase engine for undoChangesAndResolveConflicts()
   * which requires an IChangeRecorder.
   */
  getRecorder(): ChangeRecorder {
    return this.recorder;
  }

  dispose(): void {
    this.recorder.dispose();
  }
}

// --- Module-level singleton (mirrors session.ts pattern) ---

let currentTracker: ChangeTracker | null = null;

/**
 * Initialize change tracking for a site model.
 * Called during project.set after unbundling.
 * Disposes any previous tracker.
 *
 * When bundler and projectId are available (from the session), passes an
 * isExternalRef callback to the ChangeRecorder. This tells it to skip deep
 * MobX observation of dependency package instances (hostless Components,
 * PropParams, etc.), matching Studio's StudioCtx behavior. Without this,
 * the ChangeRecorder observes all reachable instances including the entire
 * dependency tree, which is wasteful and can cause spurious change recordings.
 */
export function initChangeTracker(site: any): ChangeTracker {
  if (currentTracker) {
    currentTracker.dispose();
  }

  // Auto-detect bundler and projectId from session to create isExternalRef.
  // This works because initChangeTracker is always called AFTER setSession().
  let isExternalRef: ((obj: any) => boolean) | undefined;
  const session = getSession();
  if (session?.bundler && session?.projectUuid) {
    isExternalRef = makeIsExternalRef(session.bundler, session.projectUuid);
  }

  currentTracker = new ChangeTracker(site, isExternalRef);
  console.error("[plasmic-mcp] Change tracker initialized" +
    (isExternalRef ? " (with isExternalRef)" : ""));
  return currentTracker;
}

/**
 * Get the active change tracker.
 * Throws if no project is loaded.
 */
export function getChangeTracker(): ChangeTracker {
  if (!currentTracker) {
    throw new Error(
      "Change tracker not initialized. Load a project first with project.set."
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
