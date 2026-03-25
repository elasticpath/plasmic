/**
 * Rebase engine: reconciles local changes with server updates.
 *
 * An orchestration layer that calls shared Studio functions to implement
 * the rebase algorithm. Does NOT reimplement conflict resolution — imports
 * undoChangesAndResolveConflicts(), undoChanges(), etc. from @/wab/shared/.
 *
 * Mirrors StudioCtx.fetchUpdatesInternal() (lines 6389-6577) step-for-step.
 *
 * Reference: platform/wab/src/wab/client/studio-ctx/StudioCtx.tsx
 */

import { undoChanges } from "@/wab/shared/core/undo-util";
import {
  undoChangesAndResolveConflicts,
  getEmptyDeletedAssetsSummary,
  updateSummaryFromDeletedInstances,
  type DeletedAssetsSummary,
} from "@/wab/shared/server-updates-utils";
import { unbundleProjectDependency } from "@/wab/shared/core/tagged-unbundle";
import { trackComponentRoot, trackComponentSite } from "@/wab/shared/core/tpls";
import { arrayReversed } from "@/wab/shared/collections";
import { xDifference } from "@/wab/shared/common";
import type { RecordedChanges } from "@/wab/shared/core/observable-model";
import type { PlasmicApiClient } from "./api-client.js";
import type { GetModelUpdatesResponse, ModelUpdateIncremental } from "./types.js";

/**
 * Error thrown when the server update cannot be applied incrementally.
 * Triggers a full project reload (same behavior as Studio).
 */
export class UnsupportedServerUpdate extends Error {
  constructor(reason: string) {
    super(`Unsupported server update: ${reason}`);
    this.name = "UnsupportedServerUpdate";
  }
}

export interface RebaseContext {
  /** The live Site model. */
  site: any;
  /** The FastBundler instance. */
  bundler: any;
  /** The project ID (UUID). */
  projectId: string;
  /** Current session revision number. */
  revisionNum: number;
  /** The ChangeRecorder (IChangeRecorder) from ChangeTracker. */
  recorder: any;
  /** Accumulated DeletedAssetsSummary (persists across rebases, cleared on full reload). */
  serverUpdatesSummary: DeletedAssetsSummary;
  /** Get undo stack entries (from undo-manager). */
  getUndoStack: () => Array<{ description: string; changes: any[] }>;
  /** Replace undo stack entries after rebase. */
  replaceUndoStack: (
    stack: Array<{ description: string; changes: any[] }>
  ) => void;
  /** Get accumulated batch changes (null if no batch active). */
  getAccumulatedChanges: () => RecordedChanges | null;
  /** Replace accumulated batch changes after rebase. */
  replaceAccumulatedChanges: (changes: RecordedChanges) => void;
}

export interface RebaseResult {
  /** New revision number after successful rebase. */
  newRevisionNum: number;
  /** Whether any local changes were rebased (vs simple fast-forward). */
  hadLocalChanges: boolean;
  /** Updated DeletedAssetsSummary (accumulated across rebases). */
  serverUpdatesSummary: DeletedAssetsSummary;
  /** Server changes recorded during unbundlePartial. Must be included in
   *  the next fastBundle call so the incremental save covers all mutations. */
  serverChanges: RecordedChanges;
}

/**
 * Fetch incremental updates from the server and rebase local changes.
 *
 * Returns the rebase result on success.
 * Throws UnsupportedServerUpdate if incremental rebase is not possible
 * (caller should fall back to full project reload).
 */
export async function fetchAndRebase(
  apiClient: PlasmicApiClient,
  ctx: RebaseContext
): Promise<RebaseResult | null> {
  // Phase 1: Fetch server updates
  const updatedModel = await apiClient.getModelUpdates(
    ctx.projectId,
    ctx.revisionNum,
    ctx.bundler.allUuids()
  );

  return applyServerUpdate(updatedModel, ctx);
}

/**
 * Apply a server update response to the local model.
 * Separated from fetchAndRebase for testability.
 */
export function applyServerUpdate(
  updatedModel: GetModelUpdatesResponse,
  ctx: RebaseContext
): RebaseResult | null {
  // Handle needsReload
  if ("needsReload" in updatedModel && updatedModel.needsReload) {
    throw new UnsupportedServerUpdate("server requires full reload");
  }

  // Handle no changes
  if (updatedModel.data === null || updatedModel.data === undefined) {
    return null;
  }

  const update = updatedModel as ModelUpdateIncremental;

  return rebaseWithUpdate(update, ctx);
}

