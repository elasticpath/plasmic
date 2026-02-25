/**
 * Unit tests for token-reader.ts
 *
 * Design tokens are the foundation of a project's visual language. These tests
 * ensure Claude sees accurate token data — wrong colors or spacing values would
 * produce pages that don't match the design system.
 *
 * Token reference resolution is especially important: projects often define
 * semantic tokens (e.g., "Primary" → references "Blue 500") and Claude needs
 * the final CSS value to construct valid PlasmicElement trees.
 */

import { describe, it, expect } from "vitest";
import {
  readTokens,
  resolveTokenValue,
  mkTokenRef,
  isTokenRef,
  parseTokenRefUuid,
  getAllStyleTokens,
  findToken,
  getAcceptableTokenTypes,
} from "../token-reader";

describe("resolveTokenValue", () => {
  it("returns primitive CSS values unchanged", () => {
    const map = new Map<string, string>();
    expect(resolveTokenValue("#ff0000", map)).toBe("#ff0000");
    expect(resolveTokenValue("16px", map)).toBe("16px");
    expect(resolveTokenValue("Roboto", map)).toBe("Roboto");
  });

  it("resolves a single token reference", () => {
    const map = new Map([["uuid-1", "#0000ff"]]);
    expect(resolveTokenValue("var(--token-uuid-1)", map)).toBe("#0000ff");
  });

  it("resolves a chain of token references", () => {
    const map = new Map([
      ["uuid-1", "var(--token-uuid-2)"],
      ["uuid-2", "var(--token-uuid-3)"],
      ["uuid-3", "#00ff00"],
    ]);
    expect(resolveTokenValue("var(--token-uuid-1)", map)).toBe("#00ff00");
  });

  it("detects cycles and returns the raw reference", () => {
    const map = new Map([
      ["uuid-1", "var(--token-uuid-2)"],
      ["uuid-2", "var(--token-uuid-1)"],
    ]);
    // Cycle: uuid-1 → uuid-2 → uuid-1 (already visited)
    expect(resolveTokenValue("var(--token-uuid-1)", map)).toBe(
      "var(--token-uuid-1)"
    );
  });

  it("returns raw reference when target UUID is not in the map", () => {
    const map = new Map<string, string>();
    expect(resolveTokenValue("var(--token-unknown)", map)).toBe(
      "var(--token-unknown)"
    );
  });
});

