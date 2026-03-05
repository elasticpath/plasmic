/**
 * Mock for @/wab/shared/collections
 *
 * Provides arrayReversed — returns a reversed copy without mutating the original.
 * Used by the rebase engine to reverse undo stack entries.
 */

export function arrayReversed<T>(xs: ReadonlyArray<T>): T[] {
  return xs.slice().reverse();
}
