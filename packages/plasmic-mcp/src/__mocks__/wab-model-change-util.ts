/**
 * Mock for @/wab/shared/model/model-change-util
 *
 * Returns an empty ChangeSummary so fixups don't run in unit tests.
 * The fixup pipeline itself is tested separately in fixup-pipeline.test.ts.
 */
import { vi } from "vitest";

export const summarizeChanges = vi.fn().mockReturnValue({
  newTrees: new Set(),
  updatedNodes: new Set(),
  updatedComponents: new Set(),
  deepUpdatedComponents: new Set(),
  updatedRuleSets: new Map(),
  changesType: 0,
  styleForcesEval: false,
  tokenOrMixinChangeType: 0,
  deletedVariantSettings: new Map(),
  regenMixins: new Map(),
  rulesReorderedComponents: new Set(),
  updatedDeps: new Set(),
  deletedDeps: new Set(),
  changes: [],
});
