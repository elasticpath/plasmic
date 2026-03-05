/**
 * Mock for @/wab/shared/core/observable-model
 *
 * ChangeRecorder mock captures calls to withRecording() and returns
 * configurable RecordedChanges. Tests can set mockWithRecording.mockReturnValue()
 * to control what changes are "recorded" during a mutation.
 *
 * P0.0: Added IChangeRecorder interface methods and exports.
 */

import { vi } from "vitest";

export const mockWithRecording = vi.fn();
export const mockDispose = vi.fn();

export class ChangeRecorder {
  isRecording = false;

  constructor(_opts: any) {}

  withRecording(fn: () => void): any {
    fn();
    return mockWithRecording();
  }

  dispose(): void {
    mockDispose();
  }

  prune(): void {}
  getToBeDeletedInsts(): Set<any> { return new Set(); }
  getDeletedInstsWithDanglingRefs(): Set<any> { return new Set(); }
  getPathToChild(_inst: any): any[] | undefined { return undefined; }
  getAnyPathToChild(_inst: any): any[] | undefined { return undefined; }
  getRefsToInst(_inst: any, _all?: boolean): any[] { return []; }
  getChangesSoFar(): any[] { return []; }
  setExtraListener(_newListener: (change: any) => void): void {}
  maybeObserveComponents(_components: any[], _componentContext?: any): boolean { return false; }
}

export function observeModel(_rootInst: any, _opts: any): { dispose: () => void } {
  return { dispose: vi.fn() };
}

export function emptyRecordedChanges() {
  return {
    changes: [],
    newInsts: [],
    removedInsts: [],
  };
}

export function mergeRecordedChanges(a: any, b: any): any {
  return {
    changes: [...a.changes, ...b.changes],
    newInsts: [...a.newInsts, ...b.newInsts],
    removedInsts: [...a.removedInsts, ...b.removedInsts],
  };
}
