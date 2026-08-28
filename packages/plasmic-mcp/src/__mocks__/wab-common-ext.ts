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

export function notNil<T>(x: T | null | undefined): x is T {
  return x != null;
}

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${x}`);
}

export function jsonClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function last<T>(xs: readonly T[]): T {
  return xs[xs.length - 1];
}

export function withoutNils<T>(xs: readonly (T | null | undefined)[]): T[] {
  return xs.filter((x): x is T => x != null);
}
