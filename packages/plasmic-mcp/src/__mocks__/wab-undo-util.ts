/**
 * Mock for @/wab/shared/core/undo-util
 */

import { vi } from "vitest";

export const mockUndoChanges = vi.fn();

export function undoChanges(changes: any[]): void {
  mockUndoChanges(changes);
}
