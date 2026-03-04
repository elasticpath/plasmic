/**
 * Mock for @/wab/shared/bundler
 *
 * mockUnbundle is a vi.fn() so tests can configure return values per-test.
 * M2: added mockFastBundle and mockAddrOf for incremental save tests.
 */

import { vi } from "vitest";

export const mockUnbundle = vi.fn();
export const mockFastBundle = vi.fn();
export const mockAddrOf = vi.fn();
export const mockRecomputeParents = vi.fn();

export class FastBundler {
  constructor(_meta: any, _classes: any) {}

  unbundle(bundle: any, projectId: string): any {
    return mockUnbundle(bundle, projectId);
  }

  bundle(site: any, _projectId: string, _version: string): any {
    return site;
  }

  fastBundle(root: any, uuid: string, changedInsts: any[]): any {
    return mockFastBundle(root, uuid, changedInsts);
  }

  addrOf(inst: any): { uuid: string; iid: string } | undefined {
    return mockAddrOf(inst);
  }

  recomputeParents(bundle: any, projectId: string): void {
    mockRecomputeParents(bundle, projectId);
  }
}
