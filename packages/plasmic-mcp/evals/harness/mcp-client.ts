/**
 * MCP client adapter for the eval harness.
 *
 * Two modes:
 *
 * **Mock mode** (default): Creates an in-process MCP server using createServer()
 * from the main server module, connected via InMemoryTransport. Mocks global.fetch
 * to return the real bundle fixture. Validates whether Claude selects the right
 * tools with the right parameters without requiring a running Plasmic instance.
 *
 * **Integration mode**: Launches the MCP server as a child process via
 * StdioClientTransport. Connects to a real Plasmic server with real auth
 * credentials. Validates the full roundtrip through the API, model loading,
 * and persistence. Requires PLASMIC_AUTH_HOST, PLASMIC_AUTH_USER,
 * PLASMIC_AUTH_TOKEN env vars and a project ID.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_PATH = resolve(
  __dirname,
  "../../../../platform/wab/playwright/bundles/active-screen-variant-group.json"
);

/** Resolved path to the MCP server entry point for integration mode */
const SERVER_ENTRY = resolve(__dirname, "../../src/index.ts");

/** Package directory — used as cwd when spawning the integration server */
const PACKAGE_DIR = resolve(__dirname, "../..");

export interface ToolCallResult {
  content: string;
  isError: boolean;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class McpEvalClient {
  private client: any = null;
  private server: any = null;
  private transport: any = null;
  private originalFetch: typeof global.fetch | null = null;
  private projectId: string = "";
  private mode: "mock" | "integration";
  /** Captured stderr from the integration server process */
  private serverStderr: string = "";

  constructor(mode: "mock" | "integration" = "mock", projectId?: string) {
    this.mode = mode;
    if (projectId) this.projectId = projectId;
  }

  async initialize(): Promise<void> {
    if (this.mode === "mock") {
      await this.initializeMock();
    } else {
      await this.initializeIntegration();
    }
  }

  private async initializeMock(): Promise<void> {
    // Load the real Plasmic bundle fixture — same one used by 137 integration tests.
    // Format: [[depProjectId, depBundle], [mainProjectId, mainBundle]]
    const fixtureData = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
    const [[depProjectId, depBundleJson], [mainProjectId, mainBundleJson]] =
      fixtureData;
    this.projectId = mainProjectId;

    // Auth env vars — getAuth() in auth.ts reads these before checking .plasmic.auth
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com";
    process.env.PLASMIC_AUTH_USER = "eval-user";
    process.env.PLASMIC_AUTH_TOKEN = "eval-token";

    // Replace global.fetch so PlasmicApiClient (which uses native fetch) returns
    // our fixture bundle instead of hitting a real server.
    this.originalFetch = global.fetch;
    const fixtureProjectId = this.projectId;

    global.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      // GET /api/v1/projects/:id — return the real bundle fixture
      if (
        method === "GET" &&
        url.includes(`/api/v1/projects/${fixtureProjectId}`) &&
        !url.includes("?")
      ) {
        return new Response(
          JSON.stringify({
            rev: { data: JSON.stringify(mainBundleJson), revision: 1 },
            project: { id: fixtureProjectId, name: "Eval Test Project" },
            depPkgs: [{ id: depProjectId, model: depBundleJson }],
            modelVersion: 1,
            hostlessDataVersion: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // GET /api/v1/auth/csrf — CSRF token for write operations
      if (method === "GET" && url.includes("/api/v1/auth/csrf")) {
        return new Response(JSON.stringify({ csrf: "eval-csrf" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // POST /revisions/ — accept save requests
      if (method === "POST" && url.includes("/revisions/")) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /api/v1/projects — list projects
      if (method === "GET" && url.includes("/api/v1/projects")) {
        return new Response(
          JSON.stringify({
            projects: [
              { id: fixtureProjectId, name: "Eval Test Project" },
            ],
            perms: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // POST /api/v1/projects/:id — updateProject (create-page, create-component)
      if (method === "POST" && url.includes("/api/v1/projects/")) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 404 for everything else
      return new Response("Not Found", { status: 404 });
    }) as typeof global.fetch;

    // Suppress console.error from model-loader, change-tracker, MCP server logs.
    // P12.7: Wrapped in try/finally so console.error is always restored, even
    // if dynamic imports or server creation throw. Without this, a failure during
    // initialization permanently suppresses console.error for the process.
    const originalConsoleError = console.error;
    const suppressedConsoleError = (...args: any[]) => {
      const msg = String(args[0] ?? "");
      // Only suppress internal server noise; let eval-prefixed messages through
      if (msg.startsWith("[plasmic-mcp]") || msg.startsWith("[model-loader]")) {
        return;
      }
      originalConsoleError.apply(console, args);
    };
    console.error = suppressedConsoleError;

    try {
      // Dynamic imports — server.ts imports WAB modules that need the mocked fetch
      // to be in place before they make any HTTP calls.
      const { createServer } = await import("../../src/server.js");
      const { InMemoryTransport } = await import(
        "@modelcontextprotocol/sdk/inMemory.js"
      );
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      this.server = createServer();
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await this.server.connect(serverTransport);

      this.client = new Client({ name: "eval-client", version: "1.0" });
      await this.client.connect(clientTransport);
    } finally {
      // Restore console.error
      console.error = originalConsoleError;
    }
  }

  /**
   * Integration mode: launch the MCP server as a child process and connect
   * via StdioClientTransport. The server communicates over stdin/stdout using
   * the MCP JSON-RPC protocol.
   *
   * Required env vars: PLASMIC_AUTH_HOST, PLASMIC_AUTH_USER, PLASMIC_AUTH_TOKEN.
   * Project ID comes from: constructor arg > EVAL_PROJECT_ID env var > auto-detect.
   *
   * Why a child process: the integration tier validates the full roundtrip —
   * the server fetches from the real Plasmic API, loads the real model, and
   * persists changes. This catches issues that mock mode cannot: auth failures,
   * model loading bugs, save/load round-trip data loss.
   */
  private async initializeIntegration(): Promise<void> {
    // Validate required auth env vars
    const requiredVars = [
      "PLASMIC_AUTH_HOST",
      "PLASMIC_AUTH_USER",
      "PLASMIC_AUTH_TOKEN",
    ];
    const missing = requiredVars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      throw new Error(
        `Integration mode requires environment variables: ${missing.join(", ")}. ` +
          "Set them before running integration evals."
      );
    }

    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );

    // Launch the MCP server as a child process. It reads auth from env vars
    // inherited from this process.
    this.transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", SERVER_ENTRY],
      cwd: PACKAGE_DIR,
      stderr: "pipe",
    });

    // Capture server stderr for debugging — the MCP server logs to stderr
    // (stdout is reserved for the JSON-RPC transport).
    if (this.transport.stderr) {
      this.transport.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        this.serverStderr += text;
        // Forward server startup messages for visibility
        if (
          text.includes("[plasmic-mcp]") &&
          text.includes("Starting") ||
          text.includes("connected")
        ) {
          process.stderr.write(`[eval:server] ${text}`);
        }
      });
    }

    this.client = new Client({ name: "eval-client", version: "1.0" });
    await this.client.connect(this.transport);

    // Resolve the project ID:
    // 1. Constructor arg (highest priority — set by --project-id CLI flag)
    // 2. EVAL_PROJECT_ID env var
    // 3. Auto-detect from project.list (uses first project)
    if (!this.projectId) {
      this.projectId = process.env.EVAL_PROJECT_ID ?? "";
    }
    if (!this.projectId) {
      console.error(
        "[eval] No project ID specified, auto-detecting from project.list..."
      );
      const result = await this.callTool("project", { action: "list" });
      try {
        const parsed = JSON.parse(result.content);
        if (parsed.projects?.length > 0) {
          this.projectId = parsed.projects[0].id;
          console.error(
            `[eval] Auto-detected project: ${parsed.projects[0].name} (${this.projectId})`
          );
        } else {
          throw new Error(
            "No projects found. Set EVAL_PROJECT_ID or --project-id, " +
              "or ensure the Plasmic account has at least one project."
          );
        }
      } catch (err: any) {
        if (err.message.includes("No projects found")) throw err;
        throw new Error(
          `Failed to parse project list: ${result.content.substring(0, 200)}`
        );
      }
    }

    // Load the project into the server's in-memory model
    const setResult = await this.callTool("project", {
      action: "set",
      projectId: this.projectId,
    });
    if (setResult.isError) {
      throw new Error(
        `Failed to load project ${this.projectId}: ${setResult.content}`
      );
    }
  }

  /** Get the project ID (works for both mock and integration modes) */
  getProjectId(): string {
    return this.projectId;
  }

  /** @deprecated Use getProjectId() instead */
  getFixtureProjectId(): string {
    return this.projectId;
  }

  /** Get server stderr output (integration mode only, for debugging) */
  getServerStderr(): string {
    return this.serverStderr;
  }

  /** Call an MCP tool and return parsed result */
  async callTool(
    name: string,
    params: Record<string, unknown>
  ): Promise<ToolCallResult> {
    if (!this.client) throw new Error("McpEvalClient not initialized");

    const result = await this.client.callTool({
      name,
      arguments: params,
    });

    const text = result.content?.[0]?.text ?? "";
    return {
      content: text,
      isError: result.isError === true,
    };
  }

  /**
   * Get tool definitions in Anthropic API format.
   * Converts MCP SDK's JSON Schema (inputSchema) to Anthropic's input_schema.
   */
  async getTools(): Promise<AnthropicTool[]> {
    if (!this.client) throw new Error("McpEvalClient not initialized");

    const { tools } = await this.client.listTools();
    return tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.inputSchema,
    }));
  }

  /**
   * Reset project state between scenarios.
   *
   * Mock mode: reloads the fixture bundle (identical state every time).
   * Integration mode: re-fetches the project from the Plasmic API. If a
   * previous scenario saved changes via project.save, those changes persist
   * in the remote project and become the new baseline.
   *
   * project.set clears all module singletons (session, change-tracker,
   * batch-manager, undo-manager, node-cache).
   */
  async resetProject(): Promise<void> {
    await this.callTool("project", {
      action: "set",
      projectId: this.projectId,
    });
  }

  /** Clean up resources */
  async close(): Promise<void> {
    // Close MCP client connection
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Client may already be disconnected
      }
      this.client = null;
    }

    // Close transport (kills child process in integration mode)
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Transport may already be closed
      }
      this.transport = null;
    }

    // Restore global.fetch (mock mode only)
    if (this.originalFetch) {
      global.fetch = this.originalFetch;
      this.originalFetch = null;
    }

    // P12.4: Close the MCP server before nulling. Without this, the
    // InMemoryTransport server and its resources remain open, leaking
    // memory across scenarios.
    if (this.server) {
      try {
        await this.server.close();
      } catch {
        // Server may already be closed
      }
    }
    this.server = null;
  }
}
