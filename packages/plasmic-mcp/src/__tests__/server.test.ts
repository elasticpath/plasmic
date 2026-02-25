/**
 * Integration tests for server.ts
 *
 * Two test suites:
 *   1. createServer — smoke tests for server construction and auth (existing)
 *   2. tool handlers — verifies all 17 MCP tool handlers by connecting a real
 *      Client ↔ Server pair via InMemoryTransport and calling each tool
 *
 * The tool handler tests mock every module that server.ts imports (model-loader,
 * session, edit-tools, etc.) to isolate the wiring logic in server.ts. Individual
 * modules have their own unit tests.
 *
 * Uses jest.resetModules() + dynamic require() because the esbuild jest
 * transform doesn't hoist jest.mock calls.
 */

// ============================================================================
// Suite 1: Server construction (existing smoke tests)
// ============================================================================

describe("createServer", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv };
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com";
    process.env.PLASMIC_AUTH_USER = "test-user";
    process.env.PLASMIC_AUTH_TOKEN = "test-token";
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it("creates a server with all tools registered without throwing", () => {
    jest.resetModules();
    jest.mock("mobx", () => ({ configure: jest.fn() }));
    // Mock fs/os to prevent .plasmic.auth file fallback
    jest.mock("fs", () => ({
      readFileSync: () => { throw new Error("ENOENT"); },
      writeFileSync: jest.fn(),
    }));
    jest.mock("os", () => ({
      homedir: () => "/mock/home",
      tmpdir: () => "/tmp",
    }));

    const { createServer } = require("../server");
    const server = createServer();
    expect(server).toBeDefined();
  });

  it("throws when auth is not configured", () => {
    delete process.env.PLASMIC_AUTH_HOST;
    delete process.env.PLASMIC_AUTH_USER;
    delete process.env.PLASMIC_AUTH_TOKEN;

    jest.resetModules();
    jest.mock("mobx", () => ({ configure: jest.fn() }));
    jest.mock("fs", () => ({
      readFileSync: () => { throw new Error("ENOENT"); },
      writeFileSync: jest.fn(),
    }));
    jest.mock("os", () => ({
      homedir: () => "/mock/home",
      tmpdir: () => "/tmp",
    }));

    const { createServer } = require("../server");
    expect(() => createServer()).toThrow("Plasmic authentication required");
  });
});

// ============================================================================
// Suite 2: Tool handler integration tests
//
// Each test creates a real McpServer (via createServer) with mocked
// dependencies, connects a Client via InMemoryTransport, calls the tool,
// and asserts the response. This validates the full MCP protocol path:
//   Client.callTool → transport → Server dispatch → handler → response
// ============================================================================

