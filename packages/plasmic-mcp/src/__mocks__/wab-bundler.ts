/**
 * Mock for @/wab/shared/bundler
 *
 * mockUnbundle is a jest.fn() so tests can configure return values per-test.
 * M2: added mockFastBundle and mockAddrOf for incremental save tests.
 */

export const mockUnbundle = jest.fn();
export const mockFastBundle = jest.fn();
export const mockAddrOf = jest.fn();

export class FastBundler {
  constructor(_meta: any, _classes: any) {}

  unbundle(bundle: any, projectId: string): any {
    return mockUnbundle(bundle, projectId);
  }

  bundle(site: any, _projectId: string): any {
    return site;
  }

  fastBundle(root: any, uuid: string, changedInsts: any[]): any {
    return mockFastBundle(root, uuid, changedInsts);
  }

  addrOf(inst: any): { uuid: string; iid: string } | undefined {
    return mockAddrOf(inst);
  }
}
