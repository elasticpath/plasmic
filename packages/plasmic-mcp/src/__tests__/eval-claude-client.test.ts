/**
 * Tests for the Claude conversation client (P3.2).
 *
 * Why these tests matter: the Claude client manages the multi-turn agentic loop
 * that is core to the eval system. If conversation management fails (e.g., tool
 * results not routed back, timeouts not enforced, transcript not captured), evals
 * either hang indefinitely, produce incomplete transcripts, or silently lose tool
 * call data — all of which corrupt eval results.
 *
 * These tests mock the Anthropic SDK to verify conversation flow, tool dispatch,
 * timeout handling, message formatting, and transcript capture without making
 * real API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
    constructor() {}
  },
}));

// Import after mocks
const { ClaudeClient } = await import(
  "../../evals/harness/claude-client.js"
);

/** Create a mock Anthropic response with text only (end_turn) */
function textResponse(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

/** Create a mock Anthropic response with tool_use */
function toolUseResponse(
  tools: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  inputTokens = 200,
  outputTokens = 100
) {
  return {
    content: tools.map((t) => ({
      type: "tool_use",
      id: t.id,
      name: t.name,
      input: t.input,
    })),
    stop_reason: "tool_use",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

const dummyTools = [
  {
    name: "inspect",
    description: "Inspect tool",
    input_schema: { type: "object" },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Single-turn conversation (text response only)
// ---------------------------------------------------------------------------
describe("ClaudeClient — single turn", () => {
  it("returns final text and metrics for immediate text response", async () => {
    mockCreate.mockResolvedValueOnce(textResponse("Task complete.", 150, 75));

    const client = new ClaudeClient("test-key", "claude-sonnet-4-test");
    const result = await client.runConversation(
      "System prompt",
      "Do something",
      dummyTools,
      async () => ({ content: "{}", isError: false })
    );

    expect(result.finalText).toBe("Task complete.");
    expect(result.totalInputTokens).toBe(150);
    expect(result.totalOutputTokens).toBe(75);
    expect(result.toolCallCount).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.incomplete).toBe(false);
  });

  it("records user message in transcript", async () => {
    mockCreate.mockResolvedValueOnce(textResponse("Done"));

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Create a button",
      dummyTools,
      async () => ({ content: "{}", isError: false })
    );

    expect(result.transcript[0].role).toBe("user");
    expect(result.transcript[0].content).toBe("Create a button");
  });

  it("records assistant response in transcript", async () => {
    mockCreate.mockResolvedValueOnce(textResponse("Done"));

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Task",
      dummyTools,
      async () => ({ content: "{}", isError: false })
    );

    // First is user, second is assistant
    expect(result.transcript[1].role).toBe("assistant");
    expect(result.transcript[1].tokenUsage).toEqual({ input: 100, output: 50 });
  });
});

// ---------------------------------------------------------------------------
// Multi-turn conversation (tool use → result → text)
// ---------------------------------------------------------------------------
describe("ClaudeClient — multi-turn tool use", () => {
  it("routes tool calls through onToolCall and continues conversation", async () => {
    // Turn 1: Claude calls a tool
    mockCreate.mockResolvedValueOnce(
      toolUseResponse([
        { id: "call_1", name: "inspect", input: { action: "tree" } },
      ])
    );
    // Turn 2: Claude responds with text
    mockCreate.mockResolvedValueOnce(textResponse("Tree inspected."));

    const onToolCall = vi.fn(async () => ({
      content: JSON.stringify({ tag: "div" }),
      isError: false,
    }));

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Inspect the tree",
      dummyTools,
      onToolCall
    );

    expect(onToolCall).toHaveBeenCalledWith("inspect", { action: "tree" });
    expect(result.toolCallCount).toBe(1);
    expect(result.finalText).toBe("Tree inspected.");
  });

  it("records tool_result entries in transcript", async () => {
    mockCreate.mockResolvedValueOnce(
      toolUseResponse([
        { id: "call_1", name: "node", input: { action: "add" } },
      ])
    );
    mockCreate.mockResolvedValueOnce(textResponse("Added."));

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Add a node",
      dummyTools,
      async () => ({ content: '{"uuid":"n1"}', isError: false })
    );

    const toolResult = result.transcript.find((e) => e.role === "tool_result");
    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(toolResult!.content);
    expect(parsed.name).toBe("node");
    expect(parsed.isError).toBe(false);
  });

  it("handles multiple tool calls in a single response", async () => {
    mockCreate.mockResolvedValueOnce(
      toolUseResponse([
        { id: "call_1", name: "inspect", input: { action: "tree" } },
        { id: "call_2", name: "component", input: { action: "list" } },
      ])
    );
    mockCreate.mockResolvedValueOnce(textResponse("Done."));

    const onToolCall = vi.fn(async () => ({
      content: "{}",
      isError: false,
    }));

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Task",
      dummyTools,
      onToolCall
    );

    expect(onToolCall).toHaveBeenCalledTimes(2);
    expect(result.toolCallCount).toBe(2);
  });

  it("accumulates tokens across multiple turns", async () => {
    mockCreate.mockResolvedValueOnce(
      toolUseResponse(
        [{ id: "call_1", name: "inspect", input: {} }],
        200,
        100
      )
    );
    mockCreate.mockResolvedValueOnce(textResponse("Done", 150, 75));

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Task",
      dummyTools,
      async () => ({ content: "{}", isError: false })
    );

    expect(result.totalInputTokens).toBe(350);
    expect(result.totalOutputTokens).toBe(175);
  });
});

