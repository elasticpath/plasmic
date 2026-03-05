/**
 * Unit tests for tool-presence.ts
 *
 * Verifies that edit and inspect presence hooks correctly set arena and
 * selection info via the presence manager, with proper arena type detection
 * (page vs component), node reference resolution, and graceful degradation
 * when session/component is unavailable.
 *
 * Why: Presence hooks are the integration point between tool handlers and
 * Studio's multiplayer UI. Bugs here would make the agent invisible to
 * Studio users or emit incorrect component/node context, breaking the
 * collaborative editing experience.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../presence-manager.js", () => ({
  updateArena: vi.fn(),
  updateSelection: vi.fn(),
  clearSelection: vi.fn(),
}));

vi.mock("../session.js", () => ({
  getSession: vi.fn(),
}));

vi.mock("../node-resolver.js", () => ({
  resolveNode: vi.fn(),
}));

import {
  emitEditPresence,
  clearEditPresence,
  emitInspectPresence,
} from "../tool-presence.js";
import { updateArena, updateSelection, clearSelection } from "../presence-manager.js";
import { getSession } from "../session.js";
import { resolveNode } from "../node-resolver.js";

const mockUpdateArena = vi.mocked(updateArena);
const mockUpdateSelection = vi.mocked(updateSelection);
const mockClearSelection = vi.mocked(clearSelection);
const mockGetSession = vi.mocked(getSession);
const mockResolveNode = vi.mocked(resolveNode);

function makeSession(components: any[] = []) {
  return {
    projectId: "proj-123",
    projectName: "Test Project",
    site: { components },
    bundler: {},
    revisionNum: 5,
    modelVersion: 1,
    hostlessDataVersion: 3,
    projectUuid: "proj-123",
    bundleVersion: "256-test",
  };
}

function makeComponent(uuid: string, opts: { isPage?: boolean; name?: string } = {}) {
  return {
    uuid,
    name: opts.name ?? `Component-${uuid}`,
    ...(opts.isPage ? { pageMeta: { path: `/${opts.name ?? uuid}` } } : {}),
    tplTree: { uuid: "root-uuid" },
  };
}

describe("tool-presence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── emitEditPresence ──

  describe("emitEditPresence", () => {
    it("sets arena to component type for a non-page component", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);

      emitEditPresence("comp-1");

      expect(mockUpdateArena).toHaveBeenCalledWith("comp-1", "component");
      expect(mockUpdateSelection).not.toHaveBeenCalled();
    });

    it("sets arena to page type for a page component", () => {
      const page = makeComponent("page-1", { isPage: true, name: "Home" });
      mockGetSession.mockReturnValue(makeSession([page]) as any);

      emitEditPresence("page-1");

      expect(mockUpdateArena).toHaveBeenCalledWith("page-1", "page");
    });

    it("resolves nodeRef and sets selection when nodeRef is provided", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);
      mockResolveNode.mockReturnValue({
        nodes: [{ uuid: "node-uuid-1", node: {}, path: "root.child", component: comp }],
        isAmbiguous: false,
      } as any);

      emitEditPresence("comp-1", "child");

      expect(mockUpdateArena).toHaveBeenCalledWith("comp-1", "component");
      expect(mockResolveNode).toHaveBeenCalledWith(comp, "child");
      expect(mockUpdateSelection).toHaveBeenCalledWith("comp-1", "node-uuid-1");
    });

    it("uses first resolved node UUID when multiple matches", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);
      mockResolveNode.mockReturnValue({
        nodes: [
          { uuid: "first-uuid", node: {}, path: "root.a", component: comp },
          { uuid: "second-uuid", node: {}, path: "root.b", component: comp },
        ],
        isAmbiguous: true,
      } as any);

      emitEditPresence("comp-1", "ambiguous-ref");

      expect(mockUpdateSelection).toHaveBeenCalledWith("comp-1", "first-uuid");
    });

    it("sets selection with undefined nodeUuid when node resolution returns empty", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);
      mockResolveNode.mockReturnValue({
        nodes: [],
        isAmbiguous: false,
      } as any);

      emitEditPresence("comp-1", "nonexistent");

      // Still calls updateSelection with undefined nodeUuid (graceful degradation)
      expect(mockUpdateSelection).toHaveBeenCalledWith("comp-1", undefined);
    });

    it("sets selection with undefined nodeUuid when resolution throws", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);
      mockResolveNode.mockImplementation(() => {
        throw new Error("Resolution failed");
      });

      emitEditPresence("comp-1", "bad-ref");

      // Arena is still set
      expect(mockUpdateArena).toHaveBeenCalledWith("comp-1", "component");
      // Selection attempted with undefined
      expect(mockUpdateSelection).toHaveBeenCalledWith("comp-1", undefined);
    });

    it("does nothing when session is null", () => {
      mockGetSession.mockReturnValue(null);

      emitEditPresence("comp-1", "node-ref");

      expect(mockUpdateArena).not.toHaveBeenCalled();
      expect(mockUpdateSelection).not.toHaveBeenCalled();
    });

    it("does nothing when component UUID not found in session", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);

      emitEditPresence("nonexistent-uuid", "node-ref");

      expect(mockUpdateArena).not.toHaveBeenCalled();
      expect(mockUpdateSelection).not.toHaveBeenCalled();
    });

    it("handles session with empty components array", () => {
      mockGetSession.mockReturnValue(makeSession([]) as any);

      emitEditPresence("comp-1");

      expect(mockUpdateArena).not.toHaveBeenCalled();
    });

    it("sets arena without selection when nodeRef is undefined", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);

      emitEditPresence("comp-1", undefined);

      expect(mockUpdateArena).toHaveBeenCalledWith("comp-1", "component");
      expect(mockUpdateSelection).not.toHaveBeenCalled();
      expect(mockResolveNode).not.toHaveBeenCalled();
    });
  });

  // ── clearEditPresence ──

  describe("clearEditPresence", () => {
    it("calls clearSelection from presence manager", () => {
      clearEditPresence();

      expect(mockClearSelection).toHaveBeenCalledOnce();
    });
  });

  // ── emitInspectPresence ──

  describe("emitInspectPresence", () => {
    it("sets arena to component type for a non-page component", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);

      emitInspectPresence("comp-1");

      expect(mockUpdateArena).toHaveBeenCalledWith("comp-1", "component");
    });

    it("sets arena to page type for a page component", () => {
      const page = makeComponent("page-1", { isPage: true, name: "About" });
      mockGetSession.mockReturnValue(makeSession([page]) as any);

      emitInspectPresence("page-1");

      expect(mockUpdateArena).toHaveBeenCalledWith("page-1", "page");
    });

    it("does not set selection", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);

      emitInspectPresence("comp-1");

      expect(mockUpdateSelection).not.toHaveBeenCalled();
      expect(mockClearSelection).not.toHaveBeenCalled();
    });

    it("does nothing when session is null", () => {
      mockGetSession.mockReturnValue(null);

      emitInspectPresence("comp-1");

      expect(mockUpdateArena).not.toHaveBeenCalled();
    });

    it("does nothing when component UUID not found", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);

      emitInspectPresence("nonexistent-uuid");

      expect(mockUpdateArena).not.toHaveBeenCalled();
    });
  });

  // ── Integration scenarios ──

  describe("batch operation scenarios", () => {
    it("updates arena as focus moves between components", () => {
      const comp1 = makeComponent("comp-1");
      const comp2 = makeComponent("comp-2");
      mockGetSession.mockReturnValue(makeSession([comp1, comp2]) as any);

      // First edit targets comp-1
      emitEditPresence("comp-1");
      expect(mockUpdateArena).toHaveBeenCalledWith("comp-1", "component");

      // Second edit targets comp-2 (simulating batch with multiple components)
      emitEditPresence("comp-2");
      expect(mockUpdateArena).toHaveBeenCalledWith("comp-2", "component");
    });

    it("clearEditPresence preserves arena for next operation in batch", () => {
      const comp = makeComponent("comp-1");
      mockGetSession.mockReturnValue(makeSession([comp]) as any);

      emitEditPresence("comp-1", "some-node");
      clearEditPresence();

      // clearSelection was called but updateArena was not called again or reset
      expect(mockClearSelection).toHaveBeenCalledOnce();
      // Arena was set once and not cleared
      expect(mockUpdateArena).toHaveBeenCalledTimes(1);
    });
  });

  describe("mixed page and component context", () => {
    it("correctly distinguishes pages and components in same project", () => {
      const page = makeComponent("page-1", { isPage: true, name: "Home" });
      const comp = makeComponent("comp-1", { name: "Header" });
      mockGetSession.mockReturnValue(makeSession([page, comp]) as any);

      emitEditPresence("page-1");
      expect(mockUpdateArena).toHaveBeenCalledWith("page-1", "page");

      emitEditPresence("comp-1");
      expect(mockUpdateArena).toHaveBeenCalledWith("comp-1", "component");
    });
  });
});
