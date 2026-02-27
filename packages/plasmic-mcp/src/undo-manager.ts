/**
 * Undo manager: maintains a stack of edit operations for reversal.
 *
 * Each successful edit pushes its ModelChange[] onto the stack with a description.
 * undo() pops the last operation, applies undoChanges() to reverse the mutations
 * in the live model, then saves the result via SaveManager.
 *
 * Why undo matters: when Claude makes an incorrect edit (wrong node, bad style value),
 * the developer can immediately revert without leaving Claude Code or manually fixing
 * the Plasmic project in Studio.
 *
 * The stack supports multiple sequential undos — each undo is independent and does
 * NOT push a "redo" entry. The stack is cleared on refresh-project since the model
 * state is replaced entirely.
 *
 * Reference: specs/plasmic-incremental-writes.md § undo
 */

import { undoChanges } from "@/wab/shared/core/undo-util";
import type { RecordedChanges } from "@/wab/shared/core/observable-model";
import type { ModelChange } from "@/wab/shared/core/observable-model";
import { getChangeTracker } from "./change-tracker.js";
import { SaveManager, type SaveResult } from "./save-manager.js";
import { PlasmicApiClient } from "./api-client.js";

interface UndoOperation {
  description: string;
  changes: ModelChange[];
}

/**
 * Maximum number of undo operations retained. When the limit is reached,
 * the oldest operation is dropped. This prevents unbounded memory growth
 * during long editing sessions where each operation may carry a full
 * ModelChange[] array.
 */
export const MAX_UNDO_DEPTH = 50;

let undoStack: UndoOperation[] = [];

/**
 * Push an operation onto the undo stack.
 * Called after each successful edit tool save.
 *
 * When the stack exceeds MAX_UNDO_DEPTH, the oldest operation is dropped
 * to bound memory usage.
 */
export function pushUndoOperation(
  description: string,
  changes: RecordedChanges
): void {
  undoStack.push({
    description,
    changes: changes.changes,
  });

  if (undoStack.length > MAX_UNDO_DEPTH) {
    const dropped = undoStack.shift()!;
    console.error(
      `[plasmic-mcp] Undo stack limit (${MAX_UNDO_DEPTH}) reached, dropped oldest: "${dropped.description}"`
    );
  }

  console.error(
    `[plasmic-mcp] Undo stack: pushed "${description}" (depth: ${undoStack.length})`
  );
}

/**
 * Undo the last operation.
 * Reverses the model mutations inside a ChangeRecorder session (so the reversal
 * is captured as changes), then saves the reversed state.
 */
export async function undo(
  apiClient: PlasmicApiClient
): Promise<{ save: SaveResult; undone: string }> {
  if (undoStack.length === 0) {
    throw new Error("Nothing to undo.");
  }

  const operation = undoStack.pop()!;
  const tracker = getChangeTracker();

  // Apply undo inside a recording session so the reversal is tracked for save
  const reverseChanges = tracker.withRecording(() => {
    undoChanges(operation.changes);
  });

  const saveManager = new SaveManager(apiClient);
  const save = await saveManager.saveChanges(reverseChanges);

  console.error(
    `[plasmic-mcp] Undone: "${operation.description}" (remaining depth: ${undoStack.length})`
  );

  return { save, undone: operation.description };
}

/**
 * Get the current undo stack depth.
 */
export function getUndoDepth(): number {
  return undoStack.length;
}

/**
 * Clear the undo stack.
 * Called on refresh-project since the model state is replaced entirely.
 */
export function clearUndoStack(): void {
  const depth = undoStack.length;
  undoStack = [];
  if (depth > 0) {
    console.error(`[plasmic-mcp] Undo stack cleared (was ${depth} deep)`);
  }
}