describe("readTokens", () => {
  const sampleTokens = [
    {
      uuid: "color-1",
      name: "Primary Blue",
      type: "Color",
      value: "#0066cc",
    },
    {
      uuid: "color-2",
      name: "Background",
      type: "Color",
      value: "#ffffff",
    },
    {
      uuid: "spacing-1",
      name: "Base Spacing",
      type: "Spacing",
      value: "8px",
    },
    {
      uuid: "font-1",
      name: "Body Font",
      type: "FontFamily",
      value: "Inter",
    },
    {
      uuid: "size-1",
      name: "Body Size",
      type: "FontSize",
      value: "16px",
    },
    {
      uuid: "lh-1",
      name: "Body Line Height",
      type: "LineHeight",
      value: "1.5",
    },
    {
      uuid: "opacity-1",
      name: "Disabled",
      type: "Opacity",
      value: "0.5",
    },
  ];

  it("returns all tokens grouped by type", () => {
    const result = readTokens(sampleTokens);
    expect(result.tokenCount).toBe(7);
    expect(Object.keys(result.tokens)).toEqual(
      expect.arrayContaining([
        "Color",
        "Spacing",
        "FontFamily",
        "FontSize",
        "LineHeight",
        "Opacity",
      ])
    );
    expect(result.tokens.Color).toHaveLength(2);
    expect(result.tokens.Spacing).toHaveLength(1);
  });

  it("returns correct token fields", () => {
    const result = readTokens(sampleTokens);
    const primary = result.tokens.Color[0];
    expect(primary).toEqual({
      uuid: "color-1",
      name: "Primary Blue",
      type: "Color",
      value: "#0066cc",
    });
  });

  it("filters by type when specified", () => {
    const result = readTokens(sampleTokens, "Color");
    expect(result.tokenCount).toBe(2);
    expect(Object.keys(result.tokens)).toEqual(["Color"]);
    expect(result.tokens.Color[0].name).toBe("Primary Blue");
    expect(result.tokens.Color[1].name).toBe("Background");
  });

  it("returns empty result when filtering by type with no matches", () => {
    const tokens = [
      { uuid: "c1", name: "Red", type: "Color", value: "#ff0000" },
    ];
    const result = readTokens(tokens, "Spacing");
    expect(result.tokenCount).toBe(0);
    expect(result.tokens).toEqual({});
  });

  it("handles empty token array", () => {
    const result = readTokens([]);
    expect(result.tokenCount).toBe(0);
    expect(result.tokens).toEqual({});
  });

  it("handles null/undefined token array", () => {
    const result = readTokens(null as any);
    expect(result.tokenCount).toBe(0);
    expect(result.tokens).toEqual({});
  });

  it("resolves token references and includes resolvedValue", () => {
    const tokens = [
      { uuid: "base", name: "Blue 500", type: "Color", value: "#0066cc" },
      {
        uuid: "semantic",
        name: "Primary",
        type: "Color",
        value: "var(--token-base)",
      },
    ];
    const result = readTokens(tokens);
    const primary = result.tokens.Color.find((t) => t.name === "Primary");
    expect(primary).toEqual({
      uuid: "semantic",
      name: "Primary",
      type: "Color",
      value: "var(--token-base)",
      resolvedValue: "#0066cc",
    });
  });

  it("omits resolvedValue when value is already a primitive", () => {
    const tokens = [
      { uuid: "c1", name: "Red", type: "Color", value: "#ff0000" },
    ];
    const result = readTokens(tokens);
    expect(result.tokens.Color[0].resolvedValue).toBeUndefined();
  });

  it("resolves multi-hop token chains", () => {
    const tokens = [
      { uuid: "t1", name: "Base", type: "Spacing", value: "4px" },
      { uuid: "t2", name: "Small", type: "Spacing", value: "var(--token-t1)" },
      { uuid: "t3", name: "Compact", type: "Spacing", value: "var(--token-t2)" },
    ];
    const result = readTokens(tokens);
    const compact = result.tokens.Spacing.find((t) => t.name === "Compact");
    expect(compact?.resolvedValue).toBe("4px");
  });

  it("handles cycles gracefully without crashing", () => {
    const tokens = [
      { uuid: "a", name: "Token A", type: "Color", value: "var(--token-b)" },
      { uuid: "b", name: "Token B", type: "Color", value: "var(--token-a)" },
    ];
    const result = readTokens(tokens);
    // Cycle: a→b→a (detected). Resolution returns "var(--token-b)" which
    // equals Token A's raw value, so resolvedValue is omitted.
    const tokenA = result.tokens.Color.find((t) => t.name === "Token A");
    expect(tokenA?.resolvedValue).toBeUndefined();
    // The token still appears in results with its raw value
    expect(tokenA?.value).toBe("var(--token-b)");
  });

  it("handles unresolvable references (token from dependency not loaded)", () => {
    const tokens = [
      {
        uuid: "local",
        name: "Brand Color",
        type: "Color",
        value: "var(--token-dep-token-uuid)",
      },
    ];
    const result = readTokens(tokens);
    // Can't resolve the ref - no resolvedValue (same as raw value)
    expect(result.tokens.Color[0].resolvedValue).toBeUndefined();
  });

  it("type filter works for all six token types", () => {
    for (const type of [
      "Color",
      "Spacing",
      "Opacity",
      "LineHeight",
      "FontFamily",
      "FontSize",
    ] as const) {
      const result = readTokens(sampleTokens, type);
      for (const token of Object.values(result.tokens).flat()) {
        expect(token.type).toBe(type);
      }
    }
  });
});

