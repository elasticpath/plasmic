/**
 * Presence manager: emits "view" events so Studio users see the MCP agent
 * as a collaborator — showing which component it's focused on and which
 * element it has selected.
 *
 * Uses the same UpdatePlayerViewRequest payload that Studio clients send.
 * Debounces emissions at 200ms to avoid flooding the socket.
 *
 * Reference: StudioCtx.tsx autorun syncView (line ~4042-4084)
 * Reference: platform/wab/src/wab/server/routes/projects-socket.ts (view handler)
 */

import { getActiveSocket } from "./socket-client.js";
import { getSession } from "./session.js";
import type {
  ArenaType,
  ArenaInfo,
  PlayerSelectionInfo,
  UpdatePlayerViewRequest,
} from "@/wab/shared/ApiSchema";

const DEBOUNCE_MS = 200;

// --- Internal state ---

let currentArenaInfo: ArenaInfo | null = null;
let currentSelectionInfo: PlayerSelectionInfo | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// --- Public API ---

/**
 * Update the arena the agent is viewing.
 * Called when the agent starts working on a component or page.
 *
 * @param componentUuid - UUID of the component/page being edited
 * @param arenaType - "component" | "page" (or "custom" for custom arenas)
 */
export function updateArena(
  componentUuid: string,
  arenaType: ArenaType
): void {
  currentArenaInfo = {
    type: arenaType,
    uuidOrName: componentUuid,
    focused: false, // MCP has no focused/unfocused mode distinction
  };
  scheduleEmit();
}

/**
 * Update the selection within the current arena.
 * Called when the agent focuses on a specific node for editing.
 *
 * @param frameUuid - UUID of the frame (artboard) containing the selection
 * @param selectableKey - Optional node UUID or selectable key within the frame
 */
export function updateSelection(
  frameUuid: string,
  selectableKey?: string
): void {
  currentSelectionInfo = {
    selectableFrameUuid: frameUuid,
    ...(selectableKey !== undefined ? { selectableKey } : {}),
  };
  scheduleEmit();
}

/**
 * Clear the agent's presence (arena and selection).
 * Called when the agent finishes an operation.
 */
export function clearPresence(): void {
  currentArenaInfo = null;
  currentSelectionInfo = null;
  scheduleEmit();
}

/**
 * Clear only the selection while keeping the arena.
 * Called when the agent finishes editing a node but stays in the component.
 */
export function clearSelection(): void {
  currentSelectionInfo = null;
  scheduleEmit();
}

/**
 * Force immediate emission of the current view state.
 * Used on socket reconnect to re-broadcast presence.
 */
export function emitViewNow(): void {
  cancelDebounce();
  emitView();
}

/**
 * Full reset: clears all state without emitting.
 * Called on disconnect/session clear.
 */
export function resetPresence(): void {
  cancelDebounce();
  currentArenaInfo = null;
  currentSelectionInfo = null;
}

/**
 * Get the current arena info (for testing/inspection).
 */
export function getCurrentArenaInfo(): ArenaInfo | null {
  return currentArenaInfo;
}

/**
 * Get the current selection info (for testing/inspection).
 */
export function getCurrentSelectionInfo(): PlayerSelectionInfo | null {
  return currentSelectionInfo;
}

// --- Internal helpers ---

function scheduleEmit(): void {
  cancelDebounce();
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    emitView();
  }, DEBOUNCE_MS);
}

function cancelDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function emitView(): void {
  const socket = getActiveSocket();
  if (!socket) return;

  const session = getSession();
  if (!session) return;

  const data: UpdatePlayerViewRequest = {
    projectId: session.projectId,
    branchId: session.activeBranchId ?? null,
    arena: currentArenaInfo,
    selection: currentSelectionInfo,
    cursor: null, // MCP has no visual cursor
    position: null, // MCP has no viewport
  };

  socket.emit("view", data);
}
