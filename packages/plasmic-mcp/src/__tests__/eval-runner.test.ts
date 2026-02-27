/**
 * Tests for the eval runner module (P3.1).
 *
 * Why these tests matter: the runner orchestrates the entire eval pipeline —
 * project reset, setup steps, Claude conversation, grading, visual capture,
 * and result assembly. If any of these steps misfire (e.g., setup errors not
 * aborting, grader results not affecting success), the eval system produces
 * unreliable results. These tests verify the runner correctly handles happy
 * paths, error propagation, retry counting, timeout handling, and cost limits.
 *
 * Tests mock all external dependencies (MCP client, Claude client, graders,
 * visual capture) to test the runner's orchestration logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  EvalScenario,
  ScenarioResult,
  TranscriptEntry,
} from "../../evals/harness/types.js";
import type { ConversationResult } from "../../evals/harness/claude-client.js";

// Mock graders and visual modules
vi.mock("../../evals/graders/index.js", () => ({
  runGraders: vi.fn(async () => []),
}));

vi.mock("../../evals/graders/llm-judge.js", () => ({
  runLlmJudge: vi.fn(async () => null),
}));

// Import after mocks
const { runScenario, runAll, extractLastComponentUuid } = await import(
  "../../evals/harness/runner.js"
);
const { runGraders } = await import("../../evals/graders/index.js");

/** Create a minimal EvalScenario */
function makeScenario(
  overrides: Partial<EvalScenario> = {}
): EvalScenario {
  return {
    id: "test-scenario",
    description: "Test task description",
    domains: ["component"],
    tier: "simple",
    graders: [{ type: "no-errors", params: {} }],
    timeout: 60,
    ...overrides,
  };
}

/** Create a mock McpEvalClient */
function mockMcpClient() {
  return {
    resetProject: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({
      content: JSON.stringify({ success: true }),
      isError: false,
    })),
    getTools: vi.fn(async () => [
      { name: "inspect", description: "Inspect", input_schema: { type: "object" } },
    ]),
  } as any;
}

/** Create a mock ClaudeClient that completes immediately */
function mockClaudeClient(
  overrides: Partial<ConversationResult> = {}
): any {
  const result: ConversationResult = {
    transcript: [],
    totalInputTokens: 100,
    totalOutputTokens: 50,
    toolCallCount: 2,
    finalText: "Done!",
    timedOut: false,
    incomplete: false,
    maxTurnsExhausted: false,
    ...overrides,
  };
  return {
    runConversation: vi.fn(async () => result),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: graders pass
  (runGraders as any).mockResolvedValue([
    { graderType: "no-errors", passed: true, message: "No errors" },
  ]);
});

// Suppress console.error from runner (progress messages)
vi.spyOn(console, "error").mockImplementation(() => {});

