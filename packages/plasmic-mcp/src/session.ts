/**
 * Session state for the MCP server.
 *
 * Holds the active project's live model (Site object graph from FastBundler.unbundle)
 * and bundler instance. Cleared and repopulated when project.set is called.
 *
 * Uses `any` for Site and bundler types to keep this module lightweight —
 * the model-loader and tree-reader modules handle the actual typed interactions.
 *
 * M2 additions: revision tracking fields needed for incremental saves.
 * - revisionNum: current known revision (from API response, incremented after each save)
 * - modelVersion: server model version (constant throughout session, sent with each save)
 * - hostlessDataVersion: server hostless data version (constant throughout session)
 * - projectUuid: bundle UUID required as argument to fastBundle()
 */

import type { FullRegistryData } from "./devhost-sync.js";

export interface Session {
  projectId: string;
  projectName: string;
  site: any;
  bundler: any;
  revisionNum: number;
  modelVersion: number;
  hostlessDataVersion: number;
  projectUuid: string;
  /** Authoritative bundle version from server API (e.g. "256-wrap-page-meta-og-image-in-ref").
   *  Fetched via /api/v1/latest-bundle-version, matching Studio's appCtx.lastBundleVersion. */
  bundleVersion: string;
  /** Dev host URL from project settings or PLASMIC_DEV_HOST_URL env var. */
  hostUrl?: string;
  /** Whether dev host variant sync completed successfully. */
  devHostSynced?: boolean;
  /** Names of code components whose variants were synced from the dev host. */
  syncedVariantComponents?: string[];
  /** Full registry data from the dev host (all five registries). */
  registryData?: FullRegistryData | null;
  /** Self player ID from socket initServerInfo event. */
  selfPlayerId?: number;
  /** Revision number of the most recent save we sent (for self-update echo detection). */
  pendingSavedRevisionNum?: number;
  /** Accumulated DeletedAssetsSummary across rebases (cleared on full reload). */
  serverUpdatesSummary?: any;
  /** Whether this session is at the tip of the server's revision history.
   *  Set false on schema/bundle version mismatch detected via initServerInfo. */
  isAtTip?: boolean;
  /** Active branch ID for branch-aware socket subscriptions.
   *  null = main branch (default), string = specific branch ID. */
  activeBranchId?: string | null;
  /** Server changes from rebases, to be merged into the next fastBundle call.
   *  Mirrors Studio's serverChanges accumulation (StudioCtx.tsx:6559).
   *  Cleared after a successful save. */
  pendingRebaseChanges?: any;
}

let currentSession: Session | null = null;

export function getSession(): Session | null {
  return currentSession;
}

export function requireSession(): Session {
  if (!currentSession) {
    throw new Error("No active project. Use project tool with action 'set' first.");
  }
  return currentSession;
}

export function setSession(session: Session): void {
  currentSession = session;
}

export function clearSession(): void {
  currentSession = null;
}
