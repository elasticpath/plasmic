/**
 * Save manager: serializes model changes and POSTs incremental revisions.
 *
 * Uses FastBundler.fastBundle() to produce a partial Bundle containing only
 * changed IIDs, then POSTs to the Plasmic save endpoint with incremental: true.
 * Tracks revision numbers so each save uses the correct sequence number.
 *
 * Handles three classes of 412 errors (matching Studio's StudioCtx.tsx:5362-5383):
 * - ProjectRevisionError: another user saved first → report conflict, suggest refresh-project
 * - UnknownReferencesError: stale refs → auto-retry with full bundle (matching Studio behavior)
 * - SchemaMismatchError: schema drift → suggest refresh-project to get updated schema
 *
 * Reference: specs/plasmic-incremental-writes.md § Save Flow
 */

import { PlasmicApiClient, PlasmicApiError } from "./api-client.js";
import { mergeRecordedChanges, type RecordedChanges } from "@/wab/shared/core/observable-model";
import { requireSession } from "./session.js";
import { modelSchemaHash } from "@/wab/shared/model/classes-metas";
import { assertSiteInvariants } from "@/wab/shared/site-invariants";
import {
  checkExistingReferences,
  checkRefsInBundle,
} from "@/wab/shared/bundler";

export interface SaveResult {
  revisionNum: number;
  incremental: boolean;
}

/** Module-level flag indicating whether a save is in flight.
 *  Used by update-queue to pause processing during saves. */
let _saving = false;

/** Check if a save is currently in flight. */
export function isSaving(): boolean {
  return _saving;
}

export class SaveManager {
  private rebaseOnConflict?: () => Promise<void>;

  constructor(
    private apiClient: PlasmicApiClient,
    opts?: { rebaseOnConflict?: () => Promise<void> }
  ) {
    this.rebaseOnConflict = opts?.rebaseOnConflict;
  }

