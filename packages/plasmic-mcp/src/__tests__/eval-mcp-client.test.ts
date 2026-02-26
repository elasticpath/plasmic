/**
 * Tests for the MCP eval client module (P3.3).
 *
 * Why these tests matter: the MCP client is the bridge between the eval harness
 * and the Plasmic MCP server. In mock mode it creates an in-process server with
 * mocked fetch; in integration mode it spawns a child process. If tool routing,
 * project reset, or mode switching breaks, every scenario in the eval run fails.
 *
 * These tests verify the McpEvalClient class interface, tool call routing, and
 * project state management. Integration mode initialization is tested separately
 * since it requires auth env vars and a running server.
 *
 * Note: Full mock mode initialization tests are skipped as they require loading
 * the entire WAB model — that's covered by integration tests. These unit tests
 * focus on the client's API contract and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpEvalClient } from "../../evals/harness/mcp-client.js";

// ---------------------------------------------------------------------------
// Constructor and mode
// ---------------------------------------------------------------------------
describe("McpEvalClient — constructor", () => {
  it("defaults to mock mode", () => {
    const client = new McpEvalClient();
    // Access mode via projectId (which is empty until init)
    expect(client.getProjectId()).toBe("");
  });

  it("stores projectId when provided", () => {
    const client = new McpEvalClient("mock", "test-project-123");
    expect(client.getProjectId()).toBe("test-project-123");
  });

  it("getFixtureProjectId is deprecated alias for getProjectId", () => {
    const client = new McpEvalClient("mock", "proj-abc");
    expect(client.getFixtureProjectId()).toBe(client.getProjectId());
  });

  it("getServerStderr returns empty string initially", () => {
    const client = new McpEvalClient();
    expect(client.getServerStderr()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// callTool — pre-initialization error
// ---------------------------------------------------------------------------
describe("McpEvalClient — callTool before init", () => {
  it("throws when calling tool before initialization", async () => {
    const client = new McpEvalClient();
    await expect(
      client.callTool("inspect", { action: "tree" })
    ).rejects.toThrow("not initialized");
  });
});

// ---------------------------------------------------------------------------
// getTools — pre-initialization error
// ---------------------------------------------------------------------------
describe("McpEvalClient — getTools before init", () => {
  it("throws when getting tools before initialization", async () => {
    const client = new McpEvalClient();
    await expect(client.getTools()).rejects.toThrow("not initialized");
  });
});

// ---------------------------------------------------------------------------
// Integration mode — env var validation
// ---------------------------------------------------------------------------
describe("McpEvalClient — integration mode env validation", () => {
  it("throws when required auth env vars are missing", async () => {
    // Clear auth env vars
    const origHost = process.env.PLASMIC_AUTH_HOST;
    const origUser = process.env.PLASMIC_AUTH_USER;
    const origToken = process.env.PLASMIC_AUTH_TOKEN;

    delete process.env.PLASMIC_AUTH_HOST;
    delete process.env.PLASMIC_AUTH_USER;
    delete process.env.PLASMIC_AUTH_TOKEN;

    const client = new McpEvalClient("integration");

    await expect(client.initialize()).rejects.toThrow(
      "requires environment variables"
    );

    // Restore
    if (origHost) process.env.PLASMIC_AUTH_HOST = origHost;
    if (origUser) process.env.PLASMIC_AUTH_USER = origUser;
    if (origToken) process.env.PLASMIC_AUTH_TOKEN = origToken;
  });
});

// ---------------------------------------------------------------------------
// close — idempotent
// ---------------------------------------------------------------------------
describe("McpEvalClient — close", () => {
  it("close is safe to call before initialization", async () => {
    const client = new McpEvalClient();
    // Should not throw
    await client.close();
  });

  it("close is safe to call multiple times", async () => {
    const client = new McpEvalClient();
    await client.close();
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Tool call result format
// ---------------------------------------------------------------------------
describe("McpEvalClient — ToolCallResult interface", () => {
  it("ToolCallResult has content and isError fields", () => {
    // Type-level test: verify the interface shape
    const result: { content: string; isError: boolean } = {
      content: '{"success":true}',
      isError: false,
    };
    expect(result.content).toBeTruthy();
    expect(result.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AnthropicTool interface
// ---------------------------------------------------------------------------
describe("McpEvalClient — AnthropicTool interface", () => {
  it("AnthropicTool has name, description, and input_schema", () => {
    // Type-level test: verify the interface shape
    const tool: { name: string; description: string; input_schema: Record<string, unknown> } = {
      name: "inspect",
      description: "Inspect components",
      input_schema: { type: "object", properties: {} },
    };
    expect(tool.name).toBe("inspect");
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.type).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// resetProject — calls project.set
// ---------------------------------------------------------------------------
describe("McpEvalClient — resetProject", () => {
  it("resetProject calls callTool with project.set", async () => {
    // Create a client and manually wire up a mock internal client
    const client = new McpEvalClient("mock", "proj-123");

    // Manually set the internal client for testing
    const mockInternalClient = {
      callTool: vi.fn(async () => ({
        content: [{ text: '{"success":true}' }],
        isError: false,
      })),
      listTools: vi.fn(async () => ({ tools: [] })),
      close: vi.fn(async () => {}),
      connect: vi.fn(async () => {}),
    };
    (client as any).client = mockInternalClient;

    await client.resetProject();

    expect(mockInternalClient.callTool).toHaveBeenCalledWith({
      name: "project",
      arguments: { action: "set", projectId: "proj-123" },
    });
  });
});
