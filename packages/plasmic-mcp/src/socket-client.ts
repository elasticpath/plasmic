/**
 * Socket.io client for real-time collaboration with Plasmic Studio.
 *
 * Manages connection lifecycle, authentication, and event routing.
 * Connects to {apiHost}/api/v1/socket using the same auth headers
 * as api-client.ts. Emits `subscribe` with studio: true to enable
 * view events and presence tracking.
 *
 * Reference: packages/watcher/src/watcher.ts (simpler socket.io pattern)
 * Reference: platform/wab/src/wab/server/routes/projects-socket.ts
 */

import type { AuthConfig } from "./types.js";

/** Subset of socket.io Socket interface we actually use.
 *  Avoids importing socket.io-client types at the module level
 *  so tests can mock the connect function without requiring the package. */
export interface SocketLike {
  on(event: string, fn: (...args: any[]) => void): void;
  off(event: string, fn?: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
  disconnect(): void;
  connected: boolean;
  io: {
    on(event: string, fn: (...args: any[]) => void): void;
    off(event: string, fn?: (...args: any[]) => void): void;
  };
}

export interface InitServerInfoData {
  modelSchemaHash: number;
  bundleVersion: string;
  selfPlayerId: number;
}

export interface UpdateEventData {
  projectId: string;
  rev: {
    revision: number;
    branchId: string | null;
  };
}

export interface SocketClientCallbacks {
  onUpdate: (data: UpdateEventData) => void;
  onInitServerInfo: (data: InitServerInfoData) => void;
  onHostlessDataVersionUpdate?: (data: { hostlessDataVersion: number }) => void;
  onError?: (msg: string) => void;
  onReconnect?: () => void;
}

/**
 * Create auth headers for the socket connection.
 * Matches the pattern in api-client.ts makeHeaders().
 */
function makeSocketHeaders(auth: AuthConfig, cookies?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "x-plasmic-api-user": auth.user,
    "x-plasmic-api-token": auth.token,
  };
  if (auth.basicAuthUser && auth.basicAuthPassword) {
    const basic = Buffer.from(
      `${auth.basicAuthUser}:${auth.basicAuthPassword}`
    ).toString("base64");
    headers["Authorization"] = `Basic ${basic}`;
  }
  if (cookies) {
    headers["Cookie"] = cookies;
  }
  return headers;
}

/** Injected socket factory — defaults to real socket.io-client, overridable for tests. */
let socketFactory: ((url: string, opts: any) => SocketLike) | null = null;

/** Override the socket factory (for testing). */
export function setSocketFactory(
  factory: ((url: string, opts: any) => SocketLike) | null
): void {
  socketFactory = factory;
}

/** Lazy-load real socket.io-client. */
async function createRealSocket(
  url: string,
  opts: any
): Promise<SocketLike> {
  // Dynamic import so the module is only loaded when actually connecting
  const { io } = await import("socket.io-client");
  return io(url, opts) as unknown as SocketLike;
}

/**
 * Active socket connection state.
 */
let activeSocket: SocketLike | null = null;
let activeProjectId: string | null = null;
let activeCallbacks: SocketClientCallbacks | null = null;

/**
 * Connect to the Plasmic socket server for real-time updates.
 *
 * - Authenticates using the same headers as the HTTP API client
 * - Subscribes to the project room with studio: true
 * - Routes server events to the provided callbacks
 * - Auto-reconnects on disconnect (socket.io default behavior)
 */
export async function connectSocket(
  auth: AuthConfig,
  projectId: string,
  callbacks: SocketClientCallbacks,
  cookies?: string
): Promise<void> {
  // Disconnect any existing connection first
  if (activeSocket) {
    disconnectSocket();
  }

  const headers = makeSocketHeaders(auth, cookies);

  // Follow the watcher pattern (packages/watcher/src/watcher.ts:42-50):
  // Use default transports (polling first, then WebSocket upgrade).
  // Auth headers go in both top-level extraHeaders and transportOptions.polling
  // so they're sent during the HTTP polling handshake that establishes the session.
  const socketOpts = {
    path: "/api/v1/socket",
    extraHeaders: headers,
    transportOptions: {
      polling: {
        extraHeaders: headers,
      },
    },
  };

  let socket: SocketLike;
  try {
    if (socketFactory) {
      socket = socketFactory(auth.host, socketOpts);
    } else {
      socket = await createRealSocket(auth.host, socketOpts);
    }
  } catch (err) {
    console.error(
      `[plasmic-mcp] Socket connection failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  activeSocket = socket;

  // Diagnostic logging for connection failures
  socket.on("connect_error", (err: Error) => {
    console.error(
      `[plasmic-mcp] Socket connect_error: ${err.message}`
    );
  });
  activeProjectId = projectId;
  activeCallbacks = callbacks;

  // Subscribe to project room when server sends initServerInfo
  socket.on("initServerInfo", (data: InitServerInfoData) => {
    console.error(
      `[plasmic-mcp] Socket initServerInfo: schemaHash=${data.modelSchemaHash}, ` +
        `bundleVersion=${data.bundleVersion}, playerId=${data.selfPlayerId}`
    );
    emitSubscribe(socket, projectId);
    callbacks.onInitServerInfo(data);
  });

  // Handle model update events
  socket.on("update", (data: UpdateEventData) => {
    console.error(
      `[plasmic-mcp] Socket update: project=${data.projectId}, ` +
        `revision=${data.rev.revision}, branch=${data.rev.branchId}`
    );
    callbacks.onUpdate(data);
  });

  // Handle hostless data version updates
  socket.on(
    "hostlessDataVersionUpdate",
    (data: { hostlessDataVersion: number }) => {
      console.error(
        `[plasmic-mcp] Socket hostlessDataVersionUpdate: version=${data.hostlessDataVersion}`
      );
      callbacks.onHostlessDataVersionUpdate?.(data);
    }
  );

  // Handle errors
  socket.on("error", (msg: string) => {
    console.error(`[plasmic-mcp] Socket error: ${msg}`);
    callbacks.onError?.(msg);
  });

  // Re-subscribe on reconnect
  socket.io.on("reconnect", () => {
    console.error("[plasmic-mcp] Socket reconnected, re-subscribing...");
    emitSubscribe(socket, projectId);
    callbacks.onReconnect?.();
  });

  console.error(
    `[plasmic-mcp] Socket connecting to ${auth.host}/api/v1/socket for project ${projectId}`
  );
}

/**
 * Emit a subscribe event to join the project room.
 */
function emitSubscribe(socket: SocketLike, projectId: string): void {
  socket.emit("subscribe", {
    namespace: "projects",
    projectIds: [projectId],
    studio: true,
  });
  console.error(`[plasmic-mcp] Socket subscribed to project ${projectId}`);
}

/**
 * Disconnect from the socket server.
 * Called on session clear or project switch.
 */
export function disconnectSocket(): void {
  if (activeSocket) {
    activeSocket.disconnect();
    console.error("[plasmic-mcp] Socket disconnected");
    activeSocket = null;
    activeProjectId = null;
    activeCallbacks = null;
  }
}

/**
 * Get the active socket instance (for emitting view events).
 * Returns null if not connected.
 */
export function getActiveSocket(): SocketLike | null {
  return activeSocket;
}

/**
 * Check if a socket connection is active.
 */
export function isSocketConnected(): boolean {
  return activeSocket?.connected ?? false;
}

/**
 * Get the project ID of the current socket subscription.
 */
export function getSocketProjectId(): string | null {
  return activeProjectId;
}