// ---------------------------------------------------------------------------
// Tool error handling
// ---------------------------------------------------------------------------
describe("ClaudeClient — tool errors", () => {
  it("continues conversation when tool call throws (spec EC1)", async () => {
    mockCreate.mockResolvedValueOnce(
      toolUseResponse([
        { id: "call_1", name: "inspect", input: { action: "tree" } },
      ])
    );
    mockCreate.mockResolvedValueOnce(textResponse("Handled error."));

    const onToolCall = vi.fn(async () => {
      throw new Error("Connection refused");
    });

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Task",
      dummyTools,
      onToolCall
    );

    // Should have continued to get the final text
    expect(result.finalText).toBe("Handled error.");
    // Tool result should have isError: true
    const toolResult = result.transcript.find((e) => e.role === "tool_result");
    const parsed = JSON.parse(toolResult!.content);
    expect(parsed.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Timeout handling
// ---------------------------------------------------------------------------
describe("ClaudeClient — timeout", () => {
  it("times out when API call exceeds timeout", async () => {
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(textResponse("Late")), 5000)
        )
    );

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Task",
      dummyTools,
      async () => ({ content: "{}", isError: false }),
      100 // 100ms timeout
    );

    expect(result.timedOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Incomplete detection
// ---------------------------------------------------------------------------
describe("ClaudeClient — incomplete detection", () => {
  it("detects clarifying questions when no tools called and response has '?'", async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse("What color should the button be?")
    );

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Task",
      dummyTools,
      async () => ({ content: "{}", isError: false })
    );

    expect(result.incomplete).toBe(true);
    expect(result.toolCallCount).toBe(0);
  });

  it("does NOT mark as incomplete when tools were called", async () => {
    mockCreate.mockResolvedValueOnce(
      toolUseResponse([
        { id: "call_1", name: "inspect", input: { action: "tree" } },
      ])
    );
    mockCreate.mockResolvedValueOnce(
      textResponse("I've inspected the tree. Do you want me to continue?")
    );

    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Task",
      dummyTools,
      async () => ({ content: "{}", isError: false })
    );

    expect(result.incomplete).toBe(false);
    expect(result.toolCallCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Transcript result truncation
// ---------------------------------------------------------------------------
describe("ClaudeClient — transcript truncation", () => {
  it("truncates tool result content to 500 chars in transcript", async () => {
    mockCreate.mockResolvedValueOnce(
      toolUseResponse([
        { id: "call_1", name: "inspect", input: { action: "tree" } },
      ])
    );
    mockCreate.mockResolvedValueOnce(textResponse("Done"));

    const longResult = "x".repeat(1000);
    const client = new ClaudeClient("test-key");
    const result = await client.runConversation(
      "System",
      "Task",
      dummyTools,
      async () => ({ content: longResult, isError: false })
    );

    const toolEntry = result.transcript.find((e) => e.role === "tool_result");
    const parsed = JSON.parse(toolEntry!.content);
    expect(parsed.result.length).toBe(500);
  });
});
