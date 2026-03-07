/**
 * Micro-batch: per-call error isolation with coalesced saves.
 *
 * When the LLM makes parallel MCP tool calls (no explicit begin-batch),
 * each call registers with the micro-batch. Successful calls accumulate
 * changes; failed calls are isolated. When all registered calls settle
 * (committed or failed), the micro-batch flushes: merging committed
 * changes into a single HTTP save and pushing individual undo entries.
 *
 * Why this matters: without micro-batch, a single failed call in a
 * parallel burst triggers cancelBatchWithRollback(), destroying ALL
 * sibling calls' work. With micro-batch, only the failed call is
 * affected — successful siblings are preserved.
 *
 * Dormant when an explicit batch (begin-batch/end-batch) is active.
 *
 * Reference: specs/batch-architecture-research.md
 */

import type { RecordedChanges } from "@/wab/shared/core/observable-model";
import {
  mergeRecordedChanges,
  emptyRecordedChanges,
} from "@/wab/shared/core/observable-model";
import { SaveManager, type SaveResult } from "./save-manager.js";
import { PlasmicApiClient } from "./api-client.js";
import { pushUndoOperation } from "./undo-manager.js";
import { getChangeTracker } from "./change-tracker.js";
import { undoChanges } from "@/wab/shared/core/undo-util";
import { rebaseFromServer } from "./live-sync.js";
import { isBatchActive } from "./batch-manager.js";

/** Safety timeout: flush even if some calls never settle. */
const SAFETY_TIMEOUT_MS = 50;

interface MicroBatchEntry {
  callId: string;
  changes: RecordedChanges;
  modifiedComponentIids: string[];
  description: string;
  status: "pending" | "committed" | "failed";
}

interface MicroBatchState {
  entries: Map<string, MicroBatchEntry>;
  pendingCount: number;
  resolvers: Map<
    string,
    { resolve: (result: SaveResult) => void; reject: (err: unknown) => void }
  >;
  flushTimer: ReturnType<typeof setTimeout> | null;
  safetyTimer: ReturnType<typeof setTimeout> | null;
}

let state: MicroBatchState | null = null;
let capturedApiClient: PlasmicApiClient | null = null;

/** Thread-local-like current callId set by the handler for saveOrAccumulate. */
let _currentCallId: string | null = null;

export function setCurrentCallId(callId: string | null): void {
  _currentCallId = callId;
}

export function getCurrentCallId(): string | null {
  return _currentCallId;
}

/**
 * Register a call with the micro-batch. Creates the batch on first call.
 * No-op when an explicit batch is active.
 */
export function registerCall(callId: string): void {
  if (isBatchActive()) return;

  if (!state) {
    state = {
      entries: new Map(),
      pendingCount: 0,
      resolvers: new Map(),
      flushTimer: null,
      safetyTimer: null,
    };
  }

  state.entries.set(callId, {
    callId,
    changes: emptyRecordedChanges(),
    modifiedComponentIids: [],
    description: "",
    status: "pending",
  });
  state.pendingCount++;

  // Safety timer: flush after timeout even if some calls never settle
  if (!state.safetyTimer) {
    state.safetyTimer = setTimeout(() => {
      if (state) {
        for (const entry of state.entries.values()) {
          if (entry.status === "pending") {
            entry.status = "failed";
            state.pendingCount--;
          }
        }
        void doFlush();
      }
    }, SAFETY_TIMEOUT_MS);
  }
}

/**
 * Commit a call's changes to the micro-batch.
 * Returns a promise that resolves when the batch saves.
 */
export function commitCall(
  callId: string,
  apiClient: PlasmicApiClient,
  changes: RecordedChanges,
  description: string,
  modifiedComponentIids: string[]
): Promise<SaveResult> {
  if (!state || !state.entries.has(callId)) {
    throw new Error(`Micro-batch: unknown callId ${callId}`);
  }

  capturedApiClient = apiClient;

  const entry = state.entries.get(callId)!;
  entry.changes = changes;
  entry.description = description;
  entry.modifiedComponentIids = modifiedComponentIids;
  entry.status = "committed";
  state.pendingCount--;

  const promise = new Promise<SaveResult>((resolve, reject) => {
    state!.resolvers.set(callId, { resolve, reject });
  });

  scheduleFlushIfReady();
  return promise;
}

