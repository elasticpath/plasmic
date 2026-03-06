/**
 * Unit tests for presence-manager.ts
 *
 * Tests view event emission, arena/selection tracking, debouncing,
 * reconnect re-emission, and graceful degradation when socket is
 * unavailable. Uses fake timers to control debounce timing.
 *
 * Why: Presence lets Studio users see the MCP agent as a collaborator,
 * showing which component and element it is focused on. Bugs here would
 * make the agent invisible or flood the socket with redundant events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  updateArena,
  updateSelection,
  clearPresence,
  clearSelection,
  emitViewNow,
  resetPresence,
  getCurrentArenaInfo,
  getCurrentSelectionInfo,
} from "../presence-manager.js";
import {
  connectSocket,
  disconnectSocket,
  setSocketFactory,
  type SocketLike,
} from "../socket-client.js";
import { setSession, clearSession } from "../session.js";
import type { Session } from "../session.js";

/** Create a mock socket with event tracking. */
function createMockSocket(): SocketLike & {
  _handlers: Record<string, ((...args: any[]) => void)[]>;
  _ioHandlers: Record<string, ((...args: any[]) => void)[]>;
  _emitted: Array<{ event: string; args: any[] }>;
  _fireEvent: (event: string, ...args: any[]) => void;
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
    site: { components: [] },
    bundler: {},
    revisionNum: 5,
    modelVersion: 1,
    hostlessDataVersion: 3,
    projectUuid: "proj-123",
    bundleVersion: "256-test",
    ...overrides,
  };
}

const MOCK_AUTH = {
  host: "https://studio.plasmic.app",
  user: "test-user",
  token: "test-token",
};

/** Helper to get all "view" emissions from a mock socket. */
function getViewEmissions(
  socket: ReturnType<typeof createMockSocket>
): any[] {
  return socket._emitted
    .filter((e) => e.event === "view")
    .map((e) => e.args[0]);
}

