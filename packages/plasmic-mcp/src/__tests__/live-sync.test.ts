/**
 * Unit tests for live-sync.ts
 *
 * Tests the integration module that wires socket, update queue, and rebase
 * engine into the session lifecycle. Covers: startLiveSync, stopLiveSync,
 * initServerInfo handling, hostless data version update, and error resilience.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startLiveSync,
  stopLiveSync,
  isLiveSyncActive,
} from "../live-sync.js";
import {
  setSocketFactory,
  disconnectSocket,
  type SocketLike,
} from "../socket-client.js";
import { setSession, clearSession, getSession } from "../session.js";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker.js";
import type { Session } from "../session.js";

/** Create a mock socket with event emitter behavior. */
function createMockSocket(): SocketLike & {
  _handlers: Record<string, ((...args: any[]) => void)[]>;
  _ioHandlers: Record<string, ((...args: any[]) => void)[]>;
  _emitted: Array<{ event: string; args: any[] }>;
  _fireEvent: (event: string, ...args: any[]) => void;
  _fireIoEvent: (event: string, ...args: any[]) => void;
} {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  const ioHandlers: Record<string, ((...args: any[]) => void)[]> = {};
  const emitted: Array<{ event: string; args: any[] }> = [];

  return {
    _handlers: handlers,
    _ioHandlers: ioHandlers,
    _emitted: emitted,
    _fireEvent(event: string, ...args: any[]) {
      for (const fn of handlers[event] ?? []) fn(...args);
    },
    _fireIoEvent(event: string, ...args: any[]) {
      for (const fn of ioHandlers[event] ?? []) fn(...args);
    },
    connected: true,
    on(event: string, fn: (...args: any[]) => void) {
      (handlers[event] ??= []).push(fn);
    },
    off(event: string, fn?: (...args: any[]) => void) {
      if (fn) {
        handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
      } else {
        delete handlers[event];
      }
    },
    emit(event: string, ...args: any[]) {
      emitted.push({ event, args });
    },
    disconnect: vi.fn(),
    io: {
      on(event: string, fn: (...args: any[]) => void) {
        (ioHandlers[event] ??= []).push(fn);
      },
      off(event: string, fn?: (...args: any[]) => void) {
        if (fn) {
          ioHandlers[event] = (ioHandlers[event] ?? []).filter(
            (h) => h !== fn
          );
        } else {
          delete ioHandlers[event];
        }
      },
    },
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    projectId: "proj-123",
    projectName: "Test Project",
    site: { components: [], projectDependencies: [] },
    bundler: {
      allUuids: vi.fn().mockReturnValue([]),
      unbundlePartial: vi.fn(),
      objByAddr: vi.fn().mockReturnValue(undefined),
    },
    revisionNum: 5,
    modelVersion: 1,
    hostlessDataVersion: 3,
    projectUuid: "proj-123",
    bundleVersion: "256-test",
    isAtTip: true,
    ...overrides,
  };
}

const MOCK_AUTH = {
  host: "https://studio.plasmic.app",
  user: "test-user",
  token: "test-token",
};

