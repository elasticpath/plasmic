/**
 * Session state for the MCP server.
 *
 * Holds the active project's live model (Site object graph from FastBundler.unbundle)
 * and bundler instance. Cleared and repopulated when set-project is called.
 *
 * Uses `any` for Site and bundler types to keep this module lightweight —
 * the model-loader and tree-reader modules handle the actual typed interactions.
 */

export interface Session {
  projectId: string;
  projectName: string;
  site: any;
  bundler: any;
}

let currentSession: Session | null = null;

export function getSession(): Session | null {
  return currentSession;
}

export function requireSession(): Session {
  if (!currentSession) {
    throw new Error("No active project. Use the set-project tool first.");
  }
  return currentSession;
}

export function setSession(session: Session): void {
  currentSession = session;
}

export function clearSession(): void {
  currentSession = null;
}
