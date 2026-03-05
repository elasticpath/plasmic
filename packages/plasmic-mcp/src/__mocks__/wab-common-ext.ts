/**
 * Mock for @/wab/shared/common
 *
 * Provides xDifference — set difference (elements in a but not in b).
 * Used by the rebase engine to detect dependency deletion.
 */

export function xDifference<T>(a: Iterable<T>, b: Iterable<T>): Set<T> {
  const bSet = new Set(b);
  return new Set([...a].filter((x) => !bSet.has(x)));
}
