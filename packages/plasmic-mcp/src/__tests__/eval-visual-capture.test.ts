/**
 * Tests for visual capture utilities (V10, VE4) and runner transcript extraction.
 *
 * Why these tests matter: component-level navigation depends on correctly
 * extracting componentUuids from conversation transcripts. If extraction
 * fails, visual capture falls back to project-level URLs which give the
 * LLM judge less focused context. These tests verify extraction works for
 * all tool call patterns (input params, creation results, mixed scenarios).
 *
 * Also tests needsMobileCapture() which determines whether mobile viewport
 * screenshots are needed based on scenario keywords.
 */

import { describe, it, expect } from "vitest";
import { extractLastComponentUuid } from "../../evals/harness/runner.js";
import { needsMobileCapture } from "../../evals/visual/capture.js";
import type { TranscriptEntry } from "../../evals/harness/types.js";

/** Helper to create a tool_result transcript entry */
function makeToolResult(data: {
  tool_use_id?: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError?: boolean;
}): TranscriptEntry {
  return {
    role: "tool_result",
    content: JSON.stringify({
      tool_use_id: data.tool_use_id ?? "call_001",
      name: data.name,
      input: data.input,
      result: data.result,
      isError: data.isError ?? false,
    }),
    timestamp: Date.now(),
  };
}

/** Helper to create a user or assistant transcript entry */
function makeEntry(
  role: "user" | "assistant",
  content: string
): TranscriptEntry {
  return { role, content, timestamp: Date.now() };
}