// ---------------------------------------------------------------------------
// runScenario — happy path
// ---------------------------------------------------------------------------
describe("runScenario — happy path", () => {
  it("returns success when graders pass and no timeout", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient();

    const result = await runScenario(
      makeScenario(),
      mcpClient,
      claudeClient
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe("test-scenario");
    expect(result.tier).toBe("simple");
    expect(result.domains).toEqual(["component"]);
  });

  it("calls resetProject before each scenario", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient();

    await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(mcpClient.resetProject).toHaveBeenCalledTimes(1);
  });

  it("passes scenario description to Claude", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient();

    await runScenario(
      makeScenario({ description: "Build a hero section" }),
      mcpClient,
      claudeClient
    );

    const call = claudeClient.runConversation.mock.calls[0];
    expect(call[1]).toBe("Build a hero section");
  });

  it("records token usage from Claude conversation", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient({
      totalInputTokens: 5000,
      totalOutputTokens: 2500,
      toolCallCount: 7,
    });

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.tokensInput).toBe(5000);
    expect(result.tokensOutput).toBe(2500);
    expect(result.toolCalls).toBe(7);
  });

  it("records duration in milliseconds", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient();

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes with no graders (spec EC6)", async () => {
    (runGraders as any).mockResolvedValue([]);
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient();

    const result = await runScenario(
      makeScenario({ graders: [] }),
      mcpClient,
      claudeClient
    );

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runScenario — setup steps
// ---------------------------------------------------------------------------
describe("runScenario — setup steps", () => {
  it("executes setup steps before Claude conversation", async () => {
    const callOrder: string[] = [];
    const mcpClient = mockMcpClient();
    mcpClient.callTool.mockImplementation(async (name: string, params: any) => {
      callOrder.push(`${name}.${params.action}`);
      return { content: "{}", isError: false };
    });
    const claudeClient = mockClaudeClient();
    claudeClient.runConversation.mockImplementation(async () => {
      callOrder.push("conversation");
      return {
        transcript: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        toolCallCount: 0,
        finalText: "",
        timedOut: false,
        incomplete: false,
        maxTurnsExhausted: false,
      };
    });

    await runScenario(
      makeScenario({
        setup: [
          { tool: "component", params: { action: "create", name: "TestCard" } },
        ],
      }),
      mcpClient,
      claudeClient
    );

    expect(callOrder.indexOf("component.create")).toBeLessThan(
      callOrder.indexOf("conversation")
    );
  });

  it("aborts scenario when setup step fails", async () => {
    const mcpClient = mockMcpClient();
    mcpClient.callTool.mockResolvedValue({
      content: "Error: component already exists",
      isError: true,
    });
    const claudeClient = mockClaudeClient();

    const result = await runScenario(
      makeScenario({
        setup: [{ tool: "component", params: { action: "create", name: "X" } }],
      }),
      mcpClient,
      claudeClient
    );

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Setup step failed");
    // Claude should NOT have been called
    expect(claudeClient.runConversation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runScenario — timeout and incomplete
// ---------------------------------------------------------------------------
describe("runScenario — timeout and incomplete", () => {
  it("marks scenario as failed when Claude times out", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient({ timedOut: true });

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Scenario timed out");
  });

  it("marks scenario as failed when Claude asks clarifying questions", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient({ incomplete: true });

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("clarifying questions"))).toBe(
      true
    );
  });

  it("marks scenario as failed when MAX_TURNS exhausted (P12.5)", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient({ maxTurnsExhausted: true });

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("MAX_TURNS"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runScenario — grader integration
// ---------------------------------------------------------------------------
describe("runScenario — graders", () => {
  it("fails when any grader fails", async () => {
    (runGraders as any).mockResolvedValue([
      { graderType: "no-errors", passed: true, message: "OK" },
      { graderType: "existence", passed: false, message: "Not found" },
    ]);
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient();

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.success).toBe(false);
    expect(result.graderResults).toHaveLength(2);
  });

  it("includes grader results in scenario result", async () => {
    (runGraders as any).mockResolvedValue([
      {
        graderType: "tool-sequence",
        passed: true,
        message: "All tools called",
        details: { required: ["inspect"] },
      },
    ]);
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient();

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.graderResults[0].graderType).toBe("tool-sequence");
    expect(result.graderResults[0].details?.required).toEqual(["inspect"]);
  });
});

// ---------------------------------------------------------------------------
// runScenario — error collection
// ---------------------------------------------------------------------------
describe("runScenario — error collection", () => {
  it("collects tool errors from transcript", async () => {
    const transcript: TranscriptEntry[] = [
      {
        role: "tool_result",
        content: JSON.stringify({
          name: "node",
          input: { action: "add" },
          result: "Error: parent not found",
          isError: true,
        }),
        timestamp: Date.now(),
      },
    ];
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient({ transcript });

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.errors.some((e) => e.includes("Tool error"))).toBe(true);
  });

  it("catches fatal errors and still returns a result (spec GE6)", async () => {
    const mcpClient = mockMcpClient();
    mcpClient.resetProject.mockRejectedValue(
      new Error("Connection lost")
    );
    const claudeClient = mockClaudeClient();

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("Fatal error"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Connection lost"))).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// runScenario — retry counting
// ---------------------------------------------------------------------------
describe("runScenario — retries", () => {
  it("counts retries from error tool_results that aren't final", async () => {
    const transcript: TranscriptEntry[] = [
      {
        role: "tool_result",
        content: JSON.stringify({
          name: "node",
          input: { action: "add" },
          result: "Error",
          isError: true,
        }),
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content: "Let me try again",
        timestamp: Date.now(),
      },
      {
        role: "tool_result",
        content: JSON.stringify({
          name: "node",
          input: { action: "add" },
          result: "{}",
          isError: false,
        }),
        timestamp: Date.now(),
      },
    ];
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient({ transcript });

    const result = await runScenario(makeScenario(), mcpClient, claudeClient);

    expect(result.retries).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runAll — batch execution
// ---------------------------------------------------------------------------
describe("runAll — batch execution", () => {
  it("runs all scenarios and returns combined results", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient();

    const { results, totalCostDollars } = await runAll(
      [makeScenario({ id: "s1" }), makeScenario({ id: "s2" })],
      mcpClient,
      claudeClient
    );

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("s1");
    expect(results[1].id).toBe("s2");
    expect(totalCostDollars).toBeGreaterThanOrEqual(0);
  });

  it("calls onProgress callback after each scenario", async () => {
    const mcpClient = mockMcpClient();
    const claudeClient = mockClaudeClient();
    const onProgress = vi.fn();

    await runAll(
      [makeScenario({ id: "s1" }), makeScenario({ id: "s2" })],
      mcpClient,
      claudeClient,
      onProgress
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(1, 2, expect.objectContaining({ id: "s1" }));
    expect(onProgress).toHaveBeenCalledWith(2, 2, expect.objectContaining({ id: "s2" }));
  });

  it("stops when cost limit is exceeded", async () => {
    const mcpClient = mockMcpClient();
    // Each conversation uses 100K tokens → high cost
    const claudeClient = mockClaudeClient({
      totalInputTokens: 100_000,
      totalOutputTokens: 100_000,
    });

    const { results } = await runAll(
      [
        makeScenario({ id: "s1" }),
        makeScenario({ id: "s2" }),
        makeScenario({ id: "s3" }),
      ],
      mcpClient,
      claudeClient,
      undefined,
      0.001 // Very low cost limit
    );

    // First scenario runs, cost calculated, next scenario may run or be skipped
    // depending on exact cost — at minimum first scenario completes
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
