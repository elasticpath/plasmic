/**
 * Batch manager: accumulates changes across multiple edit operations
 * and saves them in a single revision.
 *
 * begin-batch: suppresses auto-save, starts accumulation
 * end-batch: merges all accumulated changes, saves once, clears batch state
 *
 * Why batching matters: without it, each edit (text change, style tweak, add child)
 * is a separate HTTP round-trip. For multi-edit operations (e.g., "update title,
 * subtitle, and background"), batching reduces N saves to 1, cutting latency and
 * avoiding intermediate revision conflicts.
 *
 * Reference: specs/plasmic-incremental-writes.md § begin-batch / end-batch
 */

import { randomUUID } from "crypto";
import type { RecordedChanges } from "@/wab/shared/core/observable-model";
import {
  mergeRecordedChanges,
  emptyRecordedChanges,
} from "@/wab/shared/core/observable-model";
import { SaveManager, type SaveResult } from "./save-manager.js";
import { PlasmicApiClient } from "./api-client.js";
import { requireSession } from "./session.js";
import { pushUndoOperation } from "./undo-manager.js";

interface BatchState {
  batchId: string;
  accumulatedChanges: RecordedChanges;
  modifiedComponentIids: Set<string>;
  operationCount: number;
}

let currentBatch: BatchState | null = null;

/**
 * Start a batch edit session.
 * Subsequent edit operations will accumulate changes without saving.
 */
export function beginBatch(): string {
  if (currentBatch) {
    throw new Error(
      "A batch session is already active. Call end-batch before starting a new one."
    );
  }
  const batchId = randomUUID();
  currentBatch = {
    batchId,
    accumulatedChanges: { ...emptyRecordedChanges },
    modifiedComponentIids: new Set(),
    operationCount: 0,
  };
  console.error(`[plasmic-mcp] Batch session started: ${batchId}`);
  return batchId;
}

/**
 * Check if a batch session is active.
 */
export function isBatchActive(): boolean {
  return currentBatch !== null;
}

/**
 * Get the current batch ID, or null if no batch is active.
 */
export function getBatchId(): string | null {
  return currentBatch?.batchId ?? null;
}

/**
 * Accumulate changes from an edit operation during a batch session.
 * Called by edit tools when batch mode is active instead of saving.
 */
export function accumulateChanges(
  changes: RecordedChanges,
  modifiedComponentIids?: string[]
): void {
  if (!currentBatch) {
    throw new Error("No batch session is active.");
  }
  currentBatch.accumulatedChanges = mergeRecordedChanges(
    currentBatch.accumulatedChanges,
    changes
  );
  if (modifiedComponentIids) {
    for (const iid of modifiedComponentIids) {
      currentBatch.modifiedComponentIids.add(iid);
    }
  }
  currentBatch.operationCount++;
}

/**
 * End the batch session and save all accumulated changes in one revision.
 * Pushes the entire batch as one undo operation.
 */
export async function endBatch(
  apiClient: PlasmicApiClient,
  batchId?: string
): Promise<{ save: SaveResult; operationCount: number }> {
  if (!currentBatch) {
    throw new Error("No batch session is active.");
  }
  if (batchId && batchId !== currentBatch.batchId) {
    throw new Error(
      `Batch ID mismatch: expected "${currentBatch.batchId}", got "${batchId}".`
    );
  }

  const { accumulatedChanges, modifiedComponentIids, operationCount } =
    currentBatch;

  // Clear batch state before saving (so errors don't leave stale state)
  currentBatch = null;

  if (operationCount === 0) {
    const session = requireSession();
    console.error("[plasmic-mcp] Batch session ended with no changes");
    return {
      save: { revisionNum: session.revisionNum, incremental: true },
      operationCount: 0,
    };
  }

  const saveManager = new SaveManager(apiClient);
  const save = await saveManager.saveChanges(
    accumulatedChanges,
    Array.from(modifiedComponentIids)
  );

  // Push entire batch as one undo operation
  pushUndoOperation(`batch of ${operationCount} edits`, accumulatedChanges);

  console.error(
    `[plasmic-mcp] Batch session ended: ${operationCount} operations saved as revision ${save.revisionNum}`
  );

  return { save, operationCount };
}

/**
 * Cancel an active batch session without saving.
 * Used during error recovery or refresh-project.
 */
export function cancelBatch(): void {
  if (currentBatch) {
    console.error(
      `[plasmic-mcp] Batch session cancelled: ${currentBatch.batchId}`
    );
    currentBatch = null;
  }
}