  /**
   * Save recorded changes as an incremental revision.
   *
   * 1. Extracts changed instances from RecordedChanges
   * 2. Calls fastBundle() to serialize the delta
   * 3. POSTs to the save endpoint
   * 4. Increments the session's revision number
   */
  async saveChanges(
    changes: RecordedChanges,
    modifiedComponentIids?: string[]
  ): Promise<SaveResult> {
    const session = requireSession();
    const {
      bundler,
      site,
      projectId,
      revisionNum,
      modelVersion,
      hostlessDataVersion,
    } = session;

    // Merge any pending rebase changes so fastBundle covers server mutations
    // (mirrors Studio's mergeRecordedChanges(serverChanges, ...) at StudioCtx.tsx:6559)
    const allChanges = session.pendingRebaseChanges
      ? mergeRecordedChanges(session.pendingRebaseChanges, changes)
      : changes;

    // Extract changed instances for fastBundle
    const changedInsts = allChanges.changes.map((c) => c.changeNode);

    // Generate incremental bundle
    const bundle = bundler.fastBundle(site, projectId, changedInsts);

    // Compute toDeleteIids from removed instances
    const toDeleteIids: string[] = [];
    for (const inst of changes.removedInsts) {
      const addr = bundler.addrOf(inst);
      if (addr?.iid) {
        toDeleteIids.push(addr.iid);
      }
    }

    const newRevisionNum = revisionNum + 1;

    // Validate site invariants before saving (matches Studio's StudioCtx.trySave()).
    // Uses shared checkers from @/wab/shared — zero duplicated logic.
    //   assertSiteInvariants    — Site-model invariants (duplicate names,
    //                             arena/frame integrity, arrayType conflicts,
    //                             style-token validity).
    //   checkExistingReferences — every `__ref` in the bundle points to an
    //                             existing IID in bundle.map. Catches dangling
    //                             references left over by a mutation path that
    //                             failed to clean up (gap #71 class).
    //   checkRefsInBundle       — weak/strong-ref consistency across the full
    //                             reachable graph; surfaces unreachable
    //                             instances that still carry parent refs.
    // We validate against `bundler.cachedBundle()` (the post-fastBundle full
    // bundle state) rather than the incremental delta — the corruption we
    // want to catch is cross-instance, not delta-local.
    try {
      assertSiteInvariants(site);
      // `cachedBundle()` is a FastBundler method; fall back gracefully for
      // test stubs or any bundler variant that doesn't expose it.
      const fullBundle =
        typeof (bundler as { cachedBundle?: () => unknown }).cachedBundle ===
        "function"
          ? (bundler as { cachedBundle: () => unknown }).cachedBundle()
          : undefined;
      if (fullBundle) {
        checkExistingReferences(fullBundle as never);
        checkRefsInBundle(fullBundle as never);
      }
    } catch (err: unknown) {
      throw new Error(
        `Pre-save bundle validation failed: ${err instanceof Error ? err.message : String(err)} ` +
          `This prevents a corrupt bundle from being persisted (gap #71). ` +
          `Use refresh-project to reload the latest valid version, then retry your edit.`
      );
    }

    // Track pending save for self-update echo detection (P0.6)
    session.pendingSavedRevisionNum = newRevisionNum;
    _saving = true;
    try {
      await this.apiClient.saveRevision(projectId, newRevisionNum, {
        data: JSON.stringify(bundle),
        modelVersion,
        hostlessDataVersion,
        incremental: true,
        toDeleteIids,
        modifiedComponentIids: modifiedComponentIids ?? [],
        modelSchemaHash,
      }, session.activeBranchId ?? undefined);

      // Update session revision on success and clear rebase changes
      session.revisionNum = newRevisionNum;
      session.pendingRebaseChanges = undefined;

      console.error(
        `[plasmic-mcp] Saved revision ${newRevisionNum} (incremental, ${changedInsts.length} changes)`
      );

      return { revisionNum: newRevisionNum, incremental: true };
    } catch (err: unknown) {
      if (err instanceof PlasmicApiError && err.statusCode === 412) {
        // UnknownReferencesError: auto-retry with full bundle (Studio behavior)
        if (err.errorType === "UnknownReferencesError") {
          console.error(
            "[plasmic-mcp] UnknownReferencesError on incremental save, retrying with full bundle..."
          );
          return this.saveFullBundle();
        }

        // SchemaMismatchError: schema drift between client and server
        if (err.errorType === "SchemaMismatchError") {
          throw new Error(
            `Schema mismatch: the server's model schema has changed since this session started. ` +
              `Use refresh-project to reload with the updated schema, then retry your edit.`
          );
        }

        // ProjectRevisionError: conflict with another user
        // If a rebase callback is provided, attempt to fetch updates, rebase, and retry
        if (this.rebaseOnConflict) {
          try {
            console.error(
              "[plasmic-mcp] ProjectRevisionError on incremental save, attempting rebase + retry..."
            );
            await this.rebaseOnConflict();
            return this.saveFullBundle();
          } catch (rebaseErr) {
            console.error(
              `[plasmic-mcp] Rebase after conflict failed: ${
                rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr)
              }`
            );
            throw new Error(
              `Save conflict: another user saved revision ${newRevisionNum} first. ` +
                `Auto-rebase failed: ${rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr)}. ` +
                `Use refresh-project to reload the latest version, then retry your edit.`
            );
          }
        }

        throw new Error(
          `Save conflict: another user saved revision ${newRevisionNum} first. ` +
            `Use refresh-project to reload the latest version, then retry your edit.`
        );
      }
      throw err;
    } finally {
      _saving = false;
    }
  }