describe("tool handlers", () => {
  const savedEnv = { ...process.env };

  // References to mock functions — reassigned fresh in each beforeEach
  let client: any;
  let mockApiClient: any;
  let mockLoadProject: jest.Mock;
  let mockSetSession: jest.Mock;
  let mockRequireSession: jest.Mock;
  let mockInitChangeTracker: jest.Mock;
  let mockDisposeChangeTracker: jest.Mock;
  let mockReadComponentTree: jest.Mock;
  let mockReadComponentSummary: jest.Mock;
  let mockReadNodeDetails: jest.Mock;
  let mockReadSubtree: jest.Mock;
  let mockCountTreeNodes: jest.Mock;
  let mockReadTokens: jest.Mock;
  let mockResolveNode: jest.Mock;
  let mockRequireSingleNode: jest.Mock;
  let mockInvalidateNodeCache: jest.Mock;
  let mockClearNodeCache: jest.Mock;
  let mockUpdateText: jest.Mock;
  let mockUpdateStyles: jest.Mock;
  let mockAddChild: jest.Mock;
  let mockRemoveChild: jest.Mock;
  let mockMoveChild: jest.Mock;
  let mockListVariants: jest.Mock;
  let mockRenameComponent: jest.Mock;
  let mockUpdatePageMeta: jest.Mock;
  let mockDeleteComponent: jest.Mock;
  let mockCreateStyleVariant: jest.Mock;
  let mockCreateVariantGroup: jest.Mock;
  let mockBeginBatch: jest.Mock;
  let mockEndBatch: jest.Mock;
  let mockIsBatchActive: jest.Mock;
  let mockCancelBatch: jest.Mock;
  let mockUndoOperation: jest.Mock;
  let mockClearUndoStack: jest.Mock;
  let mockGetUndoDepth: jest.Mock;
  let mockWriteFileSync: jest.Mock;
  let mockGetCacheMetrics: jest.Mock;
  let mockGetChangeTracker: jest.Mock;
  let mockGetAccumulatedChanges: jest.Mock;
  let mockSaveFullBundle: jest.Mock;

  beforeEach(async () => {
    process.env = { ...savedEnv };
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com";
    process.env.PLASMIC_AUTH_USER = "test-user";
    process.env.PLASMIC_AUTH_TOKEN = "test-token";

    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.resetModules();

    // Fresh mock function instances for each test
    mockApiClient = {
      listProjects: jest.fn(),
      getProjectBundle: jest.fn(),
      updateProject: jest.fn(),
      saveRevision: jest.fn(),
    };

    mockLoadProject = jest.fn();
    mockSetSession = jest.fn();
    mockRequireSession = jest.fn();
    mockInitChangeTracker = jest.fn();
    mockDisposeChangeTracker = jest.fn();
    mockReadComponentTree = jest.fn();
    mockReadComponentSummary = jest.fn();
    mockReadNodeDetails = jest.fn();
    mockReadSubtree = jest.fn();
    mockCountTreeNodes = jest.fn().mockReturnValue(10);
    mockReadTokens = jest.fn();
    mockResolveNode = jest.fn();
    mockRequireSingleNode = jest.fn();
    mockInvalidateNodeCache = jest.fn();
    mockClearNodeCache = jest.fn();
    mockUpdateText = jest.fn();
    mockUpdateStyles = jest.fn();
    mockAddChild = jest.fn();
    mockRemoveChild = jest.fn();
    mockMoveChild = jest.fn();
    mockListVariants = jest.fn();
    mockRenameComponent = jest.fn();
    mockUpdatePageMeta = jest.fn();
    mockDeleteComponent = jest.fn();
    mockCreateStyleVariant = jest.fn();
    mockCreateVariantGroup = jest.fn();
    mockBeginBatch = jest.fn();
    mockEndBatch = jest.fn();
    mockIsBatchActive = jest.fn().mockReturnValue(false);
    mockCancelBatch = jest.fn();
    mockUndoOperation = jest.fn();
    mockClearUndoStack = jest.fn();
    mockGetUndoDepth = jest.fn().mockReturnValue(0);
    mockWriteFileSync = jest.fn();
    mockGetCacheMetrics = jest.fn().mockReturnValue({
      hits: 0,
      misses: 0,
      hitRate: 0,
      cachedComponents: 0,
    });
    mockGetChangeTracker = jest.fn().mockReturnValue({
      withRecording: jest.fn((fn: any) => { fn(); return { changes: [], newInsts: [], removedInsts: [] }; }),
    });
    mockGetAccumulatedChanges = jest.fn().mockReturnValue(null);
    mockSaveFullBundle = jest.fn().mockResolvedValue({ revisionNum: 99, incremental: false });

    // --- Register module mocks (before require) ---

    jest.mock("mobx", () => ({ configure: jest.fn() }));
    jest.mock("fs", () => ({
      readFileSync: () => { throw new Error("ENOENT"); },
      writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
    }));
    jest.mock("os", () => ({
      homedir: () => "/mock/home",
      tmpdir: () => "/mock/tmp",
    }));

    jest.mock("../api-client", () => ({
      PlasmicApiClient: jest.fn(() => mockApiClient),
      PlasmicApiError: class PlasmicApiError extends Error {
        statusCode: number;
        errorType?: string;
        constructor(message: string, statusCode: number, errorType?: string) {
          super(message);
          this.name = "PlasmicApiError";
          this.statusCode = statusCode;
          this.errorType = errorType;
        }
      },
    }));

    jest.mock("../model-loader", () => ({
      loadProject: (...args: any[]) => mockLoadProject(...args),
    }));

    jest.mock("../session", () => ({
      setSession: (...args: any[]) => mockSetSession(...args),
      requireSession: () => mockRequireSession(),
    }));

    jest.mock("../tree-reader", () => ({
      readComponentTree: (...args: any[]) => mockReadComponentTree(...args),
      readComponentSummary: (...args: any[]) => mockReadComponentSummary(...args),
      readNodeDetails: (...args: any[]) => mockReadNodeDetails(...args),
      readSubtree: (...args: any[]) => mockReadSubtree(...args),
      countTreeNodes: (...args: any[]) => mockCountTreeNodes(...args),
    }));

    jest.mock("../token-reader", () => ({
      readTokens: (...args: any[]) => mockReadTokens(...args),
    }));

    jest.mock("../node-resolver", () => ({
      resolveNode: (...args: any[]) => mockResolveNode(...args),
      requireSingleNode: (...args: any[]) => mockRequireSingleNode(...args),
      invalidateNodeCache: (...args: any[]) => mockInvalidateNodeCache(...args),
      clearNodeCache: () => mockClearNodeCache(),
      getCacheMetrics: () => mockGetCacheMetrics(),
    }));

    jest.mock("../change-tracker", () => ({
      initChangeTracker: (...args: any[]) => mockInitChangeTracker(...args),
      disposeChangeTracker: () => mockDisposeChangeTracker(),
      getChangeTracker: () => mockGetChangeTracker(),
    }));

    jest.mock("../edit-tools", () => ({
      updateText: (...args: any[]) => mockUpdateText(...args),
      updateStyles: (...args: any[]) => mockUpdateStyles(...args),
      addChild: (...args: any[]) => mockAddChild(...args),
      removeChild: (...args: any[]) => mockRemoveChild(...args),
      moveChild: (...args: any[]) => mockMoveChild(...args),
      listVariants: (...args: any[]) => mockListVariants(...args),
      renameComponent: (...args: any[]) => mockRenameComponent(...args),
      updatePageMeta: (...args: any[]) => mockUpdatePageMeta(...args),
      deleteComponent: (...args: any[]) => mockDeleteComponent(...args),
      createStyleVariant: (...args: any[]) => mockCreateStyleVariant(...args),
      createVariantGroup: (...args: any[]) => mockCreateVariantGroup(...args),
    }));

    jest.mock("../batch-manager", () => ({
      beginBatch: () => mockBeginBatch(),
      endBatch: (...args: any[]) => mockEndBatch(...args),
      isBatchActive: () => mockIsBatchActive(),
      cancelBatch: () => mockCancelBatch(),
      getAccumulatedChanges: () => mockGetAccumulatedChanges(),
    }));

    jest.mock("../save-manager", () => ({
      SaveManager: jest.fn(() => ({
        saveFullBundle: (...args: any[]) => mockSaveFullBundle(...args),
        saveChanges: jest.fn(),
      })),
    }));

    jest.mock("../undo-manager", () => ({
      undo: (...args: any[]) => mockUndoOperation(...args),
      clearUndoStack: () => mockClearUndoStack(),
      getUndoDepth: () => mockGetUndoDepth(),
    }));

    // --- Create server and connect transport ---

    const { createServer } = require("../server");
    const mcpServer = createServer();

    const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = require("@modelcontextprotocol/sdk/client/index.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    try { await client?.close(); } catch { /* transport already closed */ }
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  /** Parse JSON from the first text content block, or return raw string */
  function parseResponse(result: any) {
    const text = result.content[0].text;
    try { return JSON.parse(text); } catch { return text; }
  }

  // =====================================================================
  // Session Setup Tools
  // =====================================================================

  describe("set-project", () => {
    it("loads project, stores session, and returns metadata", async () => {
      const mockSite = {
        components: [
          { uuid: "comp-1", name: "Header" },
          { uuid: "page-1", name: "Home", pageMeta: { path: "/" } },
          { uuid: "page-2", name: "About", pageMeta: { path: "/about" } },
        ],
      };

      mockLoadProject.mockResolvedValue({
        site: mockSite,
        bundler: { fake: true },
        projectName: "Test Project",
        revisionNum: 5,
        modelVersion: 1,
        hostlessDataVersion: 0,
      });

      const result = await client.callTool({
        name: "set-project",
        arguments: { projectId: "proj-123" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.projectId).toBe("proj-123");
      expect(output.projectName).toBe("Test Project");
      expect(output.componentCount).toBe(3);
      expect(output.pageCount).toBe(2);

      // Verify wiring: dispose old tracker → clear cache → load → set session → init tracker
      expect(mockDisposeChangeTracker).toHaveBeenCalled();
      expect(mockClearNodeCache).toHaveBeenCalled();
      expect(mockLoadProject).toHaveBeenCalledWith(mockApiClient, "proj-123");
      expect(mockSetSession).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-123",
          projectName: "Test Project",
          site: mockSite,
          revisionNum: 5,
          modelVersion: 1,
          hostlessDataVersion: 0,
        })
      );
      expect(mockInitChangeTracker).toHaveBeenCalledWith(mockSite);
    });

    it("returns error on API failure", async () => {
      mockLoadProject.mockRejectedValue(new Error("Network timeout"));

      const result = await client.callTool({
        name: "set-project",
        arguments: { projectId: "bad-proj" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error loading project");
      expect(result.content[0].text).toContain("Network timeout");
    });
  });

  describe("list-projects", () => {
    it("returns accessible projects from API", async () => {
      mockApiClient.listProjects.mockResolvedValue({
        projects: [
          { id: "p1", name: "Project One" },
          { id: "p2", name: "Project Two" },
        ],
      });

      const result = await client.callTool({
        name: "list-projects",
        arguments: {},
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output).toHaveLength(2);
      expect(output[0]).toEqual({ id: "p1", name: "Project One" });
      expect(output[1]).toEqual({ id: "p2", name: "Project Two" });
    });

    it("returns error on API failure", async () => {
      mockApiClient.listProjects.mockRejectedValue(new Error("Unauthorized"));

      const result = await client.callTool({
        name: "list-projects",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error listing projects");
    });
  });

  // =====================================================================
  // Model Read Tools
  // =====================================================================

  describe("get-project-meta", () => {
    it("returns project metadata with pages, components, and counts", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        projectName: "Test Project",
        site: {
          components: [
            { uuid: "p1", name: "Home", pageMeta: { path: "/" } },
            { uuid: "c1", name: "Header" },
            { uuid: "c2", name: "Footer" },
          ],
          styleTokens: [{ uuid: "t1" }, { uuid: "t2" }],
          globalVariantGroups: [{ uuid: "g1" }],
        },
      });

      const result = await client.callTool({
        name: "get-project-meta",
        arguments: {},
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.projectId).toBe("proj-123");
      expect(output.projectName).toBe("Test Project");
      expect(output.componentCount).toBe(3);
      expect(output.pageCount).toBe(1);
      expect(output.pages).toEqual([
        { uuid: "p1", name: "Home", path: "/" },
      ]);
      expect(output.components).toEqual([
        { uuid: "c1", name: "Header" },
        { uuid: "c2", name: "Footer" },
      ]);
      expect(output.tokenCount).toBe(2);
      expect(output.globalVariantGroupCount).toBe(1);
    });

    it("omits token/variant counts when empty", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        projectName: "Minimal",
        site: {
          components: [],
          styleTokens: [],
          globalVariantGroups: [],
        },
      });

      const result = await client.callTool({
        name: "get-project-meta",
        arguments: {},
      });

      const output = parseResponse(result);
      expect(output.tokenCount).toBeUndefined();
      expect(output.globalVariantGroupCount).toBeUndefined();
    });

    it("returns error when no active project", async () => {
      mockRequireSession.mockImplementation(() => {
        throw new Error("No active project. Use the set-project tool first.");
      });

      const result = await client.callTool({
        name: "get-project-meta",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No active project");
    });
  });

  describe("list-components", () => {
    it("returns pages and components with types", async () => {
      mockRequireSession.mockReturnValue({
        site: {
          components: [
            { uuid: "p1", name: "Home", pageMeta: { path: "/" } },
            { uuid: "c1", name: "Header" },
          ],
        },
      });

      const result = await client.callTool({
        name: "list-components",
        arguments: {},
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output).toEqual([
        { uuid: "p1", name: "Home", type: "page", path: "/" },
        { uuid: "c1", name: "Header", type: "component" },
      ]);
    });
  });

  describe("get-component-tree", () => {
    it("returns component tree for valid UUID", async () => {
      const mockTree = {
        type: "tag",
        tag: "div",
        children: [{ type: "tag", tag: "h1", text: "Hello" }],
      };

      mockRequireSession.mockReturnValue({
        site: {
          components: [
            { uuid: "comp-1", name: "Hero", pageMeta: { path: "/hero" } },
          ],
        },
      });
      mockReadComponentTree.mockReturnValue(mockTree);

      const result = await client.callTool({
        name: "get-component-tree",
        arguments: { componentUuid: "comp-1" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.name).toBe("Hero");
      expect(output.uuid).toBe("comp-1");
      expect(output.path).toBe("/hero");
      expect(output.tree).toEqual(mockTree);
      expect(mockReadComponentTree).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: "comp-1", name: "Hero" })
      );
    });

    it("passes options when optional params provided", async () => {
      mockRequireSession.mockReturnValue({
        site: {
          components: [{ uuid: "comp-1", name: "Hero" }],
        },
      });
      mockReadComponentTree.mockReturnValue({ type: "tag", tag: "div" });

      await client.callTool({
        name: "get-component-tree",
        arguments: {
          componentUuid: "comp-1",
          maxDepth: 2,
          excludeStyles: true,
          summaryOnly: true,
        },
      });

      expect(mockReadComponentTree).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: "comp-1" }),
        expect.objectContaining({
          maxDepth: 2,
          excludeStyles: true,
          summaryOnly: true,
        })
      );
    });

    it("returns error for unknown component UUID", async () => {
      mockRequireSession.mockReturnValue({
        site: { components: [] },
      });

      const result = await client.callTool({
        name: "get-component-tree",
        arguments: { componentUuid: "nonexistent" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
      expect(result.content[0].text).toContain("list-components");
    });
  });

  // =====================================================================
  // M3: Context-Efficient Query Tools
  // =====================================================================

  describe("get-component-summary", () => {
    it("returns compact tree outline via readComponentSummary", async () => {
      const mockSummary = {
        type: "tag",
        tag: "div",
        uuid: "root",
        name: "Root",
        childCount: 2,
        children: [
          { type: "tag", tag: "h1", uuid: "t1", name: "Title", childCount: 0 },
          { type: "tag", tag: "p", uuid: "t2", name: "Body", childCount: 0 },
        ],
      };

      mockRequireSession.mockReturnValue({
        site: {
          components: [
            { uuid: "comp-1", name: "Hero", pageMeta: { path: "/hero" } },
          ],
        },
      });
      mockReadComponentSummary.mockReturnValue(mockSummary);

      const result = await client.callTool({
        name: "get-component-summary",
        arguments: { componentUuid: "comp-1" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.name).toBe("Hero");
      expect(output.uuid).toBe("comp-1");
      expect(output.path).toBe("/hero");
      expect(output.tree).toEqual(mockSummary);
      expect(mockReadComponentSummary).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: "comp-1" }),
        undefined
      );
    });

    it("passes maxDepth parameter", async () => {
      mockRequireSession.mockReturnValue({
        site: {
          components: [{ uuid: "comp-1", name: "Hero" }],
        },
      });
      mockReadComponentSummary.mockReturnValue({ type: "tag", tag: "div" });

      await client.callTool({
        name: "get-component-summary",
        arguments: { componentUuid: "comp-1", maxDepth: 3 },
      });

      expect(mockReadComponentSummary).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: "comp-1" }),
        3
      );
    });

    it("returns error for unknown component UUID", async () => {
      mockRequireSession.mockReturnValue({
        site: { components: [] },
      });

      const result = await client.callTool({
        name: "get-component-summary",
        arguments: { componentUuid: "nonexistent" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("get-node-details", () => {
    it("resolves node and returns full details", async () => {
      const mockNode = { fake: "tpl-node" };
      const mockResolved = {
        node: mockNode,
        uuid: "node-1",
        name: "Hero Title",
        path: "Root.Hero.Hero Title",
        component: {},
      };
      const mockDetails = {
        type: "tag",
        tag: "h1",
        uuid: "node-1",
        name: "Hero Title",
        styles: { fontSize: "48px" },
        text: "Welcome",
        childCount: 0,
      };

      mockRequireSession.mockReturnValue({
        site: {
          components: [{ uuid: "comp-1", name: "Hero" }],
        },
      });
      mockResolveNode.mockReturnValue({
        nodes: [mockResolved],
        isAmbiguous: false,
      });
      mockRequireSingleNode.mockReturnValue(mockResolved);
      mockReadNodeDetails.mockReturnValue(mockDetails);

      const result = await client.callTool({
        name: "get-node-details",
        arguments: { componentUuid: "comp-1", nodeRef: "Hero Title" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.path).toBe("Root.Hero.Hero Title");
      expect(output.name).toBe("Hero Title");
      expect(output.uuid).toBe("node-1");
      expect(output.node).toEqual(mockDetails);
      expect(mockResolveNode).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: "comp-1" }),
        "Hero Title"
      );
      expect(mockReadNodeDetails).toHaveBeenCalledWith(mockNode);
    });

    it("returns error when node not found", async () => {
      mockRequireSession.mockReturnValue({
        site: {
          components: [{ uuid: "comp-1", name: "Hero" }],
        },
      });
      mockResolveNode.mockReturnValue({
        nodes: [],
        isAmbiguous: false,
      });
      mockRequireSingleNode.mockImplementation(() => {
        throw new Error('Node "Missing" not found.');
      });

      const result = await client.callTool({
        name: "get-node-details",
        arguments: { componentUuid: "comp-1", nodeRef: "Missing" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error reading node details");
    });

    it("returns error for unknown component UUID", async () => {
      mockRequireSession.mockReturnValue({
        site: { components: [] },
      });

      const result = await client.callTool({
        name: "get-node-details",
        arguments: { componentUuid: "nonexistent", nodeRef: "Title" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("export-component-tree", () => {
    it("writes full tree to temp file and returns summary", async () => {
      const mockFullTree = {
        type: "tag",
        tag: "div",
        children: [{ type: "tag", tag: "h1" }],
      };
      const mockSummaryTree = {
        type: "tag",
        tag: "div",
        childCount: 1,
      };

      mockRequireSession.mockReturnValue({
        site: {
          components: [
            { uuid: "comp-1", name: "Homepage", pageMeta: { path: "/" } },
          ],
        },
      });
      mockReadComponentTree.mockReturnValue(mockFullTree);
      mockReadComponentSummary.mockReturnValue(mockSummaryTree);
      mockCountTreeNodes.mockReturnValue(2);

      const result = await client.callTool({
        name: "export-component-tree",
        arguments: { componentUuid: "comp-1" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.name).toBe("Homepage");
      expect(output.uuid).toBe("comp-1");
      expect(output.path).toBe("/");
      expect(output.nodeCount).toBe(2);
      expect(output.tree).toEqual(mockSummaryTree);
      // File path uses temp dir + component UUID
      expect(output.filePath).toContain("plasmic-tree-comp-1.json");

      // Verify writeFileSync was called with the full tree
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("plasmic-tree-comp-1.json"),
        expect.stringContaining('"tag": "div"'),
        "utf-8"
      );
    });

    it("returns error for unknown component UUID", async () => {
      mockRequireSession.mockReturnValue({
        site: { components: [] },
      });

      const result = await client.callTool({
        name: "export-component-tree",
        arguments: { componentUuid: "nonexistent" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  // =====================================================================
  // M3: Cache invalidation on structural edits
  // =====================================================================

  describe("cache invalidation", () => {
    it("add-child invalidates node cache for the component", async () => {
      mockAddChild.mockResolvedValue({
        save: { revisionNum: 8, incremental: true },
        parentName: "Container",
        parentUuid: "node-3",
        position: "last",
      });

      await client.callTool({
        name: "add-child",
        arguments: {
          componentUuid: "comp-1",
          parentRef: "Container",
          child: { type: "text", value: "Hello" },
        },
      });

      expect(mockInvalidateNodeCache).toHaveBeenCalledWith("comp-1");
    });

    it("remove-child invalidates node cache for the component", async () => {
      mockRemoveChild.mockResolvedValue({
        save: { revisionNum: 9, incremental: true },
        removedName: "OldSection",
        removedUuid: "node-4",
      });

      await client.callTool({
        name: "remove-child",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "OldSection",
        },
      });

      expect(mockInvalidateNodeCache).toHaveBeenCalledWith("comp-1");
    });

    it("move-child invalidates node cache for the component", async () => {
      mockMoveChild.mockResolvedValue({
        save: { revisionNum: 10, incremental: true },
        movedName: "Title",
        movedUuid: "node-5",
        newParentName: "Hero",
        newParentUuid: "node-6",
        position: 0,
      });

      await client.callTool({
        name: "move-child",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "Title",
          newParentRef: "Hero",
        },
      });

      expect(mockInvalidateNodeCache).toHaveBeenCalledWith("comp-1");
    });

    it("refresh-project clears entire node cache", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
      });
      mockLoadProject.mockResolvedValue({
        site: { components: [] },
        bundler: {},
        projectName: "Test",
        revisionNum: 15,
        modelVersion: 3,
        hostlessDataVersion: 1,
      });

      await client.callTool({
        name: "refresh-project",
        arguments: {},
      });

      expect(mockClearNodeCache).toHaveBeenCalled();
    });

    it("set-project clears entire node cache", async () => {
      mockLoadProject.mockResolvedValue({
        site: { components: [] },
        bundler: {},
        projectName: "New Project",
        revisionNum: 1,
        modelVersion: 1,
        hostlessDataVersion: 0,
      });

      await client.callTool({
        name: "set-project",
        arguments: { projectId: "new-proj" },
      });

      expect(mockClearNodeCache).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // Remaining existing tools (tokens, create-page, edits, batch, undo)
  // =====================================================================

  describe("get-tokens", () => {
    it("returns all tokens when no filter specified", async () => {
      const tokenResult = {
        tokenCount: 3,
        tokens: {
          Color: [{ uuid: "t1", name: "Primary", type: "Color", value: "#ff0000" }],
          Spacing: [{ uuid: "t2", name: "SM", type: "Spacing", value: "8px" }],
        },
      };

      mockRequireSession.mockReturnValue({
        site: { styleTokens: [{ uuid: "t1" }, { uuid: "t2" }] },
      });
      mockReadTokens.mockReturnValue(tokenResult);

      const result = await client.callTool({
        name: "get-tokens",
        arguments: {},
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.tokenCount).toBe(3);
      expect(output.tokens.Color).toHaveLength(1);
      expect(mockReadTokens).toHaveBeenCalledWith(
        [{ uuid: "t1" }, { uuid: "t2" }],
        undefined
      );
    });

    it("passes type filter to readTokens", async () => {
      mockRequireSession.mockReturnValue({
        site: { styleTokens: [{ uuid: "t1" }] },
      });
      mockReadTokens.mockReturnValue({ tokenCount: 1, tokens: {} });

      await client.callTool({
        name: "get-tokens",
        arguments: { type: "Color" },
      });

      expect(mockReadTokens).toHaveBeenCalledWith([{ uuid: "t1" }], "Color");
    });
  });

  describe("create-page", () => {
    it("creates page via API and returns UUID from API response", async () => {
      const newSite = {
        components: [
          { uuid: "new-page", name: "Products", pageMeta: { path: "/products" } },
        ],
      };

      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        projectName: "Test Project",
      });
      mockApiClient.updateProject.mockResolvedValue({
        result: { newComponents: [{ uuid: "api-page-uuid", name: "Products", path: "/products" }] },
      });
      mockLoadProject.mockResolvedValue({
        site: newSite,
        bundler: {},
        projectName: "Test Project",
        revisionNum: 6,
        modelVersion: 2,
        hostlessDataVersion: 0,
      });

      const body = { type: "vbox", children: [{ type: "text", value: "Hello" }] };

      const result = await client.callTool({
        name: "create-page",
        arguments: { name: "Products", path: "/products", body },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.name).toBe("Products");
      expect(output.path).toBe("/products");
      expect(output.uuid).toBe("api-page-uuid");

      // Verify API call
      expect(mockApiClient.updateProject).toHaveBeenCalledWith("proj-123", {
        newComponents: [{ name: "Products", path: "/products", body }],
      });

      // Verify model reload sequence includes cache clear
      expect(mockDisposeChangeTracker).toHaveBeenCalled();
      expect(mockClearNodeCache).toHaveBeenCalled();
      expect(mockLoadProject).toHaveBeenCalledWith(mockApiClient, "proj-123");
      expect(mockSetSession).toHaveBeenCalled();
      expect(mockInitChangeTracker).toHaveBeenCalledWith(newSite);
    });

    it("falls back to model lookup when API response has no UUID", async () => {
      const newSite = {
        components: [
          { uuid: "model-page-uuid", name: "Products", pageMeta: { path: "/products" } },
        ],
      };

      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        projectName: "Test Project",
      });
      mockApiClient.updateProject.mockResolvedValue({});
      mockLoadProject.mockResolvedValue({
        site: newSite,
        bundler: {},
        projectName: "Test Project",
        revisionNum: 6,
        modelVersion: 2,
        hostlessDataVersion: 0,
      });

      const result = await client.callTool({
        name: "create-page",
        arguments: { name: "Products", path: "/products", body: {} },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.uuid).toBe("model-page-uuid");
    });

    it("returns null uuid when model reload fails and API has no UUID", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        projectName: "Test Project",
      });
      mockApiClient.updateProject.mockResolvedValue({});
      mockLoadProject.mockRejectedValue(new Error("Reload failed"));

      const result = await client.callTool({
        name: "create-page",
        arguments: { name: "Test", path: "/test", body: {} },
      });

      // Should succeed — reload failure is swallowed
      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.uuid).toBeNull();
    });

    it("returns error when API call fails", async () => {
      mockRequireSession.mockReturnValue({ projectId: "proj-123" });
      mockApiClient.updateProject.mockRejectedValue(new Error("Bad request"));

      const result = await client.callTool({
        name: "create-page",
        arguments: { name: "Test", path: "/test", body: {} },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error creating page");
    });
  });

  describe("create-component", () => {
    it("creates component via API and returns UUID from API response", async () => {
      const newSite = {
        components: [
          { uuid: "new-comp", name: "HeroSection" },
        ],
      };

      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        projectName: "Test Project",
      });
      mockApiClient.updateProject.mockResolvedValue({
        result: { newComponents: [{ uuid: "api-comp-uuid", name: "HeroSection" }] },
      });
      mockLoadProject.mockResolvedValue({
        site: newSite,
        bundler: {},
        projectName: "Test Project",
        revisionNum: 6,
        modelVersion: 2,
        hostlessDataVersion: 0,
      });

      const body = { type: "vbox", children: [{ type: "text", value: "Hero" }] };

      const result = await client.callTool({
        name: "create-component",
        arguments: { name: "HeroSection", body },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.name).toBe("HeroSection");
      expect(output.uuid).toBe("api-comp-uuid");

      // Verify API call — no path (component, not page)
      expect(mockApiClient.updateProject).toHaveBeenCalledWith("proj-123", {
        newComponents: [{ name: "HeroSection", body }],
      });

      // Verify model reload
      expect(mockDisposeChangeTracker).toHaveBeenCalled();
      expect(mockClearNodeCache).toHaveBeenCalled();
      expect(mockLoadProject).toHaveBeenCalledWith(mockApiClient, "proj-123");
      expect(mockSetSession).toHaveBeenCalled();
      expect(mockInitChangeTracker).toHaveBeenCalledWith(newSite);
    });

    it("falls back to model lookup when API response has no UUID", async () => {
      const newSite = {
        components: [
          { uuid: "model-comp-uuid", name: "HeroSection" },
        ],
      };

      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        projectName: "Test Project",
      });
      mockApiClient.updateProject.mockResolvedValue({});
      mockLoadProject.mockResolvedValue({
        site: newSite,
        bundler: {},
        projectName: "Test Project",
        revisionNum: 6,
        modelVersion: 2,
        hostlessDataVersion: 0,
      });

      const result = await client.callTool({
        name: "create-component",
        arguments: { name: "HeroSection", body: {} },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.uuid).toBe("model-comp-uuid");
    });

    it("returns null uuid when model reload fails and API has no UUID", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        projectName: "Test Project",
      });
      mockApiClient.updateProject.mockResolvedValue({});
      mockLoadProject.mockRejectedValue(new Error("Reload failed"));

      const result = await client.callTool({
        name: "create-component",
        arguments: { name: "Test", body: {} },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.uuid).toBeNull();
    });

    it("returns error when API call fails", async () => {
      mockRequireSession.mockReturnValue({ projectId: "proj-123" });
      mockApiClient.updateProject.mockRejectedValue(new Error("Bad request"));

      const result = await client.callTool({
        name: "create-component",
        arguments: { name: "Test", body: {} },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error creating component");
    });
  });

  describe("clone-component", () => {
    it("clones component via API and returns UUID from API response", async () => {
      const newSite = {
        components: [
          { uuid: "orig-comp", name: "Original" },
          { uuid: "cloned-comp", name: "OriginalCopy" },
        ],
      };

      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        site: {
          components: [
            { uuid: "orig-comp", name: "Original" },
          ],
        },
      });
      mockApiClient.updateProject.mockResolvedValue({
        result: { newComponents: [{ uuid: "api-clone-uuid", name: "OriginalCopy" }] },
      });
      mockLoadProject.mockResolvedValue({
        site: newSite,
        bundler: {},
        projectName: "Test Project",
        revisionNum: 7,
        modelVersion: 2,
        hostlessDataVersion: 0,
      });

      const result = await client.callTool({
        name: "clone-component",
        arguments: { sourceUuid: "orig-comp", name: "OriginalCopy" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.name).toBe("OriginalCopy");
      expect(output.uuid).toBe("api-clone-uuid");
      expect(output.clonedFrom).toBe("Original");
      expect(output.clonedFromUuid).toBe("orig-comp");

      // Verify API call uses cloneFrom with uuid
      expect(mockApiClient.updateProject).toHaveBeenCalledWith("proj-123", {
        newComponents: [{ name: "OriginalCopy", cloneFrom: { uuid: "orig-comp" } }],
      });

      // Verify model reload
      expect(mockDisposeChangeTracker).toHaveBeenCalled();
      expect(mockClearNodeCache).toHaveBeenCalled();
    });

    it("falls back to model lookup when API response has no UUID", async () => {
      const newSite = {
        components: [
          { uuid: "orig-comp", name: "Original" },
          { uuid: "model-clone-uuid", name: "OriginalCopy" },
        ],
      };

      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        site: {
          components: [
            { uuid: "orig-comp", name: "Original" },
          ],
        },
      });
      mockApiClient.updateProject.mockResolvedValue({});
      mockLoadProject.mockResolvedValue({
        site: newSite,
        bundler: {},
        projectName: "Test Project",
        revisionNum: 7,
        modelVersion: 2,
        hostlessDataVersion: 0,
      });

      const result = await client.callTool({
        name: "clone-component",
        arguments: { sourceUuid: "orig-comp", name: "OriginalCopy" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.uuid).toBe("model-clone-uuid");
    });

    it("clones as a page when path is provided", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        site: {
          components: [
            { uuid: "page-1", name: "Homepage", pageMeta: { path: "/" } },
          ],
        },
      });
      mockApiClient.updateProject.mockResolvedValue({
        result: { newComponents: [{ uuid: "api-page-clone-uuid", name: "HomepageV2", path: "/v2" }] },
      });
      mockLoadProject.mockResolvedValue({
        site: { components: [{ uuid: "api-page-clone-uuid", name: "HomepageV2", pageMeta: { path: "/v2" } }] },
        bundler: {},
        projectName: "Test",
        revisionNum: 8,
        modelVersion: 2,
        hostlessDataVersion: 0,
      });

      const result = await client.callTool({
        name: "clone-component",
        arguments: {
          sourceUuid: "page-1",
          name: "HomepageV2",
          path: "/v2",
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.path).toBe("/v2");
      expect(output.uuid).toBe("api-page-clone-uuid");

      expect(mockApiClient.updateProject).toHaveBeenCalledWith("proj-123", {
        newComponents: [{
          name: "HomepageV2",
          cloneFrom: { uuid: "page-1" },
          path: "/v2",
        }],
      });
    });

    it("returns error when source UUID not found", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        site: {
          components: [],
        },
      });

      const result = await client.callTool({
        name: "clone-component",
        arguments: { sourceUuid: "nonexistent", name: "Clone" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
      expect(result.content[0].text).toContain("list-components");
    });

    it("returns error when API call fails", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        site: {
          components: [
            { uuid: "comp-1", name: "Source" },
          ],
        },
      });
      mockApiClient.updateProject.mockRejectedValue(new Error("Server error"));

      const result = await client.callTool({
        name: "clone-component",
        arguments: { sourceUuid: "comp-1", name: "Clone" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error cloning component");
    });
  });

  describe("update-text", () => {
    it("delegates to updateText and returns structured result", async () => {
      mockUpdateText.mockResolvedValue({
        save: { revisionNum: 6, incremental: true },
        nodeName: "Title",
        nodeUuid: "node-1",
        previousText: "Old text",
        newText: "New text",
      });

      const result = await client.callTool({
        name: "update-text",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "Title",
          text: "New text",
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.node).toBe("Title");
      expect(output.previousText).toBe("Old text");
      expect(output.newText).toBe("New text");
      expect(output.revision).toBe(6);

      expect(mockUpdateText).toHaveBeenCalledWith(
        mockApiClient, "comp-1", "Title", "New text", undefined
      );
    });

    it("falls back to nodeUuid when nodeName is absent", async () => {
      mockUpdateText.mockResolvedValue({
        save: { revisionNum: 7, incremental: true },
        nodeName: undefined,
        nodeUuid: "uuid-abc",
        newText: "Updated",
      });

      const result = await client.callTool({
        name: "update-text",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "uuid-abc",
          text: "Updated",
        },
      });

      const output = parseResponse(result);
      expect(output.node).toBe("uuid-abc");
    });

    it("returns error when edit fails", async () => {
      mockUpdateText.mockRejectedValue(
        new Error('Node "Missing" not found.')
      );

      const result = await client.callTool({
        name: "update-text",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "Missing",
          text: "text",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error updating text");
    });
  });

  describe("update-styles", () => {
    it("delegates to updateStyles and returns updated properties", async () => {
      mockUpdateStyles.mockResolvedValue({
        save: { revisionNum: 7, incremental: true },
        nodeName: "Hero",
        nodeUuid: "node-2",
        updatedProperties: ["fontSize", "color"],
      });

      const result = await client.callTool({
        name: "update-styles",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "Hero",
          styles: { fontSize: "24px", color: "#ff0000" },
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.node).toBe("Hero");
      expect(output.updatedProperties).toEqual(["fontSize", "color"]);
      expect(output.revision).toBe(7);
    });

    it("returns error when edit fails", async () => {
      mockUpdateStyles.mockRejectedValue(
        new Error("Node is not a TplTag")
      );

      const result = await client.callTool({
        name: "update-styles",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "slot-node",
          styles: { color: "red" },
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error updating styles");
    });
  });

  describe("add-child", () => {
    it("delegates to addChild with default position", async () => {
      mockAddChild.mockResolvedValue({
        save: { revisionNum: 8, incremental: true },
        parentName: "Container",
        parentUuid: "node-3",
        newNodeUuid: "new-1",
        position: "last",
      });

      const childElement = { type: "text", value: "New paragraph" };

      const result = await client.callTool({
        name: "add-child",
        arguments: {
          componentUuid: "comp-1",
          parentRef: "Container",
          child: childElement,
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.parent).toBe("Container");
      expect(output.position).toBe("last");
      expect(output.revision).toBe(8);

      expect(mockAddChild).toHaveBeenCalledWith(
        mockApiClient, "comp-1", "Container", childElement, undefined
      );
    });

    it("passes position parameter when specified", async () => {
      mockAddChild.mockResolvedValue({
        save: { revisionNum: 8, incremental: true },
        parentName: "Container",
        parentUuid: "node-3",
        position: "first",
      });

      await client.callTool({
        name: "add-child",
        arguments: {
          componentUuid: "comp-1",
          parentRef: "Container",
          child: { type: "text", value: "First" },
          position: "first",
        },
      });

      expect(mockAddChild).toHaveBeenCalledWith(
        mockApiClient, "comp-1", "Container",
        { type: "text", value: "First" }, "first"
      );
    });
  });

  describe("remove-child", () => {
    it("delegates to removeChild and returns removed node info", async () => {
      mockRemoveChild.mockResolvedValue({
        save: { revisionNum: 9, incremental: true },
        removedName: "OldSection",
        removedUuid: "node-4",
      });

      const result = await client.callTool({
        name: "remove-child",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "OldSection",
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.removed).toBe("OldSection");
      expect(output.revision).toBe(9);

      expect(mockRemoveChild).toHaveBeenCalledWith(
        mockApiClient, "comp-1", "OldSection"
      );
    });
  });

  describe("move-child", () => {
    it("delegates to moveChild and returns result", async () => {
      mockMoveChild.mockResolvedValue({
        save: { revisionNum: 10, incremental: true },
        movedName: "Title",
        movedUuid: "node-5",
        newParentName: "Hero",
        newParentUuid: "node-6",
        position: 0,
      });

      const result = await client.callTool({
        name: "move-child",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "Title",
          newParentRef: "Hero",
          position: 0,
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.moved).toBe("Title");
      expect(output.newParent).toBe("Hero");
      expect(output.position).toBe(0);
      expect(output.revision).toBe(10);

      expect(mockMoveChild).toHaveBeenCalledWith(
        mockApiClient, "comp-1", "Title", "Hero", 0
      );
    });

    it("returns error on cycle detection", async () => {
      mockMoveChild.mockRejectedValue(
        new Error('Cannot move "Parent" into its own descendant "Child".')
      );

      const result = await client.callTool({
        name: "move-child",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "Parent",
          newParentRef: "Child",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error moving child");
    });
  });

  // =====================================================================
  // Batch / Workflow Tools
  // =====================================================================

  describe("begin-batch", () => {
    it("starts batch session and returns batch ID", async () => {
      mockRequireSession.mockReturnValue({ projectId: "proj-123" });
      mockBeginBatch.mockReturnValue("batch-uuid-123");

      const result = await client.callTool({
        name: "begin-batch",
        arguments: {},
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.batchId).toBe("batch-uuid-123");
      expect(output.message).toContain("Batch session started");
    });

    it("returns error when batch already active", async () => {
      mockRequireSession.mockReturnValue({ projectId: "proj-123" });
      mockBeginBatch.mockImplementation(() => {
        throw new Error("A batch session is already active.");
      });

      const result = await client.callTool({
        name: "begin-batch",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("already active");
    });
  });

  describe("end-batch", () => {
    it("saves accumulated changes and returns operation count", async () => {
      mockEndBatch.mockResolvedValue({
        save: { revisionNum: 11, incremental: true },
        operationCount: 3,
      });

      const result = await client.callTool({
        name: "end-batch",
        arguments: { batchId: "batch-123" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.operationCount).toBe(3);
      expect(output.revision).toBe(11);
      expect(output.message).toContain("3 operations");

      expect(mockEndBatch).toHaveBeenCalledWith(mockApiClient, "batch-123");
    });

    it("works without batchId parameter", async () => {
      mockEndBatch.mockResolvedValue({
        save: { revisionNum: 11, incremental: true },
        operationCount: 2,
      });

      await client.callTool({
        name: "end-batch",
        arguments: {},
      });

      expect(mockEndBatch).toHaveBeenCalledWith(mockApiClient, undefined);
    });
  });

  describe("undo", () => {
    it("undoes last operation and returns result", async () => {
      mockIsBatchActive.mockReturnValue(false);
      mockUndoOperation.mockResolvedValue({
        save: { revisionNum: 12, incremental: true },
        undone: 'update-text: "Hello" on Title',
      });
      mockGetUndoDepth.mockReturnValue(2);

      const result = await client.callTool({
        name: "undo",
        arguments: {},
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.undone).toBe('update-text: "Hello" on Title');
      expect(output.revision).toBe(12);
      expect(output.remainingUndos).toBe(2);

      expect(mockUndoOperation).toHaveBeenCalledWith(mockApiClient);
    });

    it("blocks undo during active batch session", async () => {
      mockIsBatchActive.mockReturnValue(true);

      const result = await client.callTool({
        name: "undo",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot undo during a batch");
      expect(result.content[0].text).toContain("end-batch");
      // undo should NOT have been called
      expect(mockUndoOperation).not.toHaveBeenCalled();
    });

    it("returns error when nothing to undo", async () => {
      mockIsBatchActive.mockReturnValue(false);
      mockUndoOperation.mockRejectedValue(new Error("Nothing to undo."));

      const result = await client.callTool({
        name: "undo",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Nothing to undo");
    });
  });

  // =====================================================================
  // get-subtree tool
  // =====================================================================

  describe("get-subtree", () => {
    it("resolves node and returns subtree via readSubtree", async () => {
      const mockNode = { fake: "tpl-node" };
      const mockResolved = {
        node: mockNode,
        uuid: "hero-uuid",
        name: "Hero",
        path: "Root.Hero",
        component: {},
      };
      const mockTree = {
        type: "tag",
        tag: "section",
        name: "Hero",
        children: [
          { type: "tag", tag: "h1", name: "Title" },
        ],
      };

      mockRequireSession.mockReturnValue({
        site: {
          components: [
            { uuid: "comp-1", name: "Homepage", pageMeta: { path: "/" } },
          ],
        },
      });
      mockResolveNode.mockReturnValue({
        nodes: [mockResolved],
        isAmbiguous: false,
      });
      mockRequireSingleNode.mockReturnValue(mockResolved);
      mockReadSubtree.mockReturnValue(mockTree);
      mockCountTreeNodes.mockReturnValue(2);

      const result = await client.callTool({
        name: "get-subtree",
        arguments: { componentUuid: "comp-1", nodeRef: "Hero" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.component).toBe("Homepage");
      expect(output.componentUuid).toBe("comp-1");
      expect(output.subtreeRoot).toBe("Hero");
      expect(output.path).toBe("Root.Hero");
      expect(output.nodeCount).toBe(2);
      expect(output.tree).toEqual(mockTree);
      expect(mockReadSubtree).toHaveBeenCalledWith(mockNode, undefined);
    });

    it("passes maxDepth option when specified", async () => {
      const mockResolved = {
        node: {},
        uuid: "root-uuid",
        name: "Root",
        path: "Root",
        component: {},
      };

      mockRequireSession.mockReturnValue({
        site: {
          components: [{ uuid: "comp-1", name: "Homepage" }],
        },
      });
      mockResolveNode.mockReturnValue({ nodes: [mockResolved], isAmbiguous: false });
      mockRequireSingleNode.mockReturnValue(mockResolved);
      mockReadSubtree.mockReturnValue({ type: "tag", tag: "div" });
      mockCountTreeNodes.mockReturnValue(1);

      await client.callTool({
        name: "get-subtree",
        arguments: { componentUuid: "comp-1", nodeRef: "Root", maxDepth: 1 },
      });

      expect(mockReadSubtree).toHaveBeenCalledWith({}, { maxDepth: 1 });
    });

    it("passes excludeStyles option when specified", async () => {
      const mockResolved = {
        node: {},
        uuid: "root-uuid",
        name: "Root",
        path: "Root",
        component: {},
      };

      mockRequireSession.mockReturnValue({
        site: {
          components: [{ uuid: "comp-1", name: "Homepage" }],
        },
      });
      mockResolveNode.mockReturnValue({ nodes: [mockResolved], isAmbiguous: false });
      mockRequireSingleNode.mockReturnValue(mockResolved);
      mockReadSubtree.mockReturnValue({ type: "tag", tag: "div" });
      mockCountTreeNodes.mockReturnValue(1);

      await client.callTool({
        name: "get-subtree",
        arguments: { componentUuid: "comp-1", nodeRef: "Root", excludeStyles: true },
      });

      expect(mockReadSubtree).toHaveBeenCalledWith({}, { excludeStyles: true });
    });

    it("passes both maxDepth and excludeStyles when both specified", async () => {
      const mockResolved = {
        node: {},
        uuid: "root-uuid",
        name: "Root",
        path: "Root",
        component: {},
      };

      mockRequireSession.mockReturnValue({
        site: {
          components: [{ uuid: "comp-1", name: "Homepage" }],
        },
      });
      mockResolveNode.mockReturnValue({ nodes: [mockResolved], isAmbiguous: false });
      mockRequireSingleNode.mockReturnValue(mockResolved);
      mockReadSubtree.mockReturnValue({ type: "tag", tag: "div" });
      mockCountTreeNodes.mockReturnValue(1);

      await client.callTool({
        name: "get-subtree",
        arguments: { componentUuid: "comp-1", nodeRef: "Root", maxDepth: 2, excludeStyles: true },
      });

      expect(mockReadSubtree).toHaveBeenCalledWith({}, { maxDepth: 2, excludeStyles: true });
    });

    it("returns error for unknown component UUID", async () => {
      mockRequireSession.mockReturnValue({
        site: { components: [] },
      });

      const result = await client.callTool({
        name: "get-subtree",
        arguments: { componentUuid: "nonexistent", nodeRef: "Hero" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("returns error when node not found", async () => {
      mockRequireSession.mockReturnValue({
        site: {
          components: [{ uuid: "comp-1", name: "Homepage" }],
        },
      });
      mockResolveNode.mockReturnValue({ nodes: [], isAmbiguous: false });
      mockRequireSingleNode.mockImplementation(() => {
        throw new Error('Node "Missing" not found.');
      });

      const result = await client.callTool({
        name: "get-subtree",
        arguments: { componentUuid: "comp-1", nodeRef: "Missing" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error reading subtree");
    });
  });

  // =====================================================================
  // Zod validation for create/clone tools
  // =====================================================================

  describe("Zod validation", () => {
    it("create-component rejects empty name", async () => {
      const result = await client.callTool({
        name: "create-component",
        arguments: { name: "", body: { type: "vbox" } },
      });

      expect(result.isError).toBe(true);
    });

    it("clone-component rejects empty name", async () => {
      const result = await client.callTool({
        name: "clone-component",
        arguments: { sourceUuid: "some-uuid", name: "" },
      });

      expect(result.isError).toBe(true);
    });

    it("clone-component rejects empty sourceUuid", async () => {
      const result = await client.callTool({
        name: "clone-component",
        arguments: { sourceUuid: "", name: "CloneName" },
      });

      expect(result.isError).toBe(true);
    });
  });

  // =====================================================================
  // save-project tool
  // =====================================================================

  describe("save-project", () => {
    it("performs a full save and returns revision info", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        revisionNum: 10,
      });

      const result = await client.callTool({
        name: "save-project",
        arguments: {},
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.revision).toBe(99);
      expect(output.incremental).toBe(false);
      expect(output.message).toContain("Full save completed");
      expect(mockSaveFullBundle).toHaveBeenCalled();
    });

    it("returns error when no active project", async () => {
      mockRequireSession.mockImplementation(() => {
        throw new Error("No active project.");
      });

      const result = await client.callTool({
        name: "save-project",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error saving project");
    });

    it("returns error when save fails", async () => {
      mockRequireSession.mockReturnValue({ projectId: "proj-123" });
      mockSaveFullBundle.mockRejectedValue(new Error("Site invariant violation"));

      const result = await client.callTool({
        name: "save-project",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Site invariant violation");
    });
  });

  // =====================================================================
  // Dry-run mode
  // =====================================================================

  describe("dry-run mode", () => {
    it("update-text with dryRun returns preview without saving", async () => {
      mockIsBatchActive.mockReturnValue(false);
      mockBeginBatch.mockReturnValue("dry-run-batch");
      mockGetAccumulatedChanges.mockReturnValue({
        changes: [{ changeNode: {} }],
        newInsts: [],
        removedInsts: [],
      });
      mockUpdateText.mockResolvedValue({
        save: { revisionNum: 10, incremental: true },
        nodeName: "Title",
        nodeUuid: "node-1",
        previousText: "Old",
        newText: "New",
      });

      const result = await client.callTool({
        name: "update-text",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "Title",
          text: "New",
          dryRun: true,
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.dryRun).toBe(true);
      expect(output.node).toBe("Title");
      expect(output.previousText).toBe("Old");
      expect(output.newText).toBe("New");
      expect(output.message).toContain("Dry run");
      // Verify batch was used to suppress saves
      expect(mockBeginBatch).toHaveBeenCalled();
      expect(mockCancelBatch).toHaveBeenCalled();
    });

    it("update-styles with dryRun returns preview without saving", async () => {
      mockIsBatchActive.mockReturnValue(false);
      mockBeginBatch.mockReturnValue("dry-run-batch");
      mockGetAccumulatedChanges.mockReturnValue({
        changes: [],
        newInsts: [],
        removedInsts: [],
      });
      mockUpdateStyles.mockResolvedValue({
        save: { revisionNum: 10, incremental: true },
        nodeName: "Hero",
        nodeUuid: "node-2",
        updatedProperties: ["fontSize", "color"],
      });

      const result = await client.callTool({
        name: "update-styles",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "Hero",
          styles: { fontSize: "24px", color: "#ff0000" },
          dryRun: true,
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.dryRun).toBe(true);
      expect(output.node).toBe("Hero");
      expect(output.updatedProperties).toEqual(["fontSize", "color"]);
    });

    it("add-child with dryRun does not invalidate node cache", async () => {
      mockIsBatchActive.mockReturnValue(false);
      mockBeginBatch.mockReturnValue("dry-run-batch");
      mockGetAccumulatedChanges.mockReturnValue({
        changes: [],
        newInsts: [],
        removedInsts: [],
      });
      mockAddChild.mockResolvedValue({
        save: { revisionNum: 10, incremental: true },
        parentName: "Container",
        parentUuid: "node-3",
        position: "last",
      });

      const result = await client.callTool({
        name: "add-child",
        arguments: {
          componentUuid: "comp-1",
          parentRef: "Container",
          child: { type: "text", value: "Test" },
          dryRun: true,
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.dryRun).toBe(true);
      // Cache should NOT be invalidated in dry-run mode
      expect(mockInvalidateNodeCache).not.toHaveBeenCalled();
    });

    it("dry-run rejects when batch is already active", async () => {
      mockIsBatchActive.mockReturnValue(true);

      const result = await client.callTool({
        name: "update-text",
        arguments: {
          componentUuid: "comp-1",
          nodeRef: "Title",
          text: "New",
          dryRun: true,
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot use dry-run during an active batch");
    });
  });

  // =====================================================================
  // Cache metrics in get-node-details
  // =====================================================================

  describe("cache metrics", () => {
    it("get-node-details includes cache metrics in response", async () => {
      mockGetCacheMetrics.mockReturnValue({
        hits: 5,
        misses: 2,
        hitRate: 71,
        cachedComponents: 3,
      });

      const mockNode = { fake: "tpl-node" };
      const mockResolved = {
        node: mockNode,
        uuid: "node-1",
        name: "Title",
        path: "Root.Title",
        component: {},
      };

      mockRequireSession.mockReturnValue({
        site: {
          components: [{ uuid: "comp-1", name: "Hero" }],
        },
      });
      mockResolveNode.mockReturnValue({ nodes: [mockResolved], isAmbiguous: false });
      mockRequireSingleNode.mockReturnValue(mockResolved);
      mockReadNodeDetails.mockReturnValue({ type: "tag", tag: "h1" });

      const result = await client.callTool({
        name: "get-node-details",
        arguments: { componentUuid: "comp-1", nodeRef: "Title" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output._cache).toEqual({
        hits: 5,
        misses: 2,
        hitRate: 71,
        cachedComponents: 3,
      });
    });
  });

  // =====================================================================
  // Management Tools
  // =====================================================================

  describe("rename-component", () => {
    it("renames a component and returns old/new names", async () => {
      mockRenameComponent.mockResolvedValue({
        save: { revisionNum: 11, incremental: true },
        oldName: "HomePage",
        newName: "LandingPage",
        componentUuid: "comp-1",
        newPath: undefined,
      });

      const result = await client.callTool({
        name: "rename-component",
        arguments: { componentUuid: "comp-1", newName: "LandingPage" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.oldName).toBe("HomePage");
      expect(output.newName).toBe("LandingPage");
      expect(output.uuid).toBe("comp-1");
      expect(output.message).toContain("Renamed");
      expect(mockRenameComponent).toHaveBeenCalledWith(
        mockApiClient,
        "comp-1",
        "LandingPage",
        undefined
      );
    });

    it("renames a page with new path", async () => {
      mockRenameComponent.mockResolvedValue({
        save: { revisionNum: 12, incremental: true },
        oldName: "HomePage",
        newName: "LandingPage",
        componentUuid: "page-1",
        newPath: "/landing",
      });

      const result = await client.callTool({
        name: "rename-component",
        arguments: {
          componentUuid: "page-1",
          newName: "LandingPage",
          newPath: "/landing",
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.path).toBe("/landing");
      expect(mockRenameComponent).toHaveBeenCalledWith(
        mockApiClient,
        "page-1",
        "LandingPage",
        "/landing"
      );
    });

    it("returns error when component not found", async () => {
      mockRenameComponent.mockRejectedValue(
        new Error('Component UUID "nonexistent" not found.')
      );

      const result = await client.callTool({
        name: "rename-component",
        arguments: { componentUuid: "nonexistent", newName: "Foo" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error renaming component");
    });

    it("rejects empty name via Zod validation", async () => {
      const result = await client.callTool({
        name: "rename-component",
        arguments: { componentUuid: "comp-1", newName: "" },
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("update-page-meta", () => {
    it("updates page metadata fields and returns updated list", async () => {
      mockUpdatePageMeta.mockResolvedValue({
        save: { revisionNum: 13, incremental: true },
        componentUuid: "page-1",
        componentName: "HomePage",
        updatedFields: ["title", "description"],
      });

      const result = await client.callTool({
        name: "update-page-meta",
        arguments: {
          componentUuid: "page-1",
          title: "Welcome to My Site",
          description: "A great landing page",
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.component).toBe("HomePage");
      expect(output.updatedFields).toEqual(["title", "description"]);
      expect(output.message).toContain("title, description");
      expect(mockUpdatePageMeta).toHaveBeenCalledWith(
        mockApiClient,
        "page-1",
        {
          title: "Welcome to My Site",
          description: "A great landing page",
          openGraphImage: undefined,
          canonical: undefined,
          path: undefined,
        }
      );
    });

    it("updates all metadata fields at once", async () => {
      mockUpdatePageMeta.mockResolvedValue({
        save: { revisionNum: 14, incremental: true },
        componentUuid: "page-1",
        componentName: "HomePage",
        updatedFields: ["title", "description", "openGraphImage", "canonical", "path"],
      });

      const result = await client.callTool({
        name: "update-page-meta",
        arguments: {
          componentUuid: "page-1",
          title: "Welcome",
          description: "Landing page",
          openGraphImage: "https://example.com/og.png",
          canonical: "https://example.com/",
          path: "/welcome",
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.updatedFields).toHaveLength(5);
    });

    it("returns error when component is not a page", async () => {
      mockUpdatePageMeta.mockRejectedValue(
        new Error('Component "Header" is not a page — no page metadata to update.')
      );

      const result = await client.callTool({
        name: "update-page-meta",
        arguments: {
          componentUuid: "comp-header",
          title: "Should Fail",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not a page");
    });
  });

  describe("get-page-meta", () => {
    it("returns page metadata for a page component", async () => {
      mockRequireSession.mockReturnValue({
        site: {
          components: [
            {
              uuid: "page-1",
              name: "HomePage",
              pageMeta: {
                path: "/",
                title: "Welcome to My Site",
                description: "A description for SEO",
                openGraphImage: "https://example.com/og.png",
                canonical: "https://example.com/",
                params: { slug: "string" },
                query: {},
                roleId: null,
              },
            },
          ],
        },
      });

      const result = await client.callTool({
        name: "get-page-meta",
        arguments: { componentUuid: "page-1" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.name).toBe("HomePage");
      expect(output.path).toBe("/");
      expect(output.title).toBe("Welcome to My Site");
      expect(output.description).toBe("A description for SEO");
      expect(output.openGraphImage).toBe("https://example.com/og.png");
      expect(output.canonical).toBe("https://example.com/");
      expect(output.params).toEqual({ slug: "string" });
    });

    it("handles null/undefined metadata fields", async () => {
      mockRequireSession.mockReturnValue({
        site: {
          components: [
            {
              uuid: "page-2",
              name: "MinimalPage",
              pageMeta: {
                path: "/minimal",
                title: null,
                description: "",
                openGraphImage: undefined,
                canonical: null,
                params: {},
                query: {},
                roleId: null,
              },
            },
          ],
        },
      });

      const result = await client.callTool({
        name: "get-page-meta",
        arguments: { componentUuid: "page-2" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.title).toBeNull();
      expect(output.description).toBe("");
      expect(output.openGraphImage).toBeNull();
      expect(output.canonical).toBeNull();
    });

    it("returns error for non-page component", async () => {
      mockRequireSession.mockReturnValue({
        site: {
          components: [
            { uuid: "comp-1", name: "Header" }, // No pageMeta
          ],
        },
      });

      const result = await client.callTool({
        name: "get-page-meta",
        arguments: { componentUuid: "comp-1" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not a page");
    });

    it("returns error for unknown component UUID", async () => {
      mockRequireSession.mockReturnValue({
        site: { components: [] },
      });

      const result = await client.callTool({
        name: "get-page-meta",
        arguments: { componentUuid: "nonexistent" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("get-preview-url", () => {
    it("returns preview and studio URLs for a page", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        site: {
          components: [
            {
              uuid: "page-1",
              name: "HomePage",
              pageMeta: { path: "/home" },
            },
          ],
        },
      });

      const result = await client.callTool({
        name: "get-preview-url",
        arguments: { componentUuid: "page-1" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.studioUrl).toBe(
        "https://studio.example.com/projects/proj-123"
      );
      expect(output.previewUrl).toBe(
        "https://studio.example.com/projects/proj-123/preview/home"
      );
    });

    it("returns only studio URL for non-page components", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        site: {
          components: [
            { uuid: "comp-1", name: "Header" }, // No pageMeta
          ],
        },
      });

      const result = await client.callTool({
        name: "get-preview-url",
        arguments: { componentUuid: "comp-1" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.studioUrl).toBe(
        "https://studio.example.com/projects/proj-123"
      );
      expect(output.previewUrl).toBeUndefined();
    });

    it("returns error for unknown component UUID", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        site: { components: [] },
      });

      const result = await client.callTool({
        name: "get-preview-url",
        arguments: { componentUuid: "nonexistent" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("delete-component", () => {
    it("deletes a component and returns success", async () => {
      mockDeleteComponent.mockResolvedValue({
        save: { revisionNum: 15, incremental: true },
        deletedName: "OldCard",
        deletedUuid: "comp-old",
      });

      const result = await client.callTool({
        name: "delete-component",
        arguments: { componentUuid: "comp-old" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.deletedName).toBe("OldCard");
      expect(output.deletedUuid).toBe("comp-old");
      expect(output.message).toContain("Deleted");
      expect(mockDeleteComponent).toHaveBeenCalledWith(
        mockApiClient,
        "comp-old",
        undefined
      );
    });

    it("passes force flag through to implementation", async () => {
      mockDeleteComponent.mockResolvedValue({
        save: { revisionNum: 16, incremental: true },
        deletedName: "ReferencedComp",
        deletedUuid: "comp-ref",
      });

      await client.callTool({
        name: "delete-component",
        arguments: { componentUuid: "comp-ref", force: true },
      });

      expect(mockDeleteComponent).toHaveBeenCalledWith(
        mockApiClient,
        "comp-ref",
        true
      );
    });

    it("returns error when references exist without force", async () => {
      mockDeleteComponent.mockRejectedValue(
        new Error('Cannot delete "Card": referenced by HomePage, AboutPage.')
      );

      const result = await client.callTool({
        name: "delete-component",
        arguments: { componentUuid: "comp-card" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("referenced by");
    });
  });

  describe("create-style-variant", () => {
    it("creates a component-level style variant", async () => {
      mockCreateStyleVariant.mockResolvedValue({
        save: { revisionNum: 20, incremental: true },
        variantUuid: "variant-hover-1",
        selector: ":hover",
        scope: "component",
      });

      const result = await client.callTool({
        name: "create-style-variant",
        arguments: { componentUuid: "comp-1", selector: ":hover" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.variantUuid).toBe("variant-hover-1");
      expect(output.selector).toBe(":hover");
      expect(output.scope).toBe("component");
      expect(output.revision).toBe(20);
      expect(output.message).toContain(":hover");
      expect(mockCreateStyleVariant).toHaveBeenCalledWith(
        mockApiClient, "comp-1", ":hover", undefined
      );
    });

    it("creates an element-scoped style variant", async () => {
      mockCreateStyleVariant.mockResolvedValue({
        save: { revisionNum: 21, incremental: true },
        variantUuid: "variant-focus-1",
        selector: ":focus",
        scope: "element",
        forTplUuid: "node-btn-1",
        forTplName: "Button",
      });

      const result = await client.callTool({
        name: "create-style-variant",
        arguments: {
          componentUuid: "comp-1",
          selector: ":focus",
          nodeRef: "Button",
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.scope).toBe("element");
      expect(output.element).toBe("Button");
      expect(output.elementUuid).toBe("node-btn-1");
      expect(mockCreateStyleVariant).toHaveBeenCalledWith(
        mockApiClient, "comp-1", ":focus", "Button"
      );
    });

    it("returns error when creation fails", async () => {
      mockCreateStyleVariant.mockRejectedValue(
        new Error('A :hover variant already exists for this component')
      );

      const result = await client.callTool({
        name: "create-style-variant",
        arguments: { componentUuid: "comp-1", selector: ":hover" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error creating style variant");
    });
  });

  describe("create-variant-group", () => {
    it("creates a single-choice variant group with initial variants", async () => {
      mockCreateVariantGroup.mockResolvedValue({
        save: { revisionNum: 22, incremental: true },
        groupUuid: "group-size-1",
        groupName: "Size",
        type: "single",
        variants: [
          { uuid: "v-small", name: "Small" },
          { uuid: "v-large", name: "Large" },
        ],
      });

      const result = await client.callTool({
        name: "create-variant-group",
        arguments: {
          componentUuid: "comp-1",
          name: "Size",
          type: "single",
          initialVariants: ["Small", "Large"],
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.groupUuid).toBe("group-size-1");
      expect(output.groupName).toBe("Size");
      expect(output.type).toBe("single");
      expect(output.variants).toHaveLength(2);
      expect(output.revision).toBe(22);
      expect(mockCreateVariantGroup).toHaveBeenCalledWith(
        mockApiClient, "comp-1", "Size", "single", ["Small", "Large"]
      );
    });

    it("creates a toggle variant group", async () => {
      mockCreateVariantGroup.mockResolvedValue({
        save: { revisionNum: 23, incremental: true },
        groupUuid: "group-toggle-1",
        groupName: "isActive",
        type: "toggle",
        variants: [{ uuid: "v-auto", name: "isActive" }],
      });

      const result = await client.callTool({
        name: "create-variant-group",
        arguments: {
          componentUuid: "comp-1",
          name: "isActive",
          type: "toggle",
        },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.type).toBe("toggle");
      expect(output.variants).toHaveLength(1);
      expect(output.variants[0].name).toBe("isActive");
    });

    it("defaults to single-choice when type is omitted", async () => {
      mockCreateVariantGroup.mockResolvedValue({
        save: { revisionNum: 24, incremental: true },
        groupUuid: "group-1",
        groupName: "Theme",
        type: "single",
        variants: [],
      });

      const result = await client.callTool({
        name: "create-variant-group",
        arguments: { componentUuid: "comp-1", name: "Theme" },
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.type).toBe("single");
      expect(mockCreateVariantGroup).toHaveBeenCalledWith(
        mockApiClient, "comp-1", "Theme", undefined, undefined
      );
    });

    it("returns error when creation fails", async () => {
      mockCreateVariantGroup.mockRejectedValue(
        new Error('Component UUID "nonexistent" not found')
      );

      const result = await client.callTool({
        name: "create-variant-group",
        arguments: { componentUuid: "nonexistent", name: "Size" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error creating variant group");
    });
  });

  describe("refresh-project", () => {
    it("reloads project, clears state, and returns metadata", async () => {
      const refreshedSite = {
        components: [
          { uuid: "c1", name: "Comp1" },
          { uuid: "p1", name: "Page1", pageMeta: { path: "/page" } },
        ],
      };

      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
        projectName: "Test Project",
      });

      mockLoadProject.mockResolvedValue({
        site: refreshedSite,
        bundler: {},
        projectName: "Test Project v2",
        revisionNum: 15,
        modelVersion: 3,
        hostlessDataVersion: 1,
      });

      const result = await client.callTool({
        name: "refresh-project",
        arguments: {},
      });

      const output = parseResponse(result);
      expect(result.isError).toBeFalsy();
      expect(output.success).toBe(true);
      expect(output.projectName).toBe("Test Project v2");
      expect(output.revisionNum).toBe(15);
      expect(output.componentCount).toBe(2);
      expect(output.pageCount).toBe(1);

      // Verify cleanup sequence: cancel batch → dispose tracker → clear undo → clear cache → load → session → init tracker
      expect(mockCancelBatch).toHaveBeenCalled();
      expect(mockDisposeChangeTracker).toHaveBeenCalled();
      expect(mockClearUndoStack).toHaveBeenCalled();
      expect(mockClearNodeCache).toHaveBeenCalled();
      expect(mockLoadProject).toHaveBeenCalledWith(mockApiClient, "proj-123");
      expect(mockSetSession).toHaveBeenCalled();
      expect(mockInitChangeTracker).toHaveBeenCalledWith(refreshedSite);
    });

    it("returns error on reload failure", async () => {
      mockRequireSession.mockReturnValue({
        projectId: "proj-123",
      });
      mockLoadProject.mockRejectedValue(new Error("Server unavailable"));

      const result = await client.callTool({
        name: "refresh-project",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error refreshing project");
    });
  });
});
