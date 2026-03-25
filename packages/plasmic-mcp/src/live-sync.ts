/**
 * Live sync: wires socket, update queue, and rebase engine into the session lifecycle.
 *
 * Provides startLiveSync() / stopLiveSync() to manage real-time collaboration.
 * Connects socket on project load, processes incoming updates through the queue,
 * and applies server changes via the rebase engine.
 *
 * Non-blocking: if socket connection fails, the MCP server continues in HTTP-only mode.
 *
 * Reference: StudioCtx.startListeningForSocketEvents() (line 4025)
 */

import { connectSocket, disconnectSocket, isSocketConnected } from "./socket-client.js";
import { emitViewNow, resetPresence } from "./presence-manager.js";
import { UpdateQueue } from "./update-queue.js";
import {
  fetchAndRebase,
  UnsupportedServerUpdate,
  type RebaseContext,
} from "./rebase-engine.js";
import { getEmptyDeletedAssetsSummary } from "@/wab/shared/server-updates-utils";
import { mergeRecordedChanges } from "@/wab/shared/core/observable-model";
import { modelSchemaHash as localModelSchemaHash } from "@/wab/shared/model/classes-metas";
import { isSaving } from "./save-manager.js";
import { getSession } from "./session.js";
import { getChangeTracker } from "./change-tracker.js";
import { getStack, replaceStack } from "./undo-manager.js";
import { getAccumulatedChanges, replaceAccumulatedChanges } from "./batch-manager.js";
import { clearNodeCache } from "./node-resolver.js";
import type { PlasmicApiClient } from "./api-client.js";
import type { InitServerInfoData, UpdateEventData } from "./socket-client.js";

let updateQueue: UpdateQueue | null = null;
let activeApiClient: PlasmicApiClient | null = null;

/**
 * Start live sync for the current session.
 * Connects socket and creates update queue with rebase handler.
 * Non-blocking: logs warning and returns if connection fails.
 */
export async function startLiveSync(
  apiClient: PlasmicApiClient,
  projectId: string
): Promise<void> {
  // Stop any previous sync first
  stopLiveSync();

  activeApiClient = apiClient;

  const session = getSession();
  if (!session) {
    console.error("[plasmic-mcp] LiveSync: no session, skipping");
    return;
  }

  // Initialize serverUpdatesSummary if not set
  if (!session.serverUpdatesSummary) {
    session.serverUpdatesSummary = getEmptyDeletedAssetsSummary();
  }
  session.isAtTip = true;

  // Create update queue with rebase handler
  updateQueue = new UpdateQueue({
    handler: handleUpdate,
    isSaving: () => isSaving(),
    getPendingSavedRevisionNum: () => getSession()?.pendingSavedRevisionNum,
    getActiveBranchId: () => getSession()?.activeBranchId ?? null,
  });

  // Connect socket with callbacks, passing accumulated session cookies
  const auth = apiClient.getAuth();
  const cookies = apiClient.getCookieString();
  await connectSocket(auth, projectId, {
    onUpdate: (data: UpdateEventData) => {
      updateQueue?.enqueue(data);
    },
    onInitServerInfo: handleInitServerInfo,
    onHostlessDataVersionUpdate: handleHostlessDataVersionUpdate,
    onError: (msg: string) => {
      console.error(`[plasmic-mcp] LiveSync socket error: ${msg}`);
    },
    onReconnect: () => {
      console.error("[plasmic-mcp] LiveSync: socket reconnected");
      emitViewNow();
    },
  }, cookies);

  console.error(
    `[plasmic-mcp] LiveSync started for project ${projectId}`
  );
}

/**
 * Stop live sync. Disconnects socket and stops update queue.
 */
export function stopLiveSync(): void {
  if (updateQueue) {
    updateQueue.stop();
    updateQueue = null;
  }
  resetPresence();
  disconnectSocket();
  activeApiClient = null;
}

/**
 * Check if live sync is currently active.
 */
export function isLiveSyncActive(): boolean {
  return isSocketConnected() && updateQueue !== null;
}

/**
 * Fetch server updates and rebase local changes on top.
 * Exported for use by SaveManager's rebaseOnConflict callback —
 * when a save fails with ProjectRevisionError, this brings the
 * model up to date so the save can be retried.
 */
export async function rebaseFromServer(
  apiClient: PlasmicApiClient
): Promise<void> {
  const session = getSession();
  if (!session) {
    throw new Error("No active session for rebase");
  }

  let tracker;
  try {
    tracker = getChangeTracker();
  } catch {
    throw new Error("No change tracker available for rebase");
  }

  const ctx: RebaseContext = {
    site: session.site,
    bundler: session.bundler,
    projectId: session.projectId,
    revisionNum: session.revisionNum,
    recorder: tracker.getRecorder(),
    serverUpdatesSummary:
      session.serverUpdatesSummary ?? getEmptyDeletedAssetsSummary(),
    getUndoStack: () => getStack(),
    replaceUndoStack: (stack) => replaceStack(stack),
    getAccumulatedChanges: () => getAccumulatedChanges(),
    replaceAccumulatedChanges: (changes) => replaceAccumulatedChanges(changes),
  };

  const result = await fetchAndRebase(apiClient, ctx);
  if (result) {
    session.revisionNum = result.newRevisionNum;
    session.serverUpdatesSummary = result.serverUpdatesSummary;
    session.pendingRebaseChanges = session.pendingRebaseChanges
      ? mergeRecordedChanges(session.pendingRebaseChanges, result.serverChanges)
      : result.serverChanges;
    clearNodeCache();
    console.error(
      `[plasmic-mcp] rebaseFromServer: rebased to revision ${result.newRevisionNum}`
    );
  }
}

