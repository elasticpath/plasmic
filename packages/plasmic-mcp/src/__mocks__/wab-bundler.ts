/**
 * Mock for @/wab/shared/bundler
 *
 * mockUnbundle is a vi.fn() so tests can configure return values per-test.
 * M2: added mockFastBundle and mockAddrOf for incremental save tests.
 * P0.0: added mockUnbundlePartial, mockAllUuids, mockObjByAddr for WebSocket rebase.
 */

import { vi } from "vitest";

export const mockUnbundle = vi.fn();
export const mockFastBundle = vi.fn();
export const mockAddrOf = vi.fn();
export const mockRecomputeParents = vi.fn();
export const mockUnbundlePartial = vi.fn();
export const mockAllUuids = vi.fn().mockReturnValue([]);
export const mockObjByAddr = vi.fn();
export const mockCachedBundle = vi.fn();

// Pre-save bundle validators exported from @/wab/shared/bundler in Studio.
// Exposed as vi.fn() so unit tests can configure them to throw per-case to
// prove the save-path wiring surfaces validator errors. Default: no-op, which
// matches the Studio behavior on a well-formed bundle.
export const mockCheckExistingReferences = vi.fn();
export const mockCheckRefsInBundle = vi.fn();

export function checkExistingReferences(bundle: unknown): void {
  mockCheckExistingReferences(bundle);
}
export function checkRefsInBundle(bundle: unknown, opts?: unknown): void {
  mockCheckRefsInBundle(bundle, opts);
}

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

  unbundlePartial(bundle: any, uuid: string): void {
    mockUnbundlePartial(bundle, uuid);
  }

  allUuids(): string[] {
    return mockAllUuids();
  }

  objByAddr(addr: { uuid: string; iid: string }): any | undefined {
    return mockObjByAddr(addr);
  }

  cachedBundle(): any {
    return mockCachedBundle();
  }
}
