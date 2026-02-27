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

export interface Session {
  projectId: string;
  projectName: string;
  site: any;
  bundler: any;
  revisionNum: number;
  modelVersion: number;
  hostlessDataVersion: number;
  projectUuid: string;
  /** Dev host URL from project settings (null if not configured). */
  hostUrl?: string;
  /** Whether dev host variant sync completed successfully. */
  devHostSynced?: boolean;
  /** Names of code components whose variants were synced from the dev host. */
  syncedVariantComponents?: string[];
  /** Full registry data from the dev host (contexts, functions, tokens, traits). */
  registryData?: any;
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
