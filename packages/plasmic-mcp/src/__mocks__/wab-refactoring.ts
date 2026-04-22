/**
 * Unit-test mock for `@/wab/shared/refactoring`.
 *
 * Unit tests don't exercise the pre-flight reference check (they run with
 * mocked components that have no real expressions); returning false here
 * means the gap #70 guard in `removeQuery` always passes through to the
 * underlying `TplMgr.removeComponentServerQuery`, matching the behaviour
 * the data.test.ts suite was written against.
 *
 * Integration tests in `real-integration.test.ts` import the real helper
 * via `vitest.config.integration.ts`, so the guard runs end-to-end there.
 */

export function isQueryUsedInExpr(
  _queryName: string,
  _expr: unknown
): boolean {
  return false;
}

export function isDataTokenUsedInExpr(
  _token: unknown,
  _expr: unknown,
  _projectId: string
): boolean {
  return false;
}
