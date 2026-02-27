/**
 * Tests for state-based graders (P3.7).
 *
 * Why these tests matter: state graders are the authoritative pass/fail
 * determinant in the eval system (Tier 1). They query the MCP server's
 * actual project state to verify Claude's tool calls produced the expected
 * results. If state graders misfire, the eval system either:
 * - False passes: lets broken scenarios through to CI
 * - False fails: blocks valid results and wastes reviewer time
 *
 * These tests mock the McpEvalClient to verify all 4 state grader types
 * (existence, property, structure, data) handle both happy and error paths
 * correctly, including componentName-based resolution.
 */

import { describe, it, expect, vi } from "vitest";
import { runStateGrader } from "../../evals/graders/state-check.js";
import type { GraderConfig } from "../../evals/harness/types.js";

/** Create a mock McpEvalClient with controlled callTool responses */
function mockMcpClient(
  responses: Record<string, { content: string; isError: boolean }>
) {
  return {
    callTool: vi.fn(
      async (
        name: string,
        params: Record<string, unknown>
      ): Promise<{ content: string; isError: boolean }> => {
        // Build a key from tool name + action for more specific mocking
        const action = params.action as string | undefined;
        const key = action ? `${name}.${action}` : name;

        if (responses[key]) return responses[key];
        if (responses[name]) return responses[name];

        return { content: "Not found", isError: true };
      }
    ),
  } as any;
}

