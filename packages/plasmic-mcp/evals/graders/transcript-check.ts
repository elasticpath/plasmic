/**
 * Transcript-based graders — validate tool call patterns from conversation logs.
 *
 * These graders operate on the recorded transcript without making any MCP calls,
 * making them fast and suitable for mock-tier validation.
 *
 * - tool-sequence: Specific tools were called (order-independent, set membership)
 * - tool-params: A specific tool call included expected parameters
 * - count: Tool call count is within expected range
 * - no-errors: No tool calls returned isError: true
 */

import type {
  GraderConfig,
  GraderResult,
  TranscriptEntry,
} from "../harness/types.js";

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
}

/**
 * Extract tool calls from transcript entries.
 * Tool results are recorded as JSON with { name, input, result, isError } shape.
 */
function extractToolCalls(transcript: TranscriptEntry[]): ToolCall[] {
  const calls: ToolCall[] = [];

  for (const entry of transcript) {
    if (entry.role === "tool_result") {
      try {
        const parsed = JSON.parse(entry.content);
        calls.push({
          name: parsed.name ?? "",
          input: parsed.input ?? {},
          result: parsed.result ?? "",
          isError: parsed.isError === true,
        });
      } catch {
        // Skip unparseable entries
      }
    }
  }

  return calls;
}

export function runTranscriptGrader(
  config: GraderConfig,
  transcript: TranscriptEntry[]
): GraderResult {
  const toolCalls = extractToolCalls(transcript);

  switch (config.type) {
    case "tool-sequence":
      return gradeToolSequence(config.params, toolCalls);
    case "tool-params":
      return gradeToolParams(config.params, toolCalls);
    case "count":
      return gradeCount(config.params, toolCalls);
    case "no-errors":
      return gradeNoErrors(toolCalls);
    default:
      return {
        graderType: config.type,
        passed: false,
        message: `Unknown transcript grader: ${config.type}`,
      };
  }
}

/**
 * tool-sequence: Check that specific tools were called (order-independent).
 * Grades outcomes not paths — if Claude achieves the goal via different tools,
 * that's fine as long as the required set is covered (spec SE1).
 *
 * params.tools: string[] — tool names that must appear in the transcript
 */
function gradeToolSequence(
  params: Record<string, unknown>,
  toolCalls: ToolCall[]
): GraderResult {
  const required = (params.tools as string[]) ?? [];
  const calledTools = new Set(toolCalls.map((t) => t.name));
  const missing = required.filter((t) => !calledTools.has(t));

  return {
    graderType: "tool-sequence",
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? `All required tools called: ${required.join(", ")}`
        : `Missing tool calls: ${missing.join(", ")}`,
    details: { required, called: [...calledTools], missing },
  };
}

/**
 * tool-params: Check that a specific tool call included expected parameters.
 * Uses substring matching for strings to handle flexible formatting.
 *
 * params.tool: string — tool name
 * params.action: string — action parameter value (optional)
 * params.expected: Record<string, unknown> — expected parameter subset
 */
function gradeToolParams(
  params: Record<string, unknown>,
  toolCalls: ToolCall[]
): GraderResult {
  const toolName = params.tool as string;
  const action = params.action as string | undefined;
  const expected = (params.expected as Record<string, unknown>) ?? {};

  const matchingCalls = toolCalls.filter((t) => {
    if (t.name !== toolName) return false;
    if (action && t.input.action !== action) return false;
    return true;
  });

  if (matchingCalls.length === 0) {
    return {
      graderType: "tool-params",
      passed: false,
      message: `No calls to tool "${toolName}"${action ? ` with action "${action}"` : ""}`,
    };
  }

  // Check if ANY matching call has the expected params
  for (const call of matchingCalls) {
    const allMatch = Object.entries(expected).every(([key, value]) => {
      const actual = call.input[key];
      if (typeof value === "string" && typeof actual === "string") {
        return actual.toLowerCase().includes(value.toLowerCase());
      }
      return JSON.stringify(actual) === JSON.stringify(value);
    });

    if (allMatch) {
      return {
        graderType: "tool-params",
        passed: true,
        message: `Tool "${toolName}" called with expected parameters`,
        details: { expected, actual: call.input },
      };
    }
  }

  return {
    graderType: "tool-params",
    passed: false,
    message: `Tool "${toolName}" called but parameters didn't match`,
    details: { expected, actualCalls: matchingCalls.map((c) => c.input) },
  };
}

/**
 * count: Tool call count is within expected range.
 * params.min: number — minimum tool calls (inclusive)
 * params.max: number — maximum tool calls (inclusive)
 */
function gradeCount(
  params: Record<string, unknown>,
  toolCalls: ToolCall[]
): GraderResult {
  const min = (params.min as number) ?? 0;
  const max = (params.max as number) ?? Infinity;
  const count = toolCalls.length;

  return {
    graderType: "count",
    passed: count >= min && count <= max,
    message:
      count >= min && count <= max
        ? `Tool call count ${count} within range [${min}, ${max}]`
        : `Tool call count ${count} outside range [${min}, ${max}]`,
    details: { count, min, max },
  };
}

/**
 * no-errors: No tool calls returned isError: true.
 */
function gradeNoErrors(toolCalls: ToolCall[]): GraderResult {
  const errorCalls = toolCalls.filter((t) => t.isError);

  return {
    graderType: "no-errors",
    passed: errorCalls.length === 0,
    message:
      errorCalls.length === 0
        ? "No tool errors"
        : `${errorCalls.length} tool call(s) returned errors`,
    details: { errorCount: errorCalls.length },
  };
}
