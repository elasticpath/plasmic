/**
 * Tests for transcript-based graders (P3.6).
 *
 * Why these tests matter: transcript graders are the first line of defense
 * in the eval system — they validate Claude called the right tools with
 * the right parameters without any MCP calls. If these graders misfire,
 * scenarios get false passes (missing tool calls ignored) or false fails
 * (correct calls rejected), corrupting eval results and masking regressions.
 *
 * Covers all 4 transcript grader types: tool-sequence, tool-params, count, no-errors.
 */

import { describe, it, expect } from "vitest";
import { runTranscriptGrader } from "../../evals/graders/transcript-check.js";
import type {
  GraderConfig,
  TranscriptEntry,
} from "../../evals/harness/types.js";

/** Helper to create a tool_result transcript entry */
function makeToolResult(data: {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}): TranscriptEntry {
  return {
    role: "tool_result",
    content: JSON.stringify({
      name: data.name,
      input: data.input,
      result: data.result ?? "{}",
      isError: data.isError ?? false,
    }),
    timestamp: Date.now(),
  };
}

/** Helper to create a user or assistant entry */
function makeEntry(
  role: "user" | "assistant",
  content: string
): TranscriptEntry {
  return { role, content, timestamp: Date.now() };
}

// ---------------------------------------------------------------------------
// tool-sequence grader
// ---------------------------------------------------------------------------
describe("tool-sequence grader", () => {
  it("passes when all required tools were called", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
      makeToolResult({ name: "node", input: { action: "add" } }),
      makeToolResult({ name: "design", input: { action: "list-tokens" } }),
    ];
    const config: GraderConfig = {
      type: "tool-sequence",
      params: { tools: ["inspect", "node"] },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
    expect(result.graderType).toBe("tool-sequence");
    expect(result.message).toContain("All required tools called");
  });

  it("fails when required tools are missing", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
    ];
    const config: GraderConfig = {
      type: "tool-sequence",
      params: { tools: ["inspect", "node", "variant"] },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("node");
    expect(result.message).toContain("variant");
    expect(result.details?.missing).toEqual(["node", "variant"]);
  });

  it("passes with empty required tools list", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
    ];
    const config: GraderConfig = {
      type: "tool-sequence",
      params: { tools: [] },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });

  it("is order-independent (spec SE1)", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "node", input: { action: "add" } }),
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
    ];
    const config: GraderConfig = {
      type: "tool-sequence",
      params: { tools: ["inspect", "node"] },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });

  it("handles duplicate tool calls correctly", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "node", input: { action: "add" } }),
      makeToolResult({ name: "node", input: { action: "update-styles" } }),
    ];
    const config: GraderConfig = {
      type: "tool-sequence",
      params: { tools: ["node"] },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });

  it("reports called tools in details", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
      makeToolResult({ name: "component", input: { action: "list" } }),
    ];
    const config: GraderConfig = {
      type: "tool-sequence",
      params: { tools: ["inspect"] },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.details?.called).toContain("inspect");
    expect(result.details?.called).toContain("component");
  });
});

// ---------------------------------------------------------------------------
// tool-params grader
// ---------------------------------------------------------------------------
describe("tool-params grader", () => {
  it("passes when tool call has expected params", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "node",
        input: { action: "update-styles", nodeRef: "root", styles: { color: "red" } },
      }),
    ];
    const config: GraderConfig = {
      type: "tool-params",
      params: {
        tool: "node",
        action: "update-styles",
        expected: { nodeRef: "root" },
      },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
    expect(result.graderType).toBe("tool-params");
  });

  it("fails when tool was not called", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
    ];
    const config: GraderConfig = {
      type: "tool-params",
      params: { tool: "node", expected: { action: "add" } },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('No calls to tool "node"');
  });

  it("fails when tool called but params don't match", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "node",
        input: { action: "add", nodeRef: "wrong-ref" },
      }),
    ];
    const config: GraderConfig = {
      type: "tool-params",
      params: {
        tool: "node",
        expected: { nodeRef: "correct-ref" },
      },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("parameters didn't match");
  });

  it("uses case-insensitive substring matching for strings", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "design",
        input: { action: "create-token", name: "My Primary Color Token" },
      }),
    ];
    const config: GraderConfig = {
      type: "tool-params",
      params: {
        tool: "design",
        expected: { name: "primary color" },
      },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });

  it("uses JSON equality for non-string params", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "node",
        input: { action: "update-styles", styles: { color: "red", padding: "10px" } },
      }),
    ];
    const config: GraderConfig = {
      type: "tool-params",
      params: {
        tool: "node",
        expected: { styles: { color: "red", padding: "10px" } },
      },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });

  it("filters by action when specified", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "node",
        input: { action: "add", nodeRef: "root" },
      }),
      makeToolResult({
        name: "node",
        input: { action: "update-styles", nodeRef: "btn" },
      }),
    ];
    const config: GraderConfig = {
      type: "tool-params",
      params: {
        tool: "node",
        action: "update-styles",
        expected: { nodeRef: "btn" },
      },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });

  it("fails when action filter matches but params don't", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "node",
        input: { action: "update-styles", nodeRef: "wrong" },
      }),
    ];
    const config: GraderConfig = {
      type: "tool-params",
      params: {
        tool: "node",
        action: "update-styles",
        expected: { nodeRef: "correct" },
      },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(false);
  });

  it("passes if ANY matching call has the expected params", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "node",
        input: { action: "add", nodeRef: "wrong" },
      }),
      makeToolResult({
        name: "node",
        input: { action: "add", nodeRef: "correct" },
      }),
    ];
    const config: GraderConfig = {
      type: "tool-params",
      params: {
        tool: "node",
        expected: { nodeRef: "correct" },
      },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });

  it("includes actual call input in details on match", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "inspect",
        input: { action: "tree", componentUuid: "abc" },
      }),
    ];
    const config: GraderConfig = {
      type: "tool-params",
      params: { tool: "inspect", expected: { componentUuid: "abc" } },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
    expect(result.details?.actual).toEqual({ action: "tree", componentUuid: "abc" });
  });
});

