/**
 * MCP client adapter for the eval harness.
 *
 * In mock mode, creates an in-process MCP server using createServer() from the
 * main server module, connected via InMemoryTransport. Mocks global.fetch to
 * return the real bundle fixture (same pattern as real-integration.test.ts).
 *
 * Why mock mode: it validates whether Claude selects the right tools with the
 * right parameters without requiring a running Plasmic instance. The existing
 * 1197 tests already prove the tools work — evals test Claude's ability to
 * USE them.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_PATH = resolve(
  __dirname,
  "../../../../platform/wab/cypress/bundles/active-screen-variant-group.json"
);

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
  private originalFetch: typeof global.fetch | null = null;
  private fixtureProjectId: string = "";
  private mode: "mock" | "integration";

  constructor(mode: "mock" | "integration" = "mock") {
    this.mode = mode;
  }

  async initialize(): Promise<void> {
    if (this.mode === "mock") {
      await this.initializeMock();
    } else {
      throw new Error("Integration mode not yet implemented (planned for P2.5)");
    }
  }

  private async initializeMock(): Promise<void> {
    // Load the real Plasmic bundle fixture — same one used by 137 integration tests.
    // Format: [[depProjectId, depBundle], [mainProjectId, mainBundle]]
    const fixtureData = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
    const [[depProjectId, depBundleJson], [mainProjectId, mainBundleJson]] =
      fixtureData;
    this.fixtureProjectId = mainProjectId;

    // Auth env vars — getAuth() in auth.ts reads these before checking .plasmic.auth
    process.env.PLASMIC_AUTH_HOST = "https://studio.example.com";
    process.env.PLASMIC_AUTH_USER = "eval-user";
    process.env.PLASMIC_AUTH_TOKEN = "eval-token";

    // Replace global.fetch so PlasmicApiClient (which uses native fetch) returns
    // our fixture bundle instead of hitting a real server.
    this.originalFetch = global.fetch;
    const fixtureProjectId = this.fixtureProjectId;

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

    // Suppress console.error from model-loader, change-tracker, MCP server logs
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

    // Restore console.error
    console.error = originalConsoleError;
  }

  /** Get the fixture project ID (for mock mode setup steps) */
  getFixtureProjectId(): string {
    return this.fixtureProjectId;
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
   * Reset project state by reloading the fixture bundle.
   * Called between scenarios to ensure clean state.
   * project.set clears all module singletons (session, change-tracker,
   * batch-manager, undo-manager, node-cache).
   */
  async resetProject(): Promise<void> {
    await this.callTool("project", {
      action: "set",
      projectId: this.fixtureProjectId,
    });
  }

  /** Clean up resources and restore global.fetch */
  async close(): Promise<void> {
    if (this.originalFetch) {
      global.fetch = this.originalFetch;
      this.originalFetch = null;
    }
    this.client = null;
    this.server = null;
  }
}