/**
 * Core rebase algorithm — mirrors StudioCtx.fetchUpdatesInternal().
 */
function rebaseWithUpdate(
  update: ModelUpdateIncremental,
  ctx: RebaseContext
): RebaseResult {
  const { site, bundler, projectId, recorder } = ctx;
  const undoStack = ctx.getUndoStack();
  const accumulatedChanges = ctx.getAccumulatedChanges();

  const hasLocalChanges =
    undoStack.length > 0 ||
    (accumulatedChanges !== null && accumulatedChanges.changes.length > 0);

  // Phase 2: Revert all local changes
  let revertedAccumulated: RecordedChanges | null = null;
  let revertedUndoEntries: RecordedChanges[] = [];

  if (hasLocalChanges) {
    // Step 2a: Undo accumulated batch changes
    if (accumulatedChanges && accumulatedChanges.changes.length > 0) {
      revertedAccumulated = recorder.withRecording(() => {
        undoChanges(accumulatedChanges.changes);
      });
    }

    // Step 2b: Undo all undo stack entries in reverse order
    if (undoStack.length > 0) {
      const reversedStack = arrayReversed(undoStack);
      revertedUndoEntries = reversedStack.map(
        (entry: { changes: any[] }) =>
          recorder.withRecording(() => {
            undoChanges(entry.changes);
          })
      );
    }
  }

  // Phase 3: Record server deletions
  const previousProjectDeps = [...site.projectDependencies];
  let summary = ctx.serverUpdatesSummary;

  if (update.deletedIids.length > 0) {
    const deletedInsts = update.deletedIids
      .map((iid: string) =>
        bundler.objByAddr({ uuid: projectId, iid })
      )
      .filter(Boolean);

    if (deletedInsts.length > 0) {
      summary = updateSummaryFromDeletedInstances(summary, deletedInsts);
    }
  }

  // Phase 4: Apply server changes — capture recorded mutations so the next
  // fastBundle call includes them (mirrors Studio's serverChanges at StudioCtx.tsx:6559)
  const serverChanges = recorder.withRecording(() => {
    // Step 4a: Unbundle dependency packages
    for (const depPkg of update.depPkgs) {
      try {
        unbundleProjectDependency(bundler, depPkg, []);
      } catch (err) {
        console.error(
          `[plasmic-mcp] Rebase: failed to unbundle dep pkg ${depPkg.id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    // Step 4b: Apply partial bundle
    const partialBundle = JSON.parse(update.data);
    bundler.unbundlePartial(partialBundle, projectId);
  });

  // Step 4c: Check for dependency deletion
  const deletedDeps = xDifference(
    previousProjectDeps,
    site.projectDependencies
  );
  if (deletedDeps.size > 0) {
    throw new UnsupportedServerUpdate(
      `${deletedDeps.size} project dependencies were deleted`
    );
  }

  // Step 4d: Fix component references
  for (const component of site.components) {
    trackComponentRoot(component);
    trackComponentSite(component, site);
  }

  // Phase 5: Re-apply local changes with conflict resolution
  if (hasLocalChanges) {
    // Step 5a: Re-apply undo stack entries in forward order
    if (revertedUndoEntries.length > 0) {
      const forwardEntries = arrayReversed(revertedUndoEntries);
      const forwardStack = arrayReversed(
        arrayReversed(undoStack)
      ); // restore original order

      const newStack = forwardEntries.map(
        (reverted: RecordedChanges, i: number) => {
          const rebased = undoChangesAndResolveConflicts(
            site,
            recorder,
            summary,
            reverted.changes
          );
          return {
            description: forwardStack[i].description,
            changes: rebased.changes,
          };
        }
      );
      ctx.replaceUndoStack(newStack);
    }

    // Step 5b: Re-apply accumulated batch changes
    if (revertedAccumulated && revertedAccumulated.changes.length > 0) {
      const rebased = undoChangesAndResolveConflicts(
        site,
        recorder,
        summary,
        revertedAccumulated.changes
      );
      ctx.replaceAccumulatedChanges(rebased);
    }
  }

  console.error(
    `[plasmic-mcp] Rebase complete: revision ${ctx.revisionNum} → ${update.revision}` +
      (hasLocalChanges
        ? ` (rebased ${undoStack.length} undo entries)`
        : " (fast-forward)")
  );

  return {
    newRevisionNum: update.revision,
    hadLocalChanges: hasLocalChanges,
    serverUpdatesSummary: summary,
    serverChanges,
  };
}
