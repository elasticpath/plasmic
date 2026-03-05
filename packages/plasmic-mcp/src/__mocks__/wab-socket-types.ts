/**
 * Mock for @/wab/shared/api/socket
 *
 * Re-exports type stubs for ClientToServerEvents and ServerToClientEvents.
 * These are type-only exports — no runtime behavior needed in mocks.
 */

export type ClientToServerEvents = {
  subscribe: (data: {
    namespace: string;
    projectIds?: string[];
    studio?: boolean;
  }) => unknown | Promise<unknown>;
  view: (data: any) => unknown | Promise<unknown>;
};

export type ServerToClientEvents = {
  connect: (data: {}) => unknown | Promise<unknown>;
  disconnect: (data: {}) => unknown | Promise<unknown>;
  initServerInfo: (data: {
    modelSchemaHash: number;
    bundleVersion: string;
    selfPlayerId: number;
  }) => unknown | Promise<unknown>;
  commentsUpdate: (data: {}) => unknown | Promise<unknown>;
  update: (data: {
    projectId: string;
    rev: { revision: number; branchId: string | null };
  }) => unknown | Promise<unknown>;
  players: (data: { sessions: any[] }) => unknown | Promise<unknown>;
  error: (data: string) => unknown | Promise<unknown>;
  publish: (data: any) => unknown | Promise<unknown>;
  hostlessDataVersionUpdate: (data: {
    hostlessDataVersion: number;
  }) => unknown | Promise<unknown>;
};
