/**
 * Mock for @/wab/shared/core/observable-model
 *
 * ChangeRecorder mock captures calls to withRecording() and returns
 * configurable RecordedChanges. Tests can set mockWithRecording.mockReturnValue()
 * to control what changes are "recorded" during a mutation.
 */

export const mockWithRecording = jest.fn();
export const mockDispose = jest.fn();

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
  return { dispose: jest.fn() };
}

export const emptyRecordedChanges = {
  changes: [],
  newInsts: [],
  removedInsts: [],
};

export function mergeRecordedChanges(a: any, b: any): any {
  return {
    changes: [...a.changes, ...b.changes],
    newInsts: [...a.newInsts, ...b.newInsts],
    removedInsts: [...a.removedInsts, ...b.removedInsts],
  };
}
