/**
 * Mock for @/wab/shared/server-updates-utils
 *
 * Provides mock implementations of Studio's shared rebase/conflict
 * resolution functions. Used by rebase-engine unit tests.
 */

import { vi } from "vitest";

export interface DeletedAssetsSummary {
  deletedComponents: any[];
  deletedImageAssets: any[];
  deletedMixins: any[];
  deletedTokens: any[];
  deletedParams: any[];
  deletedVariantGroups: any[];
  deletedVariants: any[];
  deletedVars: any[];
  deletedStates: any[];
  deletedTplNodes: any[];
  deletedComponentDataQueries: any[];
  deletedThemes: any[];
  deletedArgTypes: any[];
  deletedExprs: any[];
}

export const undoChangesAndResolveConflicts = vi.fn().mockImplementation(
  (_site: any, _recorder: any, _serverSummary: any, _changes: any[]) => ({
    changes: [],
    newInsts: [],
    removedInsts: [],
  })
);

export const getEmptyDeletedAssetsSummary = vi.fn().mockImplementation(
  (): DeletedAssetsSummary => ({
    deletedComponents: [],
    deletedImageAssets: [],
    deletedMixins: [],
    deletedTokens: [],
    deletedParams: [],
    deletedVariantGroups: [],
    deletedVariants: [],
    deletedVars: [],
    deletedStates: [],
    deletedTplNodes: [],
    deletedComponentDataQueries: [],
    deletedThemes: [],
    deletedArgTypes: [],
    deletedExprs: [],
  })
);

export const updateSummaryFromDeletedInstances = vi.fn().mockImplementation(
  (summary: DeletedAssetsSummary, _insts: any[], _opts?: any) => summary
);

export const fixDanglingReferenceConflicts = vi.fn();
