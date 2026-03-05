/**
 * Mock for @/wab/shared/ApiSchema
 *
 * Provides presence-related type stubs and constants used by
 * the presence manager and socket client.
 */

export const arenaTypes = ["custom", "page", "component"] as const;
export type ArenaType = (typeof arenaTypes)[number];

export interface ArenaInfo {
  type: ArenaType;
  uuidOrName: string;
  focused: boolean;
}

export interface PlayerSelectionInfo {
  selectableFrameUuid: string;
  selectableKey?: string;
}

export interface PlayerCursorInfo {
  [key: string]: any;
}

export interface PlayerPositionInfo {
  [key: string]: any;
}

export interface UpdatePlayerViewRequest {
  projectId: string;
  branchId: string | null;
  arena: ArenaInfo | null;
  selection: PlayerSelectionInfo | null;
  cursor: PlayerCursorInfo | null;
  position: PlayerPositionInfo | null;
}

export interface InitServerInfo {
  modelSchemaHash: number;
  bundleVersion: string;
  selfPlayerId: number;
}

export interface PlayerViewInfo {
  branchId?: string;
  arenaInfo?: ArenaInfo;
  selectionInfo?: PlayerSelectionInfo;
  cursorInfo?: PlayerCursorInfo;
  positionInfo?: PlayerPositionInfo;
}

export interface ServerSessionsInfo {
  sessions: any[];
}