/**
 * Handle incoming model update from socket.
 * Builds a RebaseContext from current session state and runs the rebase engine.
 */
async function handleUpdate(data: UpdateEventData): Promise<void> {
  const session = getSession();
  if (!session || !activeApiClient) {
    console.error("[plasmic-mcp] LiveSync: no session or apiClient, skipping update");
    return;
  }

  // Only process updates for our project
  if (data.projectId !== session.projectId) {
    console.error(
      `[plasmic-mcp] LiveSync: ignoring update for different project ${data.projectId}`
    );
    return;
  }

  let tracker;
  try {
    tracker = getChangeTracker();
  } catch {
    console.error("[plasmic-mcp] LiveSync: no change tracker, skipping update");
    return;
  }

  const ctx: RebaseContext = {
    site: session.site,
    bundler: session.bundler,
    projectId: session.projectId,
    revisionNum: session.revisionNum,
    recorder: tracker.getRecorder(),
    serverUpdatesSummary:
      session.serverUpdatesSummary ?? getEmptyDeletedAssetsSummary(),
    getUndoStack: () => getStack(),
    replaceUndoStack: (stack) => replaceStack(stack),
    getAccumulatedChanges: () => getAccumulatedChanges(),
    replaceAccumulatedChanges: (changes) => replaceAccumulatedChanges(changes),
  };

  try {
    const result = await fetchAndRebase(activeApiClient, ctx);

    if (result) {
      session.revisionNum = result.newRevisionNum;
      session.serverUpdatesSummary = result.serverUpdatesSummary;

      // Accumulate server changes so the next fastBundle includes them
      // (mirrors Studio's serverChanges merge at StudioCtx.tsx:6559)
      session.pendingRebaseChanges = session.pendingRebaseChanges
        ? mergeRecordedChanges(session.pendingRebaseChanges, result.serverChanges)
        : result.serverChanges;

      // Clear node resolver cache since model has changed
      clearNodeCache();

      console.error(
        `[plasmic-mcp] LiveSync: rebased to revision ${result.newRevisionNum}` +
          (result.hadLocalChanges ? " (with local changes)" : " (fast-forward)")
      );
    }
  } catch (err) {
    if (err instanceof UnsupportedServerUpdate) {
      // Full reload needed — mark session as stale
      session.isAtTip = false;
      console.error(
        `[plasmic-mcp] LiveSync: unsupported server update, session is stale. ` +
          `Use refresh-project to reload. (${err.message})`
      );
    } else {
      console.error(
        `[plasmic-mcp] LiveSync: rebase failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

/**
 * Handle initServerInfo from socket.
 * Detects schema/bundle version mismatches.
 */
function handleInitServerInfo(data: InitServerInfoData): void {
  const session = getSession();
  if (!session) return;

  session.selfPlayerId = data.selfPlayerId;

  // Check model schema hash mismatch
  if (String(data.modelSchemaHash) !== String(localModelSchemaHash)) {
    session.isAtTip = false;
    console.error(
      `[plasmic-mcp] LiveSync: model schema hash mismatch! ` +
        `Server=${data.modelSchemaHash}, local=${localModelSchemaHash}. ` +
        `Use refresh-project to reload.`
    );
  }

  // Check bundle version mismatch
  if (data.bundleVersion !== session.bundleVersion) {
    session.isAtTip = false;
    console.error(
      `[plasmic-mcp] LiveSync: bundle version mismatch! ` +
        `Server=${data.bundleVersion}, session=${session.bundleVersion}. ` +
        `Use refresh-project to reload.`
    );
  }

  console.error(
    `[plasmic-mcp] LiveSync: initServerInfo received, playerId=${data.selfPlayerId}`
  );
}

/**
 * Handle hostless data version update from socket.
 */
function handleHostlessDataVersionUpdate(data: {
  hostlessDataVersion: number;
}): void {
  const session = getSession();
  if (!session) return;

  if (data.hostlessDataVersion > session.hostlessDataVersion) {
    console.error(
      `[plasmic-mcp] LiveSync: hostless data version increased ` +
        `(${session.hostlessDataVersion} → ${data.hostlessDataVersion}). ` +
        `Consider refresh-project if hostless packages were updated.`
    );
    session.hostlessDataVersion = data.hostlessDataVersion;
  }
}