  /**
   * Save a full (non-incremental) bundle.
   * Used as a fallback when incremental save fails with UnknownReferencesError,
   * or when project.save is called explicitly.
   *
   * Re-fetches bundleVersion from the server before bundling to ensure we always
   * have a valid version string. This prevents the OutdatedBundleError that
   * occurs when version is undefined (JSON.stringify drops the field entirely).
   */
  async saveFullBundle(): Promise<SaveResult> {
    const session = requireSession();
    const {
      bundler,
      site,
      projectId,
      revisionNum,
      modelVersion,
      hostlessDataVersion,
    } = session;

    // Re-fetch bundleVersion from the server to guarantee a fresh, valid value.
    // Studio fetches this once at session start (appCtx.lastBundleVersion) and
    // the value is stable for the session. We re-fetch as extra safety since
    // MCP sessions can be long-lived and the value could theoretically become
    // stale if the server schema is upgraded mid-session.
    const freshBundleVersion = await this.apiClient.getLastBundleVersion();
    session.bundleVersion = freshBundleVersion;

    // Defense-in-depth: assert the version is a non-empty string.
    // If the server returned garbage, fail fast with a clear message rather
    // than sending version: undefined and getting a cryptic 412.
    if (!freshBundleVersion || typeof freshBundleVersion !== "string") {
      throw new Error(
        `Failed to get a valid bundle version from the server (got: ${JSON.stringify(freshBundleVersion)}). ` +
          `Cannot save without a bundle version. Try refresh-project to reload.`
      );
    }

    // Pass freshBundleVersion to bundler.bundle(), matching
    // Studio's StudioCtx.bundleChanges() which passes appCtx.lastBundleVersion.
    const bundle = bundler.bundle(site, projectId, freshBundleVersion);
    const newRevisionNum = revisionNum + 1;

    // Validate site invariants before saving (matches Studio's StudioCtx.trySave()).
    // Uses shared checkers from @/wab/shared — zero duplicated logic.
    //   assertSiteInvariants    — Site-model invariants (duplicate names,
    //                             arena/frame integrity, arrayType conflicts,
    //                             style-token validity).
    //   checkExistingReferences — every `__ref` in the bundle points to an
    //                             existing IID in bundle.map. Catches dangling
    //                             references left over by a mutation path that
    //                             failed to clean up (gap #71 class).
    //   checkRefsInBundle       — weak/strong-ref consistency across the full
    //                             reachable graph; surfaces unreachable
    //                             instances that still carry parent refs.
    // We validate against `bundler.cachedBundle()` (the post-fastBundle full
    // bundle state) rather than the incremental delta — the corruption we
    // want to catch is cross-instance, not delta-local.
    try {
      assertSiteInvariants(site);
      // `cachedBundle()` is a FastBundler method; fall back gracefully for
      // test stubs or any bundler variant that doesn't expose it.
      const fullBundle =
        typeof (bundler as { cachedBundle?: () => unknown }).cachedBundle ===
        "function"
          ? (bundler as { cachedBundle: () => unknown }).cachedBundle()
          : undefined;
      if (fullBundle) {
        checkExistingReferences(fullBundle as never);
        checkRefsInBundle(fullBundle as never);
      }
    } catch (err: unknown) {
      throw new Error(
        `Pre-save bundle validation failed: ${err instanceof Error ? err.message : String(err)} ` +
          `This prevents a corrupt bundle from being persisted (gap #71). ` +
          `Use refresh-project to reload the latest valid version, then retry your edit.`
      );
    }

    // Track pending save for self-update echo detection (P0.6)
    session.pendingSavedRevisionNum = newRevisionNum;
    _saving = true;
    try {
      await this.apiClient.saveRevision(projectId, newRevisionNum, {
        data: JSON.stringify(bundle),
        modelVersion,
        hostlessDataVersion,
        incremental: false,
        toDeleteIids: [],
        modifiedComponentIids: [],
        modelSchemaHash,
      }, session.activeBranchId ?? undefined);

      session.revisionNum = newRevisionNum;
      session.pendingRebaseChanges = undefined;

      console.error(
        `[plasmic-mcp] Saved revision ${newRevisionNum} (full bundle, version: ${freshBundleVersion})`
      );

      return { revisionNum: newRevisionNum, incremental: false };
    } catch (err: unknown) {
      if (err instanceof PlasmicApiError && err.statusCode === 412) {
        if (err.errorType === "SchemaMismatchError") {
          throw new Error(
            `Schema mismatch: the server's model schema has changed since this session started. ` +
              `Use refresh-project to reload with the updated schema, then retry your edit.`
          );
        }
        if (err.errorType === "ProjectRevisionError") {
          throw new Error(
            `Save conflict: another user saved revision ${newRevisionNum} first. ` +
              `Use refresh-project to reload the latest version, then retry your edit.`
          );
        }
        if (err.errorType === "UnknownReferencesError") {
          console.error(
            "[plasmic-mcp] UnknownReferencesError on full save — this is unexpected. " +
              "The project may have stale references. Use refresh-project to reload."
          );
        }
      }
      throw err;
    } finally {
      _saving = false;
    }
  }
}
