/**
 * Core eval runner — executes scenarios end-to-end.
 *
 * For each scenario:
 *   1. Reset project to clean fixture state
 *   2. Run setup steps (direct MCP tool calls, not via Claude)
 *   3. Send task description to Claude with all 8 STRAP tools available
 *   4. Route Claude's tool_use responses through the MCP client
 *   5. Run graders against the transcript and final project state
 *   6. Return structured result with pass/fail, metrics, transcript
 *
 * Why the runner handles project reset: deterministic preconditions are
 * essential for repeatable evals. Each scenario starts from the same
 * known state (the fixture bundle), ensuring failures are caused by
 * Claude's behavior, not leftover state from previous scenarios.
 */

import type { EvalScenario, ScenarioResult } from "./types.js";
import type { McpEvalClient } from "./mcp-client.js";
import type { ClaudeClient } from "./claude-client.js";
import { runGraders } from "../graders/index.js";

const SYSTEM_PROMPT = `You are an expert Plasmic developer. You have access to MCP tools that let you create, edit, and inspect Plasmic projects.

When given a task, use the available tools to complete it. Break complex tasks into steps and use the appropriate tools.

Important guidelines:
- The project is already loaded — you can start using inspect, component, node, design, variant, data, and interaction tools immediately.
- Use inspect tools to understand the current state before making changes.
- Use component tools to create pages and components.
- Use node tools to add and modify elements within components.
- Use design tools for tokens, mixins, themes, and assets.
- Use variant tools for responsive breakpoints and interactive states.
- Use data tools for queries, conditions, and repetition.
- Use interaction tools for event handlers.

Complete the task fully, then respond with a brief summary of what you did.`;

export async function runScenario(
  scenario: EvalScenario,
  mcpClient: McpEvalClient,
  claudeClient: ClaudeClient
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // Reset project to clean fixture state
    await mcpClient.resetProject();

    // Run setup steps — direct tool calls, not mediated by Claude.
    // This mirrors how unit tests use beforeEach to set up fixtures.
    if (scenario.setup) {
      for (const step of scenario.setup) {
        const result = await mcpClient.callTool(step.tool, step.params);
        if (result.isError) {
          errors.push(
            `Setup step failed: ${step.tool}.${step.params.action ?? "?"} — ${result.content}`
          );
        }
      }
    }

    // Get tool definitions in Anthropic format
    const tools = await mcpClient.getTools();

    // Run the Claude conversation
    const conversationResult = await claudeClient.runConversation(
      SYSTEM_PROMPT,
      scenario.description,
      tools,
      async (name, input) => mcpClient.callTool(name, input),
      scenario.timeout * 1000
    );

    // Collect tool errors from transcript
    for (const entry of conversationResult.transcript) {
      if (entry.role === "tool_result") {
        try {
          const parsed = JSON.parse(entry.content);
          if (parsed.isError) {
            errors.push(`Tool error: ${parsed.name} — ${parsed.result}`);
          }
        } catch {
          // Non-JSON transcript entries are fine to skip
        }
      }
    }

    // Run graders against transcript and MCP state
    const graderResults = await runGraders(
      scenario.graders,
      conversationResult.transcript,
      mcpClient
    );

    // Determine overall success
    const success = conversationResult.timedOut
      ? false
      : conversationResult.incomplete
        ? false
        : graderResults.length === 0
          ? true // No graders = pass (warned during scenario load per EC6)
          : graderResults.every((g) => g.passed);

    if (conversationResult.timedOut) {
      errors.push("Scenario timed out");
    }
    if (conversationResult.incomplete) {
      errors.push(
        "Claude asked clarifying questions instead of completing the task"
      );
    }

    return {
      id: scenario.id,
      tier: scenario.tier,
      domains: scenario.domains,
      success,
      qualityScore: null, // LLM judge not yet implemented (P2.4)
      toolCalls: conversationResult.toolCallCount,
      tokensInput: conversationResult.totalInputTokens,
      tokensOutput: conversationResult.totalOutputTokens,
      durationMs: Date.now() - startTime,
      errors,
      retries: 0,
      transcript: conversationResult.transcript,
      graderResults,
    };
  } catch (err: any) {
    // Fatal error — still produce a result so partial reports can be saved (GE6)
    return {
      id: scenario.id,
      tier: scenario.tier,
      domains: scenario.domains,
      success: false,
      qualityScore: null,
      toolCalls: 0,
      tokensInput: 0,
      tokensOutput: 0,
      durationMs: Date.now() - startTime,
      errors: [...errors, `Fatal error: ${err.message}`],
      retries: 0,
      transcript: [],
      graderResults: [],
    };
  }
}

/**
 * Run all scenarios sequentially, with progress reporting and cost limits.
 * Results are accumulated incrementally so partial results survive interruption (GE6).
 */
export async function runAll(
  scenarios: EvalScenario[],
  mcpClient: McpEvalClient,
  claudeClient: ClaudeClient,
  onProgress?: (
    completed: number,
    total: number,
    result: ScenarioResult
  ) => void,
  maxCostDollars?: number
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  let totalCost = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];

    // Cost check — abort if projected cost exceeds limit
    if (maxCostDollars !== undefined && totalCost > maxCostDollars) {
      console.error(
        `[eval] Cost limit reached ($${totalCost.toFixed(2)} > $${maxCostDollars}). Stopping.`
      );
      break;
    }

    console.error(
      `[eval] Running scenario ${i + 1}/${scenarios.length}: ${scenario.id}`
    );

    const result = await runScenario(scenario, mcpClient, claudeClient);
    results.push(result);

    // Rough cost estimate: $3/M input, $15/M output for Sonnet
    const inputCost = (result.tokensInput / 1_000_000) * 3;
    const outputCost = (result.tokensOutput / 1_000_000) * 15;
    totalCost += inputCost + outputCost;

    if (onProgress) {
      onProgress(i + 1, scenarios.length, result);
    }
  }

  return results;
}
