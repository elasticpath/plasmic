/**
 * Unit tests for socket-client.ts
 *
 * Tests socket.io connection lifecycle, authentication headers,
 * subscribe flow, event handling, reconnection, and disconnect.
 * Uses a mock socket factory to avoid requiring the real socket.io-client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  connectSocket,
  disconnectSocket,
  getActiveSocket,
  isSocketConnected,
  getSocketProjectId,
  setSocketFactory,
  type SocketLike,
  type SocketClientCallbacks,
} from "../socket-client.js";

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

const TEST_AUTH = {
  host: "https://studio.plasmic.app",
  user: "test-user",
  token: "test-token",
};

const TEST_AUTH_WITH_BASIC = {
  ...TEST_AUTH,
  basicAuthUser: "basic-user",
  basicAuthPassword: "basic-pass",
};

describe("socket-client", () => {
  let mockSocket: ReturnType<typeof createMockSocket>;
  let factoryFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = createMockSocket();
    factoryFn = vi.fn().mockReturnValue(mockSocket);
    setSocketFactory(factoryFn);
  });

  afterEach(() => {
    disconnectSocket();
    setSocketFactory(null);
  });

  describe("connectSocket", () => {
    it("connects with correct auth headers", async () => {
      const callbacks: SocketClientCallbacks = {
        onUpdate: vi.fn(),
        onInitServerInfo: vi.fn(),
      };

      await connectSocket(TEST_AUTH, "proj-123", callbacks);

      expect(factoryFn).toHaveBeenCalledWith(
        TEST_AUTH.host,
        expect.objectContaining({
          path: "/api/v1/socket",
          transports: ["websocket"],
          extraHeaders: {
            "x-plasmic-api-user": "test-user",
            "x-plasmic-api-token": "test-token",
          },
        })
      );
    });

    it("includes Basic Auth header when configured", async () => {
      const callbacks: SocketClientCallbacks = {
        onUpdate: vi.fn(),
        onInitServerInfo: vi.fn(),
      };

      await connectSocket(TEST_AUTH_WITH_BASIC, "proj-123", callbacks);

      const expectedBasic = Buffer.from("basic-user:basic-pass").toString(
        "base64"
      );
      expect(factoryFn).toHaveBeenCalledWith(
        TEST_AUTH_WITH_BASIC.host,
        expect.objectContaining({
          extraHeaders: expect.objectContaining({
            Authorization: `Basic ${expectedBasic}`,
          }),
        })
      );
    });

    it("stores active socket state", async () => {
      const callbacks: SocketClientCallbacks = {
        onUpdate: vi.fn(),
        onInitServerInfo: vi.fn(),
      };

      await connectSocket(TEST_AUTH, "proj-123", callbacks);

      expect(getActiveSocket()).toBe(mockSocket);
      expect(getSocketProjectId()).toBe("proj-123");
      expect(isSocketConnected()).toBe(true);
    });

    it("disconnects previous socket on reconnect", async () => {
      const callbacks: SocketClientCallbacks = {
        onUpdate: vi.fn(),
        onInitServerInfo: vi.fn(),
      };

      await connectSocket(TEST_AUTH, "proj-111", callbacks);
      const firstSocket = mockSocket;

      // Create a new mock for the second connection
      const secondMockSocket = createMockSocket();
      factoryFn.mockReturnValue(secondMockSocket);

      await connectSocket(TEST_AUTH, "proj-222", callbacks);

      expect(firstSocket.disconnect).toHaveBeenCalled();
      expect(getActiveSocket()).toBe(secondMockSocket);
      expect(getSocketProjectId()).toBe("proj-222");
    });
  });

  describe("subscribe flow", () => {
    it("emits subscribe on initServerInfo", async () => {
      const onInitServerInfo = vi.fn();
      await connectSocket(TEST_AUTH, "proj-123", {
        onUpdate: vi.fn(),
        onInitServerInfo,
      });

      // Simulate server sending initServerInfo
      mockSocket._fireEvent("initServerInfo", {
        modelSchemaHash: 12345,
        bundleVersion: "256-test",
        selfPlayerId: 42,
      });

      // Should have emitted subscribe
      const subscribeCall = mockSocket._emitted.find(
        (e) => e.event === "subscribe"
      );
      expect(subscribeCall).toBeDefined();
      expect(subscribeCall!.args[0]).toEqual({
        namespace: "projects",
        projectIds: ["proj-123"],
        studio: true,
      });

      // Should have called the callback
      expect(onInitServerInfo).toHaveBeenCalledWith({
        modelSchemaHash: 12345,
        bundleVersion: "256-test",
        selfPlayerId: 42,
      });
    });
  });

  describe("event handling", () => {
    it("routes update events to callback", async () => {
      const onUpdate = vi.fn();
      await connectSocket(TEST_AUTH, "proj-123", {
        onUpdate,
        onInitServerInfo: vi.fn(),
      });

      const updateData = {
        projectId: "proj-123",
        rev: { revision: 5, branchId: null },
      };
      mockSocket._fireEvent("update", updateData);

      expect(onUpdate).toHaveBeenCalledWith(updateData);
    });

    it("routes hostlessDataVersionUpdate events", async () => {
      const onHostlessDataVersionUpdate = vi.fn();
      await connectSocket(TEST_AUTH, "proj-123", {
        onUpdate: vi.fn(),
        onInitServerInfo: vi.fn(),
        onHostlessDataVersionUpdate,
      });

      mockSocket._fireEvent("hostlessDataVersionUpdate", {
        hostlessDataVersion: 7,
      });

      expect(onHostlessDataVersionUpdate).toHaveBeenCalledWith({
        hostlessDataVersion: 7,
      });
    });

    it("routes error events", async () => {
      const onError = vi.fn();
      await connectSocket(TEST_AUTH, "proj-123", {
        onUpdate: vi.fn(),
        onInitServerInfo: vi.fn(),
        onError,
      });

      mockSocket._fireEvent("error", "connection refused");

      expect(onError).toHaveBeenCalledWith("connection refused");
    });
  });

  describe("reconnection", () => {
    it("re-subscribes on reconnect", async () => {
      const onReconnect = vi.fn();
      await connectSocket(TEST_AUTH, "proj-123", {
        onUpdate: vi.fn(),
        onInitServerInfo: vi.fn(),
        onReconnect,
      });

      // Simulate reconnect
      mockSocket._fireIoEvent("reconnect");

      // Should have emitted subscribe again
      const subscribeCalls = mockSocket._emitted.filter(
        (e) => e.event === "subscribe"
      );
      expect(subscribeCalls).toHaveLength(1);
      expect(subscribeCalls[0].args[0]).toEqual({
        namespace: "projects",
        projectIds: ["proj-123"],
        studio: true,
      });

      expect(onReconnect).toHaveBeenCalled();
    });
  });

  describe("disconnectSocket", () => {
    it("disconnects and clears state", async () => {
      await connectSocket(TEST_AUTH, "proj-123", {
        onUpdate: vi.fn(),
        onInitServerInfo: vi.fn(),
      });

      disconnectSocket();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(getActiveSocket()).toBeNull();
      expect(getSocketProjectId()).toBeNull();
      expect(isSocketConnected()).toBe(false);
    });

    it("is safe to call when not connected", () => {
      disconnectSocket();
      expect(getActiveSocket()).toBeNull();
    });
  });

  describe("connection failure", () => {
    it("handles factory errors gracefully", async () => {
      factoryFn.mockImplementation(() => {
        throw new Error("socket.io not available");
      });

      // Should not throw — graceful degradation
      await connectSocket(TEST_AUTH, "proj-123", {
        onUpdate: vi.fn(),
        onInitServerInfo: vi.fn(),
      });

      expect(getActiveSocket()).toBeNull();
    });
  });
});
