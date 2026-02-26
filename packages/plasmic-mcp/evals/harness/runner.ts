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

import type { EvalScenario, ScenarioResult, TranscriptEntry } from "./types.js";
import type { McpEvalClient } from "./mcp-client.js";
import type { ClaudeClient } from "./claude-client.js";
import type { VisualCapture } from "../visual/capture.js";
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
  claudeClient: ClaudeClient,
  visualCapture?: VisualCapture
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // Reset project to clean fixture state
    await mcpClient.resetProject();

    // Run setup steps — direct tool calls, not mediated by Claude.
    // This mirrors how unit tests use beforeEach to set up fixtures.
    // Setup failures abort the scenario — broken preconditions make results meaningless.
    if (scenario.setup) {
      let setupFailed = false;
      for (const step of scenario.setup) {
        const result = await mcpClient.callTool(step.tool, step.params);
        if (result.isError) {
          errors.push(
            `Setup step failed: ${step.tool}.${step.params.action ?? "?"} — ${result.content}`
          );
          setupFailed = true;
          break;
        }
      }
      if (setupFailed) {
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
          errors,
          retries: 0,
          transcript: [],
          graderResults: [],
        };
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

    // Count retries: tool errors followed by continued conversation indicate
    // Claude self-correcting. This is the number of tool_result entries with
    // isError=true (excluding the very last one, if it ended the conversation).
    const retries = countRetries(conversationResult.transcript);

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

    // Visual capture — screenshot Studio after task completes.
    // Runs after grading so the project state is final. Failures are
    // logged but never affect pass/fail (screenshots are advisory).
    let screenshotPaths: { desktop: string | null; mobile: string | null } | undefined;
    let visualError: string | undefined;
    if (visualCapture?.isAvailable()) {
      const captureResult = await visualCapture.capture(
        scenario.id,
        scenario.description,
        mcpClient
      );
      screenshotPaths = {
        desktop: captureResult.desktopPath,
        mobile: captureResult.mobilePath,
      };
      if (captureResult.error) {
        visualError = captureResult.error;
        console.error(
          `[visual] ${scenario.id}: ${captureResult.error}`
        );
      }
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
      retries,
      transcript: conversationResult.transcript,
      graderResults,
      screenshotPaths,
      visualError,
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

// Per-million-token pricing by model family. Used for cost estimation.
// When a model isn't listed, we fall back to the most expensive tier (Opus)
// to avoid underestimating costs.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet": { input: 3, output: 15 },
  "claude-haiku": { input: 0.8, output: 4 },
  "claude-opus": { input: 15, output: 75 },
};

function getModelPricing(
  model: string
): { input: number; output: number } {
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.includes(prefix)) return pricing;
  }
  // Default to Opus pricing (most expensive) to avoid underestimating
  return MODEL_PRICING["claude-opus"];
}

export interface RunAllResult {
  results: ScenarioResult[];
  totalCostDollars: number;
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
  maxCostDollars?: number,
  model?: string,
  visualCapture?: VisualCapture
): Promise<RunAllResult> {
  const results: ScenarioResult[] = [];
  let totalCost = 0;
  const pricing = getModelPricing(model ?? "claude-sonnet");

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

    const result = await runScenario(scenario, mcpClient, claudeClient, visualCapture);
    results.push(result);

    const inputCost = (result.tokensInput / 1_000_000) * pricing.input;
    const outputCost = (result.tokensOutput / 1_000_000) * pricing.output;
    totalCost += inputCost + outputCost;

    if (onProgress) {
      onProgress(i + 1, scenarios.length, result);
    }
  }

  return { results, totalCostDollars: totalCost };
}

/**
 * Count self-correction retries from the transcript.
 * A retry is a tool_result with isError=true that is followed by Claude
 * continuing the conversation (i.e., not the final entry).
 */
function countRetries(transcript: TranscriptEntry[]): number {
  let retries = 0;
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i];
    if (entry.role !== "tool_result") continue;
    try {
      const parsed = JSON.parse(entry.content);
      if (parsed.isError && i < transcript.length - 1) {
        retries++;
      }
    } catch {
      // Skip unparseable entries
    }
  }
  return retries;
}