describe("extractLastComponentUuid", () => {
  it("returns null for empty transcript", () => {
    expect(extractLastComponentUuid([])).toBeNull();
  });

  it("returns null when no tool_result entries exist", () => {
    const transcript: TranscriptEntry[] = [
      makeEntry("user", "Create a button"),
      makeEntry("assistant", "I'll create a button for you."),
    ];
    expect(extractLastComponentUuid(transcript)).toBeNull();
  });

  it("returns null when no componentUuid is present in any tool call", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "project",
        input: { action: "list" },
        result: JSON.stringify([{ id: "proj1" }]),
      }),
    ];
    expect(extractLastComponentUuid(transcript)).toBeNull();
  });

  it("extracts componentUuid from tool call input params", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "inspect",
        input: { action: "tree", componentUuid: "comp-uuid-123" },
        result: JSON.stringify({ tag: "div" }),
      }),
    ];
    expect(extractLastComponentUuid(transcript)).toBe("comp-uuid-123");
  });

  it("returns the LAST componentUuid when multiple tool calls reference different components", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "inspect",
        input: { action: "tree", componentUuid: "first-comp" },
        result: "{}",
      }),
      makeToolResult({
        name: "node",
        input: {
          action: "update-styles",
          componentUuid: "second-comp",
          nodeRef: "node1",
          styles: { color: "red" },
        },
        result: "{}",
      }),
      makeToolResult({
        name: "variant",
        input: {
          action: "list",
          componentUuid: "third-comp",
        },
        result: "[]",
      }),
    ];
    expect(extractLastComponentUuid(transcript)).toBe("third-comp");
  });

  it("extracts componentUuid from component.create result", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "component",
        input: { action: "create", name: "MyCard" },
        result: JSON.stringify({
          success: true,
          name: "MyCard",
          uuid: "new-comp-uuid",
        }),
      }),
    ];
    expect(extractLastComponentUuid(transcript)).toBe("new-comp-uuid");
  });

  it("extracts componentUuid from component.create-page result", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "component",
        input: { action: "create-page", name: "About", path: "/about" },
        result: JSON.stringify({
          success: true,
          name: "About",
          uuid: "page-uuid-456",
          path: "/about",
        }),
      }),
    ];
    expect(extractLastComponentUuid(transcript)).toBe("page-uuid-456");
  });

  it("extracts componentUuid from component.clone result", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "component",
        input: { action: "clone", sourceUuid: "original-uuid" },
        result: JSON.stringify({
          success: true,
          name: "MyCard (copy)",
          uuid: "cloned-uuid-789",
        }),
      }),
    ];
    expect(extractLastComponentUuid(transcript)).toBe("cloned-uuid-789");
  });

  it("prefers input componentUuid over creation result when both exist in sequence", () => {
    const transcript: TranscriptEntry[] = [
      // First: create a component (UUID in result)
      makeToolResult({
        name: "component",
        input: { action: "create", name: "Card" },
        result: JSON.stringify({ success: true, uuid: "created-uuid" }),
      }),
      // Then: add a node to it (UUID in input)
      makeToolResult({
        name: "node",
        input: {
          action: "add",
          componentUuid: "created-uuid",
          parentRef: "root",
          child: { type: "element", tag: "h1" },
        },
        result: "{}",
      }),
    ];
    // Both point to the same component; last one wins (from input)
    expect(extractLastComponentUuid(transcript)).toBe("created-uuid");
  });

  it("handles truncated or invalid result JSON gracefully", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "component",
        input: { action: "create", name: "Card" },
        result: '{"success":true,"name":"Card","uuid":"abc', // Truncated JSON
      }),
    ];
    // Should not crash; returns null since result can't be parsed
    expect(extractLastComponentUuid(transcript)).toBeNull();
  });

  it("ignores error results from component creation", () => {
    const transcript: TranscriptEntry[] = [
      makeToolResult({
        name: "component",
        input: { action: "create", name: "Card" },
        result: JSON.stringify({ error: "Component already exists" }),
        isError: true,
      }),
    ];
    // isError=true means we skip parsing the result
    expect(extractLastComponentUuid(transcript)).toBeNull();
  });

  it("handles mixed entry types (user, assistant, tool_result)", () => {
    const transcript: TranscriptEntry[] = [
      makeEntry("user", "Create a hero section"),
      makeEntry("assistant", '[{"type":"tool_use","name":"component",...}]'),
      makeToolResult({
        name: "component",
        input: { action: "create", name: "Hero" },
        result: JSON.stringify({ success: true, uuid: "hero-uuid" }),
      }),
      makeEntry("assistant", "I created the Hero component."),
      makeToolResult({
        name: "node",
        input: {
          action: "add",
          componentUuid: "hero-uuid",
          parentRef: "root",
          child: { type: "element", tag: "section" },
        },
        result: "{}",
      }),
      makeEntry("assistant", "Done! The Hero section is ready."),
    ];
    expect(extractLastComponentUuid(transcript)).toBe("hero-uuid");
  });

  it("skips unparseable transcript entries without crashing", () => {
    const transcript: TranscriptEntry[] = [
      { role: "tool_result", content: "not valid json at all", timestamp: 0 },
      makeToolResult({
        name: "inspect",
        input: { action: "tree", componentUuid: "valid-uuid" },
        result: "{}",
      }),
    ];
    expect(extractLastComponentUuid(transcript)).toBe("valid-uuid");
  });
});

describe("needsMobileCapture", () => {
  it("returns false for non-responsive scenario", () => {
    expect(needsMobileCapture("design-list-tokens", "List all color tokens")).toBe(false);
  });

  it("returns true when scenario ID contains 'mobile'", () => {
    expect(needsMobileCapture("mobile-layout-test", "Test layout")).toBe(true);
  });

  it("returns true when scenario ID contains 'responsive'", () => {
    expect(needsMobileCapture("responsive-grid", "Build a grid")).toBe(true);
  });

  it("returns true when scenario ID contains 'screen-variant'", () => {
    expect(needsMobileCapture("create-screen-variant", "Create a breakpoint")).toBe(true);
  });

  it("returns true when scenario ID contains 'breakpoint'", () => {
    expect(needsMobileCapture("add-breakpoint", "Add a responsive breakpoint")).toBe(true);
  });

  it("returns true when description contains 'mobile'", () => {
    expect(needsMobileCapture("some-test", "Build a mobile-friendly layout")).toBe(true);
  });

  it("returns true when description contains 'responsive'", () => {
    expect(needsMobileCapture("layout-test", "Create a responsive navigation bar")).toBe(true);
  });

  it("returns true when description contains 'screen variant'", () => {
    expect(needsMobileCapture("variant-test", "Add a screen variant for tablet")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(needsMobileCapture("MOBILE-test", "Testing RESPONSIVE layout")).toBe(true);
  });
});
