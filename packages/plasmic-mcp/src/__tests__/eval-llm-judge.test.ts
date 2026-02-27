/**
 * Tests for LLM judge pure functions (P13.5, P13.6).
 *
 * Why these tests matter: parseJudgeResponse is the critical bridge between
 * the LLM's free-text output and the structured quality score used in eval
 * reports. If parsing is wrong, quality scores are wrong, and review flags
 * (judge-disagrees, low-quality) fire on incorrect data. formatTranscriptForJudge
 * controls what the judge sees — malformed summaries lead to poor scoring.
 *
 * These tests cover the exported pure functions. The full runLlmJudge function
 * requires mocking the Anthropic SDK and is not tested here.
 */

import { describe, it, expect } from "vitest";
import {
  parseJudgeResponse,
  formatTranscriptForJudge,
} from "../../evals/graders/llm-judge.js";
import type { TranscriptEntry } from "../../evals/harness/types.js";

// ---------------------------------------------------------------------------
// parseJudgeResponse
// ---------------------------------------------------------------------------
describe("parseJudgeResponse", () => {
  it("parses valid SCORE and RATIONALE", () => {
    const result = parseJudgeResponse("SCORE: 4\nRATIONALE: Good layout and structure");
    expect(result).toEqual({ score: 4, rationale: "Good layout and structure" });
  });

  it("parses score 1 (minimum)", () => {
    const result = parseJudgeResponse("SCORE: 1\nRATIONALE: Failed completely");
    expect(result).toEqual({ score: 1, rationale: "Failed completely" });
  });

  it("parses score 5 (maximum)", () => {
    const result = parseJudgeResponse("SCORE: 5\nRATIONALE: Exceeds expectations");
    expect(result).toEqual({ score: 5, rationale: "Exceeds expectations" });
  });

  it("returns null for score 0 (below range)", () => {
    expect(parseJudgeResponse("SCORE: 0\nRATIONALE: Zero")).toBeNull();
  });

  it("returns null for score 6 (above range)", () => {
    expect(parseJudgeResponse("SCORE: 6\nRATIONALE: Too high")).toBeNull();
  });

  it("P13.6: rejects multi-digit score 10 instead of parsing as 1", () => {
    // Before P13.6, /SCORE:\s*(\d)/ would match "1" from "10",
    // parsing SCORE: 10 as score=1 instead of rejecting it.
    const result = parseJudgeResponse("SCORE: 10\nRATIONALE: Invalid score");
    expect(result).toBeNull();
  });

  it("P13.6: rejects score 99", () => {
    expect(parseJudgeResponse("SCORE: 99\nRATIONALE: Way too high")).toBeNull();
  });

  it("returns null when no SCORE line present", () => {
    expect(parseJudgeResponse("No score here\nJust text")).toBeNull();
  });

  it("provides default rationale when RATIONALE line is missing", () => {
    const result = parseJudgeResponse("SCORE: 3");
    expect(result).toEqual({ score: 3, rationale: "No rationale provided" });
  });

  it("handles multiline rationale", () => {
    const result = parseJudgeResponse(
      "SCORE: 4\nRATIONALE: Good layout.\nNice spacing.\nClean naming."
    );
    expect(result?.rationale).toContain("Good layout");
    expect(result?.rationale).toContain("Clean naming");
  });
});

// ---------------------------------------------------------------------------
// formatTranscriptForJudge
// ---------------------------------------------------------------------------
describe("formatTranscriptForJudge", () => {
  it("formats tool calls with names and status", () => {
    const transcript: TranscriptEntry[] = [
      {
        role: "tool_result",
        content: JSON.stringify({
          name: "node",
          input: { action: "add" },
          result: '{"uuid":"n1"}',
          isError: false,
        }),
        timestamp: Date.now(),
      },
    ];

    const summary = formatTranscriptForJudge(transcript);
    expect(summary).toContain("1.");
    expect(summary).toContain("node.add");
    expect(summary).toContain("OK");
  });

  it("marks error tool calls as ERROR", () => {
    const transcript: TranscriptEntry[] = [
      {
        role: "tool_result",
        content: JSON.stringify({
          name: "inspect",
          input: { action: "tree" },
          result: "Error: not found",
          isError: true,
        }),
        timestamp: Date.now(),
      },
    ];

    const summary = formatTranscriptForJudge(transcript);
    expect(summary).toContain("ERROR");
  });

  it("skips non-tool_result entries", () => {
    const transcript: TranscriptEntry[] = [
      { role: "user", content: "Build a hero section", timestamp: Date.now() },
      { role: "assistant", content: "OK", timestamp: Date.now() },
    ];

    const summary = formatTranscriptForJudge(transcript);
    expect(summary).toBe("No tool calls recorded.");
  });

  it("handles empty transcript", () => {
    expect(formatTranscriptForJudge([])).toBe("No tool calls recorded.");
  });

  it("handles unparseable tool results", () => {
    const transcript: TranscriptEntry[] = [
      { role: "tool_result", content: "not json", timestamp: Date.now() },
    ];

    const summary = formatTranscriptForJudge(transcript);
    expect(summary).toContain("unparseable");
  });

  it("numbers tool calls sequentially", () => {
    const transcript: TranscriptEntry[] = [
      {
        role: "tool_result",
        content: JSON.stringify({ name: "a", input: {}, result: "{}", isError: false }),
        timestamp: Date.now(),
      },
      {
        role: "tool_result",
        content: JSON.stringify({ name: "b", input: {}, result: "{}", isError: false }),
        timestamp: Date.now(),
      },
    ];

    const summary = formatTranscriptForJudge(transcript);
    expect(summary).toContain("1.");
    expect(summary).toContain("2.");
  });
});