describe("live-sync", () => {
  let mockSocket: ReturnType<typeof createMockSocket>;
  let factoryFn: ReturnType<typeof vi.fn>;
  let mockApiClient: any;

  beforeEach(() => {
    mockSocket = createMockSocket();
    factoryFn = vi.fn().mockReturnValue(mockSocket);
    setSocketFactory(factoryFn);

    mockApiClient = {
      getAuth: vi.fn().mockReturnValue(MOCK_AUTH),
      getModelUpdates: vi.fn().mockResolvedValue({ data: null }),
    };
  });

  afterEach(() => {
    stopLiveSync();
    clearSession();
    disposeChangeTracker();
    setSocketFactory(null);
  });

  describe("startLiveSync", () => {
    it("connects socket and creates update queue", async () => {
      const session = makeSession();
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");

      expect(isLiveSyncActive()).toBe(true);
      expect(factoryFn).toHaveBeenCalled();
    });

    it("initializes serverUpdatesSummary on session", async () => {
      const session = makeSession();
      setSession(session);
      initChangeTracker(session.site);

      expect(session.serverUpdatesSummary).toBeUndefined();

      await startLiveSync(mockApiClient, "proj-123");

      expect(session.serverUpdatesSummary).toBeDefined();
      expect(session.isAtTip).toBe(true);
    });

    it("skips when no session exists", async () => {
      // No session set
      await startLiveSync(mockApiClient, "proj-123");

      // Should not have tried to connect socket
      expect(factoryFn).not.toHaveBeenCalled();
      expect(isLiveSyncActive()).toBe(false);
    });

    it("stops previous sync before starting new one", async () => {
      const session = makeSession();
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");
      const firstSocket = mockSocket;

      // Create new mock for second connection
      const secondMock = createMockSocket();
      factoryFn.mockReturnValue(secondMock);

      await startLiveSync(mockApiClient, "proj-456");

      expect(firstSocket.disconnect).toHaveBeenCalled();
      expect(isLiveSyncActive()).toBe(true);
    });
  });

  describe("stopLiveSync", () => {
    it("disconnects socket and clears state", async () => {
      const session = makeSession();
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");
      expect(isLiveSyncActive()).toBe(true);

      stopLiveSync();

      expect(isLiveSyncActive()).toBe(false);
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it("is safe to call when not started", () => {
      stopLiveSync(); // Should not throw
      expect(isLiveSyncActive()).toBe(false);
    });
  });

  describe("initServerInfo handling", () => {
    it("stores selfPlayerId on session", async () => {
      const session = makeSession();
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");

      mockSocket._fireEvent("initServerInfo", {
        modelSchemaHash: "mock-hash",
        bundleVersion: "256-test",
        selfPlayerId: 42,
      });

      expect(session.selfPlayerId).toBe(42);
    });

    it("detects bundle version mismatch", async () => {
      const session = makeSession({ bundleVersion: "255-old" });
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");

      mockSocket._fireEvent("initServerInfo", {
        modelSchemaHash: "mock-hash",
        bundleVersion: "256-new",
        selfPlayerId: 1,
      });

      expect(session.isAtTip).toBe(false);
    });

    it("stays at tip when versions match", async () => {
      const session = makeSession({ bundleVersion: "256-test" });
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");

      mockSocket._fireEvent("initServerInfo", {
        modelSchemaHash: "mock-hash",
        bundleVersion: "256-test",
        selfPlayerId: 1,
      });

      expect(session.isAtTip).toBe(true);
    });
  });

  describe("hostless data version update", () => {
    it("updates session when version increases", async () => {
      const session = makeSession({ hostlessDataVersion: 3 });
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");

      mockSocket._fireEvent("hostlessDataVersionUpdate", {
        hostlessDataVersion: 5,
      });

      expect(session.hostlessDataVersion).toBe(5);
    });

    it("ignores lower or equal versions", async () => {
      const session = makeSession({ hostlessDataVersion: 5 });
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");

      mockSocket._fireEvent("hostlessDataVersionUpdate", {
        hostlessDataVersion: 3,
      });

      expect(session.hostlessDataVersion).toBe(5);
    });
  });

  describe("update event routing", () => {
    it("routes update events through the queue", async () => {
      const session = makeSession();
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");

      // Fire an update event
      mockSocket._fireEvent("update", {
        projectId: "proj-123",
        rev: { revision: 6, branchId: null },
      });

      // Wait for async queue processing
      await new Promise((r) => setTimeout(r, 100));

      // The handler should have called getModelUpdates
      expect(mockApiClient.getModelUpdates).toHaveBeenCalledWith(
        "proj-123",
        5, // session revisionNum
        []  // bundler.allUuids()
      );
    });

    it("skips updates for different projects", async () => {
      const session = makeSession();
      setSession(session);
      initChangeTracker(session.site);

      await startLiveSync(mockApiClient, "proj-123");

      mockSocket._fireEvent("update", {
        projectId: "proj-OTHER",
        rev: { revision: 6, branchId: null },
      });

      await new Promise((r) => setTimeout(r, 100));

      // Should not have called getModelUpdates since project ID doesn't match
      expect(mockApiClient.getModelUpdates).not.toHaveBeenCalled();
    });
  });
});
