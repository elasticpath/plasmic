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
import type { RecordedChanges } from "@/wab/shared/core/observable-model";
import { requireSession } from "./session.js";
import { modelSchemaHash } from "@/wab/shared/model/classes-metas";
import { assertSiteInvariants } from "@/wab/shared/site-invariants";

export interface SaveResult {
  revisionNum: number;
  incremental: boolean;
}

export class SaveManager {
  constructor(private apiClient: PlasmicApiClient) {}

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

    // Extract changed instances for fastBundle
    const changedInsts = changes.changes.map((c) => c.changeNode);

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

    // Validate site invariants before saving (matches Studio's StudioCtx.trySave())
    try {
      assertSiteInvariants(site);
    } catch (err: unknown) {
      throw new Error(
        `Site invariant violation: ${err instanceof Error ? err.message : String(err)} ` +
          `Use refresh-project to reload the latest valid version, then retry your edit.`
      );
    }

    try {
      await this.apiClient.saveRevision(projectId, newRevisionNum, {
        data: JSON.stringify(bundle),
        modelVersion,
        hostlessDataVersion,
        incremental: true,
        toDeleteIids,
        modifiedComponentIids: modifiedComponentIids ?? [],
        modelSchemaHash,
      });

      // Update session revision on success
      session.revisionNum = newRevisionNum;

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
        throw new Error(
          `Save conflict: another user saved revision ${newRevisionNum} first. ` +
            `Use refresh-project to reload the latest version, then retry your edit.`
        );
      }
      throw err;
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

    // Validate site invariants before saving (matches Studio's StudioCtx.trySave())
    try {
      assertSiteInvariants(site);
    } catch (err: unknown) {
      throw new Error(
        `Site invariant violation: ${err instanceof Error ? err.message : String(err)} ` +
          `Use refresh-project to reload the latest valid version, then retry your edit.`
      );
    }

    try {
      await this.apiClient.saveRevision(projectId, newRevisionNum, {
        data: JSON.stringify(bundle),
        modelVersion,
        hostlessDataVersion,
        incremental: false,
        toDeleteIids: [],
        modifiedComponentIids: [],
        modelSchemaHash,
      });
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
    }

    session.revisionNum = newRevisionNum;

    console.error(
      `[plasmic-mcp] Saved revision ${newRevisionNum} (full bundle, version: ${freshBundleVersion})`
    );

    return { revisionNum: newRevisionNum, incremental: false };
  }
}