// ---------------------------------------------------------------------------
// existence grader — component/page
// ---------------------------------------------------------------------------
describe("existence grader — component/page", () => {
  it("passes when component is found by exact name (case-insensitive)", () => {
    const client = mockMcpClient({
      "component.list": {
        content: JSON.stringify({
          pages: [{ name: "Home Page", uuid: "p1" }],
          components: [{ name: "Hero Card", uuid: "c1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "component", name: "hero card" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
      expect(result.graderType).toBe("existence");
      expect(result.message).toContain('Found component matching "hero card"');
    });
  });

  it("fails with exact matching when name is a substring (P13.2)", () => {
    const client = mockMcpClient({
      "component.list": {
        content: JSON.stringify({
          pages: [],
          components: [{ name: "CreditCard", uuid: "c1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "component", name: "Card" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      // "Card" should NOT match "CreditCard" with exact matching
    });
  });

  it("passes with substring matching when exact: false", () => {
    const client = mockMcpClient({
      "component.list": {
        content: JSON.stringify({
          pages: [],
          components: [{ name: "My Hero Card", uuid: "c1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "component", name: "hero card", exact: false },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("fails when component is not found", () => {
    const client = mockMcpClient({
      "component.list": {
        content: JSON.stringify({
          pages: [],
          components: [{ name: "Header", uuid: "c1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "component", name: "footer" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain('No component found matching "footer"');
      expect(result.details?.availableNames).toEqual(["Header"]);
    });
  });

  it("finds pages when entityType is 'page'", () => {
    const client = mockMcpClient({
      "component.list": {
        content: JSON.stringify({
          pages: [{ name: "About Page", uuid: "p1" }],
          components: [],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "page", name: "About Page" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("P13.3: page search does not match components", () => {
    const client = mockMcpClient({
      "component.list": {
        content: JSON.stringify({
          pages: [{ name: "Home", uuid: "p1" }],
          components: [{ name: "Contact", uuid: "c1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "page", name: "Contact" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      // "Contact" is a component, not a page — should not be found
      expect(result.details?.availableNames).toEqual(["Home"]);
    });
  });

  it("P13.3: component search does not match pages", () => {
    const client = mockMcpClient({
      "component.list": {
        content: JSON.stringify({
          pages: [{ name: "About", uuid: "p1" }],
          components: [{ name: "Header", uuid: "c1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "component", name: "About" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      // "About" is a page, not a component
      expect(result.details?.availableNames).toEqual(["Header"]);
    });
  });

  it("handles component list error", () => {
    const client = mockMcpClient({
      "component.list": {
        content: "Error in component.list: project not loaded",
        isError: true,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "component", name: "anything" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("Failed to list components");
    });
  });
});

// ---------------------------------------------------------------------------
// existence grader — node
// ---------------------------------------------------------------------------
describe("existence grader — node", () => {
  it("passes when node is found in the tree (exact, case-insensitive)", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({
          name: "root",
          children: [
            { name: "Header Section", children: [] },
            { name: "Content Area", children: [{ name: "Target Button", children: [] }] },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "node", name: "target button", componentUuid: "comp-1" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
      expect(result.message).toContain('Found node matching "target button"');
    });
  });

  it("P13.2: node exact matching rejects substring matches", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({
          name: "root",
          children: [
            { name: "SubmitButton", children: [] },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "node", name: "Button", componentUuid: "comp-1" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      // "Button" should NOT match "SubmitButton" with default exact matching
    });
  });

  it("fails when node is not found in the tree", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({
          name: "root",
          children: [{ name: "Header", children: [] }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "node", name: "footer", componentUuid: "comp-1" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
    });
  });

  it("fails when componentUuid is missing", () => {
    const client = mockMcpClient({});
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "node", name: "anything" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("requires componentUuid");
    });
  });

  it("uses unlimited maxChars and maxDepth for full tree search", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({ name: "root", children: [] }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "node", name: "x", componentUuid: "c1" },
    };

    return runStateGrader(config, client).then(() => {
      const call = client.callTool.mock.calls[0];
      expect(call[1]).toMatchObject({ maxDepth: -1, maxChars: -1 });
    });
  });
});

// ---------------------------------------------------------------------------
// existence grader — token
// ---------------------------------------------------------------------------
describe("existence grader — token", () => {
  it("passes when token is found (exact, case-insensitive)", () => {
    const client = mockMcpClient({
      "design.list-tokens": {
        content: JSON.stringify({
          tokens: [
            { name: "Primary Blue", value: "#0066cc" },
            { name: "Error Red", value: "#cc0000" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "token", name: "primary blue" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("fails when token is not found", () => {
    const client = mockMcpClient({
      "design.list-tokens": {
        content: JSON.stringify({ tokens: [{ name: "Primary", value: "blue" }] }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "token", name: "secondary" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
    });
  });

  it("handles array-format token response", () => {
    const client = mockMcpClient({
      "design.list-tokens": {
        content: JSON.stringify([
          { name: "Spacing Small", value: "8px" },
        ]),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "token", name: "Spacing Small" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("passes tokenType filter through to tool call", () => {
    const client = mockMcpClient({
      "design.list-tokens": {
        content: JSON.stringify({ tokens: [{ name: "Red", value: "#f00" }] }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "token", name: "red", tokenType: "Color" },
    };

    return runStateGrader(config, client).then(() => {
      const call = client.callTool.mock.calls[0];
      expect(call[1]).toMatchObject({ tokenType: "Color" });
    });
  });
});

// ---------------------------------------------------------------------------
// existence grader — variant
// ---------------------------------------------------------------------------
describe("existence grader — variant", () => {
  it("passes when variant is found in styleVariants (exact, case-insensitive)", () => {
    const client = mockMcpClient({
      "variant.list": {
        content: JSON.stringify({
          styleVariants: [
            { name: "Hover", uuid: "sv1", selectors: [":hover"] },
          ],
          variantGroups: [],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "variant", name: "hover", componentUuid: "c1" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("passes when variant is found inside variantGroups (exact, case-insensitive)", () => {
    const client = mockMcpClient({
      "variant.list": {
        content: JSON.stringify({
          styleVariants: [],
          variantGroups: [
            {
              name: "Size",
              variants: [
                { name: "Small", uuid: "v1" },
                { name: "Large", uuid: "v2" },
              ],
            },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "variant", name: "large", componentUuid: "c1" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("fails when variant not found and componentUuid missing", () => {
    const client = mockMcpClient({});
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "variant", name: "hover" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("requires componentUuid");
    });
  });
});

// ---------------------------------------------------------------------------
// existence grader — mixin
// ---------------------------------------------------------------------------
describe("existence grader — mixin", () => {
  it("passes when mixin is found", () => {
    const client = mockMcpClient({
      "design.list-mixins": {
        content: JSON.stringify({
          mixins: [{ name: "Card Shadow", uuid: "m1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "mixin", name: "card shadow" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("handles array-format mixin response", () => {
    const client = mockMcpClient({
      "design.list-mixins": {
        content: JSON.stringify([{ name: "Card Shadow", uuid: "m1" }]),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "mixin", name: "Card Shadow" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// existence grader — unknown entity type
// ---------------------------------------------------------------------------
describe("existence grader — edge cases", () => {
  it("fails for unknown entity type", () => {
    const client = mockMcpClient({});
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "unknown", name: "x" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Unknown entity type: "unknown"');
    });
  });

  it("handles MCP call exception gracefully", () => {
    const client = {
      callTool: vi.fn(async () => {
        throw new Error("Connection refused");
      }),
    } as any;
    const config: GraderConfig = {
      type: "existence",
      params: { entityType: "component", name: "x" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("Existence check failed");
      expect(result.message).toContain("Connection refused");
    });
  });
});

// ---------------------------------------------------------------------------
// property grader
// ---------------------------------------------------------------------------
describe("property grader", () => {
  it("passes when all styles match (case-insensitive substring)", () => {
    const client = mockMcpClient({
      "inspect.node": {
        content: JSON.stringify({
          styles: { color: "#FF0000", "padding-top": "16px" },
          text: "",
          attrs: {},
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentUuid: "c1",
        nodeRef: "button-1",
        styles: { color: "ff0000" },
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
      expect(result.message).toBe("All property checks passed");
    });
  });

  it("P13.1: handles numeric style values without TypeError", () => {
    const client = mockMcpClient({
      "inspect.node": {
        content: JSON.stringify({
          styles: { "line-height": 1.5, opacity: 0.8 },
          text: "",
          attrs: {},
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentUuid: "c1",
        nodeRef: "text-1",
        styles: { "line-height": "1.5" },
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
      // Before P13.1, this would throw TypeError: actual.toLowerCase is not a function
    });
  });

  it("P13.1: handles falsy numeric style value (0)", () => {
    const client = mockMcpClient({
      "inspect.node": {
        content: JSON.stringify({
          styles: { opacity: 0 },
          text: "",
          attrs: {},
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentUuid: "c1",
        nodeRef: "hidden",
        styles: { opacity: "0" },
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
      // 0 is falsy but should be coerced to "0" via String(), not treated as missing
    });
  });

  it("fails when style value doesn't match", () => {
    const client = mockMcpClient({
      "inspect.node": {
        content: JSON.stringify({
          styles: { color: "blue" },
          text: "",
          attrs: {},
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentUuid: "c1",
        nodeRef: "btn",
        styles: { color: "red" },
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Style "color"');
      expect(result.message).toContain('expected "red"');
    });
  });

  it("passes when text matches (substring, case-insensitive)", () => {
    const client = mockMcpClient({
      "inspect.node": {
        content: JSON.stringify({
          styles: {},
          text: "Welcome to our Amazing Website",
          attrs: {},
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentUuid: "c1",
        nodeRef: "heading",
        text: "amazing website",
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("fails when text doesn't match", () => {
    const client = mockMcpClient({
      "inspect.node": {
        content: JSON.stringify({
          styles: {},
          text: "Hello World",
          attrs: {},
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentUuid: "c1",
        nodeRef: "heading",
        text: "goodbye",
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("Text:");
    });
  });

  it("passes when attrs match (coerced to string, case-insensitive)", () => {
    const client = mockMcpClient({
      "inspect.node": {
        content: JSON.stringify({
          styles: {},
          text: "",
          attrs: { href: "https://example.com/page", target: "_blank" },
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentUuid: "c1",
        nodeRef: "link",
        attrs: { href: "example.com" },
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("accumulates multiple failures", () => {
    const client = mockMcpClient({
      "inspect.node": {
        content: JSON.stringify({
          styles: { color: "blue" },
          text: "Wrong text",
          attrs: { href: "wrong" },
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentUuid: "c1",
        nodeRef: "link",
        styles: { color: "red" },
        text: "Correct text",
        attrs: { href: "correct" },
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      const failures = result.details?.failures as string[];
      expect(failures).toHaveLength(3);
    });
  });

  it("fails when componentUuid and componentName are both missing", () => {
    const client = mockMcpClient({});
    const config: GraderConfig = {
      type: "property",
      params: { nodeRef: "btn" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("requires componentUuid");
    });
  });
});

// ---------------------------------------------------------------------------
// property grader — componentName resolution
// ---------------------------------------------------------------------------
describe("property grader — componentName resolution", () => {
  it("resolves componentUuid from componentName", () => {
    const client = mockMcpClient({
      "component.list": {
        content: JSON.stringify({
          pages: [],
          components: [
            { name: "My Card Component", uuid: "resolved-uuid" },
          ],
        }),
        isError: false,
      },
      "inspect.node": {
        content: JSON.stringify({
          styles: { color: "red" },
          text: "",
          attrs: {},
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentName: "My Card Component",
        nodeRef: "heading",
        styles: { color: "red" },
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
      // Verify it called component.list to resolve the name
      expect(client.callTool).toHaveBeenCalledWith("component", { action: "list" });
      // Verify it used the resolved UUID for inspect
      const inspectCall = client.callTool.mock.calls.find(
        (c: any) => c[0] === "inspect"
      );
      expect(inspectCall?.[1].componentUuid).toBe("resolved-uuid");
    });
  });

  it("fails when componentName doesn't match any component", () => {
    const client = mockMcpClient({
      "component.list": {
        content: JSON.stringify({
          pages: [],
          components: [{ name: "Header", uuid: "h1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "property",
      params: {
        componentName: "nonexistent",
        nodeRef: "btn",
        styles: { color: "red" },
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("nonexistent");
    });
  });
});

// ---------------------------------------------------------------------------
// structure grader
// ---------------------------------------------------------------------------
describe("structure grader", () => {
  it("passes when child count is within range", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({
          name: "root",
          children: [
            { name: "child1", tag: "div" },
            { name: "child2", tag: "span" },
            { name: "child3", tag: "p" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "structure",
      params: { componentUuid: "c1", minChildren: 2, maxChildren: 5 },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
      expect(result.message).toBe("Structure check passed");
    });
  });

  it("fails when too few children", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({
          name: "root",
          children: [{ name: "only-child", tag: "div" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "structure",
      params: { componentUuid: "c1", minChildren: 3 },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("at least 3 children");
    });
  });

  it("fails when too many children", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({
          name: "root",
          children: [
            { name: "a", tag: "div" },
            { name: "b", tag: "div" },
            { name: "c", tag: "div" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "structure",
      params: { componentUuid: "c1", maxChildren: 2 },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("at most 2 children");
    });
  });

  it("passes when expected childTags are found (case-insensitive)", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({
          name: "root",
          children: [
            { name: "img", tag: "img" },
            { name: "heading", tag: "H1" },
            { name: "paragraph", tag: "P" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "structure",
      params: { componentUuid: "c1", childTags: ["img", "h1"] },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("fails when expected childTags are missing", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({
          name: "root",
          children: [{ name: "heading", tag: "h1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "structure",
      params: { componentUuid: "c1", childTags: ["h1", "button"] },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain('"button"');
    });
  });

  it("uses subtree action when nodeRef is provided", () => {
    const client = mockMcpClient({
      "inspect.subtree": {
        content: JSON.stringify({
          name: "section",
          children: [{ name: "child", tag: "div" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "structure",
      params: { componentUuid: "c1", nodeRef: "section-1", minChildren: 1 },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
      const call = client.callTool.mock.calls[0];
      expect(call[1].action).toBe("subtree");
      expect(call[1].nodeRef).toBe("section-1");
    });
  });

  it("fails when componentUuid and componentName both missing", () => {
    const client = mockMcpClient({});
    const config: GraderConfig = {
      type: "structure",
      params: { minChildren: 1 },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("requires componentUuid");
    });
  });

  it("uses type field as fallback for tag", () => {
    const client = mockMcpClient({
      "inspect.summary": {
        content: JSON.stringify({
          name: "root",
          children: [
            { name: "comp-instance", type: "MyButton" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "structure",
      params: { componentUuid: "c1", childTags: ["MyButton"] },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// data grader — queries
// ---------------------------------------------------------------------------
describe("data grader — queries", () => {
  it("passes when query count meets minimum", () => {
    const client = mockMcpClient({
      "data.list-queries": {
        content: JSON.stringify({
          queries: [
            { name: "getProducts", uuid: "q1" },
            { name: "getCategories", uuid: "q2" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: { componentUuid: "c1", checkType: "queries", minCount: 2 },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
      expect(result.message).toContain("Found 2 queries (expected >= 2)");
    });
  });

  it("fails when not enough queries", () => {
    const client = mockMcpClient({
      "data.list-queries": {
        content: JSON.stringify({ queries: [] }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: { componentUuid: "c1", checkType: "queries", minCount: 1 },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("Found 0 queries (expected >= 1)");
    });
  });

  it("defaults minCount to 1", () => {
    const client = mockMcpClient({
      "data.list-queries": {
        content: JSON.stringify({ queries: [{ name: "q1", uuid: "q1" }] }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: { componentUuid: "c1", checkType: "queries" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("handles array-format query response", () => {
    const client = mockMcpClient({
      "data.list-queries": {
        content: JSON.stringify([{ name: "q1", uuid: "q1" }]),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: { componentUuid: "c1", checkType: "queries" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("P13.9: passes when named query exists", () => {
    const client = mockMcpClient({
      "data.list-queries": {
        content: JSON.stringify({
          queries: [
            { name: "fetchUsers", queryType: "dataQuery", uuid: "q1" },
            { name: "fetchProducts", queryType: "serverQuery", uuid: "q2" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: { componentUuid: "c1", checkType: "queries", name: "fetchUsers" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("P13.9: fails when named query does not exist", () => {
    const client = mockMcpClient({
      "data.list-queries": {
        content: JSON.stringify({
          queries: [{ name: "fetchProducts", uuid: "q1" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: { componentUuid: "c1", checkType: "queries", name: "fetchUsers" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain('No query found with name "fetchUsers"');
    });
  });

  it("P13.9: validates queryType on named query", () => {
    const client = mockMcpClient({
      "data.list-queries": {
        content: JSON.stringify({
          queries: [
            { name: "fetchUsers", queryType: "dataQuery", uuid: "q1" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: {
        componentUuid: "c1",
        checkType: "queries",
        name: "fetchUsers",
        queryType: "serverQuery",
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Query "fetchUsers" has type "dataQuery", expected "serverQuery"');
    });
  });

  it("P13.9: passes when queryType matches", () => {
    const client = mockMcpClient({
      "data.list-queries": {
        content: JSON.stringify({
          queries: [
            { name: "fetchUsers", queryType: "dataQuery", uuid: "q1" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: {
        componentUuid: "c1",
        checkType: "queries",
        name: "fetchUsers",
        queryType: "dataQuery",
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// data grader — interactions
// ---------------------------------------------------------------------------
describe("data grader — interactions", () => {
  it("passes when interaction count meets minimum", () => {
    const client = mockMcpClient({
      "interaction.list": {
        content: JSON.stringify({
          interactions: [{ event: "onClick", action: "navigation" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: {
        componentUuid: "c1",
        checkType: "interactions",
        nodeRef: "btn-1",
        minCount: 1,
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("fails when nodeRef is missing for interactions check", () => {
    const client = mockMcpClient({});
    const config: GraderConfig = {
      type: "data",
      params: { componentUuid: "c1", checkType: "interactions" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("requires nodeRef");
    });
  });

  it("fails for unknown checkType", () => {
    const client = mockMcpClient({});
    const config: GraderConfig = {
      type: "data",
      params: { componentUuid: "c1", checkType: "unknown" },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Unknown data check type: "unknown"');
    });
  });

  it("handles array-format interaction response", () => {
    const client = mockMcpClient({
      "interaction.list": {
        content: JSON.stringify([{ event: "onClick", action: "nav" }]),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: {
        componentUuid: "c1",
        checkType: "interactions",
        nodeRef: "btn",
        minCount: 1,
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("P13.9: passes when expected event handler exists", () => {
    const client = mockMcpClient({
      "interaction.list": {
        content: JSON.stringify({
          interactions: [
            { event: "onClick", action: "navigation" },
            { event: "onChange", action: "updateVariable" },
          ],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: {
        componentUuid: "c1",
        checkType: "interactions",
        nodeRef: "btn",
        event: "onClick",
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(true);
    });
  });

  it("P13.9: fails when expected event handler does not exist", () => {
    const client = mockMcpClient({
      "interaction.list": {
        content: JSON.stringify({
          interactions: [{ event: "onClick", action: "navigation" }],
        }),
        isError: false,
      },
    });
    const config: GraderConfig = {
      type: "data",
      params: {
        componentUuid: "c1",
        checkType: "interactions",
        nodeRef: "btn",
        event: "onSubmit",
      },
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain('No interaction found with event "onSubmit"');
    });
  });
});

// ---------------------------------------------------------------------------
// Unknown state grader type
// ---------------------------------------------------------------------------
describe("unknown state grader", () => {
  it("returns failure for unknown type", () => {
    const client = mockMcpClient({});
    const config: GraderConfig = {
      type: "unknown-state" as any,
      params: {},
    };

    return runStateGrader(config, client).then((result) => {
      expect(result.passed).toBe(false);
      expect(result.message).toContain("Unknown state grader");
    });
  });
});