// ---------------------------------------------------------------------------
// count grader
// ---------------------------------------------------------------------------
describe("count grader", () => {
  it("passes when count is within range", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "a", input: {} }),
      makeToolResult({ name: "b", input: {} }),
      makeToolResult({ name: "c", input: {} }),
    ];
    const config: GraderConfig = {
      type: "count",
      params: { min: 2, max: 5 },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
    expect(result.graderType).toBe("count");
    expect(result.details?.count).toBe(3);
  });

  it("fails when count is below minimum", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "a", input: {} }),
    ];
    const config: GraderConfig = {
      type: "count",
      params: { min: 3, max: 10 },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("outside range");
  });

  it("fails when count exceeds maximum", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "a", input: {} }),
      makeToolResult({ name: "b", input: {} }),
      makeToolResult({ name: "c", input: {} }),
    ];
    const config: GraderConfig = {
      type: "count",
      params: { min: 1, max: 2 },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(false);
  });

  it("defaults min to 0 and max to Infinity", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "a", input: {} }),
    ];
    const config: GraderConfig = {
      type: "count",
      params: {},
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });

  it("passes for exact boundary values (inclusive)", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "a", input: {} }),
      makeToolResult({ name: "b", input: {} }),
    ];
    const config: GraderConfig = {
      type: "count",
      params: { min: 2, max: 2 },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// no-errors grader
// ---------------------------------------------------------------------------
describe("no-errors grader", () => {
  it("passes when no tool calls returned errors", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
      makeToolResult({ name: "node", input: { action: "add" } }),
    ];
    const config: GraderConfig = {
      type: "no-errors",
      params: {},
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
    expect(result.graderType).toBe("no-errors");
    expect(result.message).toBe("No tool errors");
  });

  it("fails when tool calls returned errors", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
      makeToolResult({
        name: "node",
        input: { action: "add" },
        isError: true,
      }),
    ];
    const config: GraderConfig = {
      type: "no-errors",
      params: {},
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("1 tool call(s) returned errors");
    expect(result.details?.errorCount).toBe(1);
  });

  it("counts multiple errors correctly", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({ name: "a", input: {}, isError: true }),
      makeToolResult({ name: "b", input: {} }),
      makeToolResult({ name: "c", input: {}, isError: true }),
      makeToolResult({ name: "d", input: {}, isError: true }),
    ];
    const config: GraderConfig = {
      type: "no-errors",
      params: {},
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(false);
    expect(result.details?.errorCount).toBe(3);
  });

  it("passes with empty transcript", () => {
    const config: GraderConfig = {
      type: "no-errors",
      params: {},
    };

    const result = runTranscriptGrader(config, []);
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: transcript parsing
// ---------------------------------------------------------------------------
describe("transcript parsing edge cases", () => {
  it("skips non-tool_result entries", () => {
    const transcript: TranscriptEntry[] = [
      makeEntry("user", "Do something"),
      makeEntry("assistant", "OK"),
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
    ];
    const config: GraderConfig = {
      type: "count",
      params: { min: 1, max: 1 },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
    expect(result.details?.count).toBe(1);
  });

  it("skips unparseable tool_result entries", () => {
    const transcript: TranscriptEntry[] = [
      { role: "tool_result", content: "not json", timestamp: Date.now() },
      makeToolResult({ name: "inspect", input: { action: "tree" } }),
    ];
    const config: GraderConfig = {
      type: "count",
      params: { min: 1, max: 1 },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(true);
  });

  it("returns failure for unknown grader type", () => {
    const config: GraderConfig = {
      type: "unknown-type" as any,
      params: {},
    };

    const result = runTranscriptGrader(config, []);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("Unknown transcript grader");
  });

  it("handles tool result with missing name field", () => {
    const transcript: TranscriptEntry[] = [
      {
        role: "tool_result",
        content: JSON.stringify({ input: {}, result: "{}" }),
        timestamp: Date.now(),
      },
    ];
    const config: GraderConfig = {
      type: "tool-sequence",
      params: { tools: ["inspect"] },
    };

    const result = runTranscriptGrader(config, transcript);
    expect(result.passed).toBe(false);
    // The extracted tool has name "" (empty string), so "inspect" is still missing
    expect(result.details?.missing).toEqual(["inspect"]);
  });
});