/**
 * Mark a call as failed. Changes are assumed already rolled back
 * by ChangeRecorder (withRecording auto-reverts on throw).
 */
export function failCall(callId: string): void {
  if (!state || !state.entries.has(callId)) return;

  const entry = state.entries.get(callId)!;
  if (entry.status === "pending") {
    entry.status = "failed";
    state.pendingCount--;
    scheduleFlushIfReady();
  }
}

/** Check if a micro-batch is currently accumulating calls. */
export function isMicroBatchActive(): boolean {
  return state !== null;
}

/**
 * Check if a call has been committed or failed.
 * Returns true for unknown callIds (not tracked = considered settled).
 */
export function isCallSettled(callId: string): boolean {
  if (!state || !state.entries.has(callId)) return true;
  return state.entries.get(callId)!.status !== "pending";
}

/**
 * Schedule flush when all registered calls have settled.
 * Uses setTimeout(0) to allow remaining sync handler starts
 * (from Promise.all dispatch) to register before flushing.
 */
function scheduleFlushIfReady(): void {
  if (!state || state.pendingCount > 0) return;

  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
  }
  state.flushTimer = setTimeout(() => {
    void doFlush();
  }, 0);
}

/**
 * Flush the micro-batch: merge committed changes, save once, push
 * individual undo entries, resolve/reject promises.
 */
async function doFlush(): Promise<void> {
  if (!state) return;

  const currentState = state;
  const apiClient = capturedApiClient;

  // Clear module state so new calls create a fresh micro-batch
  state = null;
  capturedApiClient = null;

  // Clear timers
  if (currentState.flushTimer) clearTimeout(currentState.flushTimer);
  if (currentState.safetyTimer) clearTimeout(currentState.safetyTimer);

  const committed = [...currentState.entries.values()].filter(
    (e) => e.status === "committed"
  );

  if (committed.length === 0 || !apiClient) {
    return;
  }

  // Merge all committed changes into one save
  let mergedChanges = emptyRecordedChanges();
  const allComponentIids = new Set<string>();

  for (const entry of committed) {
    mergedChanges = mergeRecordedChanges(mergedChanges, entry.changes);
    for (const iid of entry.modifiedComponentIids) {
      allComponentIids.add(iid);
    }
  }

  const saveManager = new SaveManager(apiClient, {
    rebaseOnConflict: () => rebaseFromServer(apiClient),
  });

  try {
    const save = await saveManager.saveChanges(
      mergedChanges,
      Array.from(allComponentIids)
    );

    // Push individual undo entries for fine-grained undo
    for (const entry of committed) {
      pushUndoOperation(entry.description, entry.changes);
    }

    // Resolve all committed entries' promises
    for (const entry of committed) {
      const resolver = currentState.resolvers.get(entry.callId);
      if (resolver) resolver.resolve(save);
    }

    console.error(
      `[plasmic-mcp] Micro-batch flushed: ${committed.length} operation(s) saved as revision ${save.revisionNum}`
    );
  } catch (err) {
    // Rollback all committed changes in reverse order
    for (let i = committed.length - 1; i >= 0; i--) {
      try {
        const tracker = getChangeTracker();
        tracker.withRecording(() => {
          undoChanges(committed[i].changes.changes);
        });
      } catch (rollbackErr) {
        console.error(
          `[plasmic-mcp] CRITICAL: Micro-batch rollback failed for "${committed[i].description}". ` +
            `Use refresh-project to reload a clean model. (${rollbackErr})`
        );
      }
    }

    // Reject all promises
    for (const entry of committed) {
      const resolver = currentState.resolvers.get(entry.callId);
      if (resolver) resolver.reject(err);
    }

    console.error(`[plasmic-mcp] Micro-batch flush failed: ${err}`);
  }
}

/** Reset micro-batch state. Used by tests. */
export function resetMicroBatch(): void {
  if (state) {
    if (state.flushTimer) clearTimeout(state.flushTimer);
    if (state.safetyTimer) clearTimeout(state.safetyTimer);
    state = null;
  }
  capturedApiClient = null;
  _currentCallId = null;
}
