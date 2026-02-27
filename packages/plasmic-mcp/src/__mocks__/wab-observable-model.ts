/**
 * Mock for @/wab/shared/core/observable-model
 *
 * ChangeRecorder mock captures calls to withRecording() and returns
 * configurable RecordedChanges. Tests can set mockWithRecording.mockReturnValue()
 * to control what changes are "recorded" during a mutation.
 */

import { vi } from "vitest";

export const mockWithRecording = vi.fn();
export const mockDispose = vi.fn();

export class ChangeRecorder {
  constructor(_opts: any) {}

  withRecording(fn: () => void): any {
    fn();
    return mockWithRecording();
  }

  dispose(): void {
    mockDispose();
  }
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