// =============================================================================
// Token reference helpers — used by update-styles to resolve token:Name values
// and by tree-reader to display token names alongside resolved CSS values.
// =============================================================================

describe("mkTokenRef", () => {
  it("creates var(--token-<uuid>) format", () => {
    expect(mkTokenRef("abc123")).toBe("var(--token-abc123)");
  });
});

describe("isTokenRef", () => {
  it("returns true for var(--token-<uuid>) values", () => {
    expect(isTokenRef("var(--token-abc123)")).toBe(true);
    expect(isTokenRef("var(--token-d2wtb1IJMQpo)")).toBe(true);
  });

  it("returns false for non-token values", () => {
    expect(isTokenRef("#ff0000")).toBe(false);
    expect(isTokenRef("16px")).toBe(false);
    expect(isTokenRef("var(--custom-prop)")).toBe(false);
    expect(isTokenRef("")).toBe(false);
  });
});

describe("parseTokenRefUuid", () => {
  it("extracts UUID from var(--token-<uuid>)", () => {
    expect(parseTokenRefUuid("var(--token-abc123)")).toBe("abc123");
    expect(parseTokenRefUuid("var(--token-d2wtb1IJMQpo)")).toBe("d2wtb1IJMQpo");
  });

  it("returns undefined for non-token values", () => {
    expect(parseTokenRefUuid("#ff0000")).toBeUndefined();
    expect(parseTokenRefUuid("var(--custom-prop)")).toBeUndefined();
  });
});

describe("getAllStyleTokens", () => {
  it("returns local tokens from site.styleTokens", () => {
    const site = {
      styleTokens: [
        { uuid: "t1", name: "Red", type: "Color", value: "#ff0000" },
        { uuid: "t2", name: "Base", type: "Spacing", value: "8px" },
      ],
    };
    const result = getAllStyleTokens(site);
    expect(result).toHaveLength(2);
    expect(result[0].uuid).toBe("t1");
    expect(result[1].uuid).toBe("t2");
  });

  it("includes tokens from dependencies", () => {
    const site = {
      styleTokens: [
        { uuid: "local-1", name: "Local", type: "Color", value: "#000" },
      ],
      projectDependencies: [
        {
          site: {
            styleTokens: [
              { uuid: "dep-1", name: "Dep Color", type: "Color", value: "#fff" },
            ],
          },
        },
      ],
    };
    const result = getAllStyleTokens(site);
    expect(result).toHaveLength(2);
    expect(result[0].uuid).toBe("local-1");
    expect(result[1].uuid).toBe("dep-1");
  });

  it("handles missing styleTokens and dependencies", () => {
    expect(getAllStyleTokens({})).toEqual([]);
    expect(getAllStyleTokens({ styleTokens: null })).toEqual([]);
    expect(getAllStyleTokens({ projectDependencies: [{ site: {} }] })).toEqual([]);
  });
});

describe("findToken", () => {
  const tokens = [
    { uuid: "color-1", name: "Primary Blue", type: "Color", value: "#0066cc" },
    { uuid: "spacing-1", name: "Base Spacing", type: "Spacing", value: "8px" },
    { uuid: "font-1", name: "Body Font", type: "FontFamily", value: "Inter" },
  ];

  it("finds token by exact UUID", () => {
    const result = findToken(tokens, "color-1");
    expect(result).toBe(tokens[0]);
  });

  it("finds token by name (case-insensitive)", () => {
    expect(findToken(tokens, "Primary Blue")).toBe(tokens[0]);
    expect(findToken(tokens, "primary blue")).toBe(tokens[0]);
    expect(findToken(tokens, "PRIMARY BLUE")).toBe(tokens[0]);
  });

  it("returns null when not found", () => {
    expect(findToken(tokens, "nonexistent")).toBeNull();
    expect(findToken(tokens, "unknown-uuid")).toBeNull();
  });

  it("prefers UUID match over name match", () => {
    // Edge case: token whose name equals another token's UUID
    const edgeTokens = [
      { uuid: "abc", name: "xyz", type: "Color", value: "#000" },
      { uuid: "xyz", name: "other", type: "Color", value: "#fff" },
    ];
    // "xyz" matches UUID of second token, not name of first
    expect(findToken(edgeTokens, "xyz")).toBe(edgeTokens[1]);
  });

  it("throws on ambiguous name (multiple tokens with same name)", () => {
    const ambiguous = [
      { uuid: "t1", name: "Primary", type: "Color", value: "#0066cc" },
      { uuid: "t2", name: "Primary", type: "Spacing", value: "16px" },
    ];
    expect(() => findToken(ambiguous, "Primary")).toThrow("Ambiguous");
    expect(() => findToken(ambiguous, "Primary")).toThrow("2 tokens");
  });

  it("returns null for empty token list", () => {
    expect(findToken([], "anything")).toBeNull();
  });
});