describe("presence-manager", () => {
  let mockSocket: ReturnType<typeof createMockSocket>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSocket = createMockSocket();
    setSocketFactory(vi.fn().mockReturnValue(mockSocket));
    setSession(makeSession());
  });

  afterEach(() => {
    resetPresence();
    disconnectSocket();
    clearSession();
    setSocketFactory(null);
    vi.useRealTimers();
  });

  /** Connect socket so getActiveSocket() returns the mock. */
  async function setupSocket(): Promise<void> {
    await connectSocket(MOCK_AUTH, "proj-123", {
      onUpdate: vi.fn(),
      onInitServerInfo: vi.fn(),
    });
  }

  describe("updateArena", () => {
    it("emits view event with arena info after debounce", async () => {
      await setupSocket();

      updateArena("comp-uuid-1", "component");
      expect(getViewEmissions(mockSocket)).toHaveLength(0);

      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(1);
      expect(emissions[0]).toEqual({
        projectId: "proj-123",
        branchId: null,
        arena: {
          type: "component",
          uuidOrName: "comp-uuid-1",
          focused: false,
        },
        selection: null,
        cursor: null,
        position: null,
      });
    });

    it("supports page arena type", async () => {
      await setupSocket();

      updateArena("page-uuid-1", "page");
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions[0].arena.type).toBe("page");
      expect(emissions[0].arena.uuidOrName).toBe("page-uuid-1");
    });

    it("tracks arena info in internal state", () => {
      updateArena("comp-uuid-1", "component");
      expect(getCurrentArenaInfo()).toEqual({
        type: "component",
        uuidOrName: "comp-uuid-1",
        focused: false,
      });
    });
  });

  describe("updateSelection", () => {
    it("emits view event with selection info", async () => {
      await setupSocket();

      updateArena("comp-uuid-1", "component");
      updateSelection("frame-uuid-1", "node-uuid-99");
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(1);
      expect(emissions[0].selection).toEqual({
        selectableFrameUuid: "frame-uuid-1",
        selectableKey: "node-uuid-99",
      });
    });

    it("works without selectableKey", async () => {
      await setupSocket();

      updateSelection("frame-uuid-1");
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions[0].selection).toEqual({
        selectableFrameUuid: "frame-uuid-1",
      });
      expect(emissions[0].selection).not.toHaveProperty("selectableKey");
    });

    it("tracks selection info in internal state", () => {
      updateSelection("frame-uuid-1", "node-uuid-99");
      expect(getCurrentSelectionInfo()).toEqual({
        selectableFrameUuid: "frame-uuid-1",
        selectableKey: "node-uuid-99",
      });
    });
  });

  describe("clearPresence", () => {
    it("emits view with null arena and selection", async () => {
      await setupSocket();

      updateArena("comp-uuid-1", "component");
      updateSelection("frame-uuid-1", "node-uuid-99");
      vi.advanceTimersByTime(200);

      clearPresence();
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(2);
      expect(emissions[1].arena).toBeNull();
      expect(emissions[1].selection).toBeNull();
    });

    it("clears internal state", () => {
      updateArena("comp-uuid-1", "component");
      updateSelection("frame-uuid-1");
      clearPresence();

      expect(getCurrentArenaInfo()).toBeNull();
      expect(getCurrentSelectionInfo()).toBeNull();
    });
  });

  describe("clearSelection", () => {
    it("clears selection but keeps arena", async () => {
      await setupSocket();

      updateArena("comp-uuid-1", "component");
      updateSelection("frame-uuid-1", "node-uuid-99");
      vi.advanceTimersByTime(200);

      clearSelection();
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(2);
      expect(emissions[1].arena).toEqual({
        type: "component",
        uuidOrName: "comp-uuid-1",
        focused: false,
      });
      expect(emissions[1].selection).toBeNull();
    });
  });

  describe("debouncing", () => {
    it("coalesces rapid updates into a single emission", async () => {
      await setupSocket();

      updateArena("comp-1", "component");
      updateArena("comp-2", "component");
      updateArena("comp-3", "component");
      updateSelection("frame-1", "node-1");

      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(1);
      expect(emissions[0].arena!.uuidOrName).toBe("comp-3");
      expect(emissions[0].selection!.selectableKey).toBe("node-1");
    });

    it("resets debounce timer on each call", async () => {
      await setupSocket();

      updateArena("comp-1", "component");
      vi.advanceTimersByTime(100);

      updateArena("comp-2", "component");
      vi.advanceTimersByTime(100);

      // Only 100ms since last call — should not have emitted yet
      expect(getViewEmissions(mockSocket)).toHaveLength(0);

      vi.advanceTimersByTime(100);

      // Now 200ms since last call
      expect(getViewEmissions(mockSocket)).toHaveLength(1);
      expect(getViewEmissions(mockSocket)[0].arena!.uuidOrName).toBe("comp-2");
    });
  });

  describe("emitViewNow", () => {
    it("emits immediately bypassing debounce", async () => {
      await setupSocket();

      updateArena("comp-uuid-1", "component");
      emitViewNow();

      // Should emit immediately without waiting for debounce
      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(1);
      expect(emissions[0].arena!.uuidOrName).toBe("comp-uuid-1");
    });

    it("cancels pending debounced emission", async () => {
      await setupSocket();

      updateArena("comp-1", "component");
      // This should cancel the pending debounce and emit immediately
      emitViewNow();

      vi.advanceTimersByTime(300);

      // Only one emission total (the immediate one, not a second debounced one)
      expect(getViewEmissions(mockSocket)).toHaveLength(1);
    });
  });

  describe("resetPresence", () => {
    it("clears state without emitting", async () => {
      await setupSocket();

      updateArena("comp-uuid-1", "component");
      // Reset before debounce fires
      resetPresence();

      vi.advanceTimersByTime(300);

      // No emissions — reset cancelled the debounce
      expect(getViewEmissions(mockSocket)).toHaveLength(0);
      expect(getCurrentArenaInfo()).toBeNull();
      expect(getCurrentSelectionInfo()).toBeNull();
    });
  });

  describe("no socket", () => {
    it("does not throw when socket is not connected", () => {
      // No setupSocket() called, so getActiveSocket() returns null
      expect(() => {
        updateArena("comp-uuid-1", "component");
        vi.advanceTimersByTime(200);
      }).not.toThrow();

      // State is still tracked even without socket
      expect(getCurrentArenaInfo()).toEqual({
        type: "component",
        uuidOrName: "comp-uuid-1",
        focused: false,
      });
    });
  });

  describe("no session", () => {
    it("does not emit when session is cleared", async () => {
      await setupSocket();
      clearSession();

      updateArena("comp-uuid-1", "component");
      vi.advanceTimersByTime(200);

      expect(getViewEmissions(mockSocket)).toHaveLength(0);
    });
  });

  describe("batch operation presence", () => {
    it("tracks arena changes during a batch", async () => {
      await setupSocket();

      // Simulate batch editing across components
      updateArena("comp-1", "component");
      vi.advanceTimersByTime(200);

      updateArena("comp-2", "component");
      updateSelection("frame-2", "node-2");
      vi.advanceTimersByTime(200);

      clearSelection();
      vi.advanceTimersByTime(200);

      updateArena("comp-3", "page");
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(4);

      // First: comp-1 with no selection
      expect(emissions[0].arena!.uuidOrName).toBe("comp-1");
      expect(emissions[0].selection).toBeNull();

      // Second: comp-2 with selection
      expect(emissions[1].arena!.uuidOrName).toBe("comp-2");
      expect(emissions[1].selection!.selectableKey).toBe("node-2");

      // Third: comp-2 with selection cleared
      expect(emissions[2].arena!.uuidOrName).toBe("comp-2");
      expect(emissions[2].selection).toBeNull();

      // Fourth: comp-3 as page
      expect(emissions[3].arena!.type).toBe("page");
      expect(emissions[3].arena!.uuidOrName).toBe("comp-3");
    });
  });

  describe("branch-aware branchId", () => {
    it("emits null branchId when session has no activeBranchId", async () => {
      await setupSocket();

      updateArena("comp-uuid-1", "component");
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(1);
      expect(emissions[0].branchId).toBeNull();
    });

    it("emits activeBranchId from session in view events", async () => {
      clearSession();
      setSession(makeSession({ activeBranchId: "branch-abc" }));
      await setupSocket();

      updateArena("comp-uuid-1", "component");
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(1);
      expect(emissions[0].branchId).toBe("branch-abc");
    });

    it("reflects branch changes between emissions", async () => {
      const session = makeSession();
      clearSession();
      setSession(session);
      await setupSocket();

      updateArena("comp-1", "component");
      vi.advanceTimersByTime(200);

      // Switch to a branch
      session.activeBranchId = "branch-xyz";
      updateArena("comp-2", "component");
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(2);
      expect(emissions[0].branchId).toBeNull();
      expect(emissions[1].branchId).toBe("branch-xyz");
    });
  });

  describe("read-only inspection", () => {
    it("emits arena info without selection for inspection", async () => {
      await setupSocket();

      // Inspection: set arena but no selection
      updateArena("comp-uuid-1", "component");
      vi.advanceTimersByTime(200);

      const emissions = getViewEmissions(mockSocket);
      expect(emissions).toHaveLength(1);
      expect(emissions[0].arena).not.toBeNull();
      expect(emissions[0].selection).toBeNull();
      expect(emissions[0].cursor).toBeNull();
      expect(emissions[0].position).toBeNull();
    });
  });
});
