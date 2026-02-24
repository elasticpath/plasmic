/**
 * Mock for @/wab/shared/core/undo-util
 */

export const mockUndoChanges = jest.fn();

export function undoChanges(changes: any[]): void {
  mockUndoChanges(changes);
}