describe("getAcceptableTokenTypes", () => {
  it("returns Color for color properties", () => {
    expect(getAcceptableTokenTypes("color")).toEqual(["Color"]);
    expect(getAcceptableTokenTypes("background")).toEqual(["Color"]);
    expect(getAcceptableTokenTypes("border-top-color")).toEqual(["Color"]);
    expect(getAcceptableTokenTypes("outline-color")).toEqual(["Color"]);
  });

  it("returns Spacing for spacing properties", () => {
    expect(getAcceptableTokenTypes("padding-top")).toEqual(["Spacing"]);
    expect(getAcceptableTokenTypes("margin-left")).toEqual(["Spacing"]);
    expect(getAcceptableTokenTypes("gap")).toEqual(["Spacing"]);
    expect(getAcceptableTokenTypes("row-gap")).toEqual(["Spacing"]);
  });

  it("returns FontFamily for font-family", () => {
    expect(getAcceptableTokenTypes("font-family")).toEqual(["FontFamily"]);
  });

  it("returns FontSize + Spacing for font-size", () => {
    expect(getAcceptableTokenTypes("font-size")).toEqual(["FontSize", "Spacing"]);
  });

  it("returns LineHeight for line-height", () => {
    expect(getAcceptableTokenTypes("line-height")).toEqual(["LineHeight"]);
  });

  it("returns Opacity for opacity", () => {
    expect(getAcceptableTokenTypes("opacity")).toEqual(["Opacity"]);
  });

  it("returns Spacing for dimension properties", () => {
    expect(getAcceptableTokenTypes("width")).toContain("Spacing");
    expect(getAcceptableTokenTypes("height")).toContain("Spacing");
    expect(getAcceptableTokenTypes("min-width")).toContain("Spacing");
    expect(getAcceptableTokenTypes("max-height")).toContain("Spacing");
  });

  it("returns Spacing for border-width properties", () => {
    expect(getAcceptableTokenTypes("border-top-width")).toEqual(["Spacing"]);
    expect(getAcceptableTokenTypes("border-left-width")).toEqual(["Spacing"]);
    expect(getAcceptableTokenTypes("outline-width")).toEqual(["Spacing"]);
  });

  it("returns Spacing for border-radius properties", () => {
    expect(getAcceptableTokenTypes("border-top-left-radius")).toEqual(["Spacing"]);
  });

  it("returns null for unknown properties", () => {
    expect(getAcceptableTokenTypes("display")).toBeNull();
    expect(getAcceptableTokenTypes("flex-direction")).toBeNull();
    expect(getAcceptableTokenTypes("position")).toBeNull();
  });

  it("handles camelCase input", () => {
    expect(getAcceptableTokenTypes("paddingTop")).toEqual(["Spacing"]);
    expect(getAcceptableTokenTypes("borderTopColor")).toEqual(["Color"]);
    expect(getAcceptableTokenTypes("fontSize")).toEqual(["FontSize", "Spacing"]);
  });
});
