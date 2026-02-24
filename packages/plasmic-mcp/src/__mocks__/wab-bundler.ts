/**
 * Mock for @/wab/shared/bundler
 *
 * mockUnbundle is a jest.fn() so tests can configure return values per-test.
 */

export const mockUnbundle = jest.fn();

export class FastBundler {
  constructor(_meta: any, _classes: any) {}

  unbundle(bundle: any, projectId: string): any {
    return mockUnbundle(bundle, projectId);
  }

  bundle(site: any, _projectId: string): any {
    return site;
  }
}
