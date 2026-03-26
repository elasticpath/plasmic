/**
 * Characterization tests for token-reader.ts
 *
 * Pins behavior of:
 *   - resolveTokenValue() — var(--token-*) chain resolution with cycle detection
 *   - readTokens() — token reading, grouping, and filtering
 *   - getAllStyleTokens() — token gathering from site + deps
 *   - findToken() — lookup by name/UUID
 *   - getAcceptableTokenTypes() — CSS property → token type mapping
 *   - mkTokenRef / isTokenRef / parseTokenRefUuid — reference helpers
 */

import { describe, it, expect } from "vitest";
import {
  resolveTokenValue,
  readTokens,
  getAllStyleTokens,
  findToken,
  getAcceptableTokenTypes,
  mkTokenRef,
  isTokenRef,
  parseTokenRefUuid,
} from "../token-reader";

// ---------------------------------------------------------------------------
// resolveTokenValue
// ---------------------------------------------------------------------------
describe("resolveTokenValue", () => {
  it("returns plain values unchanged", () => {
    const map = new Map<string, string>();
    expect(resolveTokenValue("#ff0000", map)).toBe("#ff0000");
    expect(resolveTokenValue("16px", map)).toBe("16px");
  });

  it("resolves a single token reference", () => {
    const map = new Map([["abc123", "#ff0000"]]);
    expect(resolveTokenValue("var(--token-abc123)", map)).toBe("#ff0000");
  });

  it("follows a chain of token references", () => {
    const map = new Map([
      ["a", "var(--token-b)"],
      ["b", "var(--token-c)"],
      ["c", "#00ff00"],
    ]);
    expect(resolveTokenValue("var(--token-a)", map)).toBe("#00ff00");
  });

  it("detects cycles and returns raw reference", () => {
    const map = new Map([
      ["a", "var(--token-b)"],
      ["b", "var(--token-a)"],
    ]);
    // Should not infinite loop — returns the unresolvable reference
    const result = resolveTokenValue("var(--token-a)", map);
    expect(result).toContain("var(--token-");
  });

  it("returns raw reference when UUID not in map", () => {
    const map = new Map<string, string>();
    expect(resolveTokenValue("var(--token-missing)", map)).toBe(
      "var(--token-missing)"
    );
  });
});

// ---------------------------------------------------------------------------
// readTokens
// ---------------------------------------------------------------------------
describe("readTokens", () => {
  const sampleTokens = [
    { uuid: "t1", name: "Primary", type: "Color", value: "#3366ff" },
    { uuid: "t2", name: "Secondary", type: "Color", value: "var(--token-t1)" },
    { uuid: "t3", name: "Body", type: "FontSize", value: "16px" },
    { uuid: "t4", name: "Heading", type: "FontFamily", value: "Inter" },
  ];

  it("returns all tokens grouped by type", () => {
    const result = readTokens(sampleTokens);
    expect(result.tokenCount).toBe(4);
    expect(Object.keys(result.tokens).sort()).toEqual(
      ["Color", "FontFamily", "FontSize"].sort()
    );
    expect(result.tokens["Color"]).toHaveLength(2);
  });

  it("resolves token-to-token references", () => {
    const result = readTokens(sampleTokens);
    const secondary = result.tokens["Color"].find(
      (t) => t.name === "Secondary"
    );
    expect(secondary?.resolvedValue).toBe("#3366ff");
  });

  it("filters by type when specified", () => {
    const result = readTokens(sampleTokens, "FontSize");
    expect(result.tokenCount).toBe(1);
    expect(result.tokens["FontSize"]).toHaveLength(1);
  });

  it("handles empty array", () => {
    const result = readTokens([]);
    expect(result.tokenCount).toBe(0);
    expect(result.tokens).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getAllStyleTokens
// ---------------------------------------------------------------------------
describe("getAllStyleTokens", () => {
  it("returns local tokens when no deps", () => {
    const site = {
      styleTokens: [
        { uuid: "t1", name: "Color1", value: "#000" },
        { uuid: "t2", name: "Color2", value: "#fff" },
      ],
    };
    const tokens = getAllStyleTokens(site);
    expect(tokens).toHaveLength(2);
  });

  it("includes dependency tokens", () => {
    const site = {
      styleTokens: [{ uuid: "local", name: "Local", value: "#000" }],
      projectDependencies: [
        {
          site: {
            styleTokens: [
              { uuid: "dep1", name: "DepColor", value: "#111" },
            ],
          },
        },
      ],
    };
    const tokens = getAllStyleTokens(site);
    expect(tokens).toHaveLength(2);
    expect(tokens.map((t: any) => t.uuid)).toEqual(["local", "dep1"]);
  });

  it("handles missing styleTokens gracefully", () => {
    expect(getAllStyleTokens({})).toEqual([]);
    expect(getAllStyleTokens({ styleTokens: null })).toEqual([]);
  });

  it("handles deps without site", () => {
    const site = {
      styleTokens: [],
      projectDependencies: [{ site: null }, {}],
    };
    expect(getAllStyleTokens(site)).toEqual([]);
  });

  it("walks transitive dependencies", () => {
    const site = {
      styleTokens: [{ uuid: "local", name: "Local", value: "#000" }],
      projectDependencies: [
        {
          projectId: "dep1",
          site: {
            styleTokens: [{ uuid: "d1", name: "Dep1Color", value: "#111" }],
            projectDependencies: [
              {
                projectId: "dep2",
                site: {
                  styleTokens: [
                    { uuid: "d2", name: "TransitiveDep", value: "#222" },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    const tokens = getAllStyleTokens(site);
    expect(tokens).toHaveLength(3);
    expect(tokens.map((t: any) => t.uuid)).toEqual(["local", "d1", "d2"]);
  });

  it("deduplicates diamond dependencies", () => {
    const sharedDep = {
      projectId: "shared",
      site: {
        styleTokens: [{ uuid: "shared1", name: "Shared", value: "#333" }],
      },
    };
    const site = {
      styleTokens: [],
      projectDependencies: [
        {
          projectId: "a",
          site: {
            styleTokens: [],
            projectDependencies: [sharedDep],
          },
        },
        {
          projectId: "b",
          site: {
            styleTokens: [],
            projectDependencies: [sharedDep],
          },
        },
      ],
    };
    const tokens = getAllStyleTokens(site);
    // "shared" should appear only once despite being reachable via both a and b
    expect(tokens.filter((t: any) => t.uuid === "shared1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findToken
// ---------------------------------------------------------------------------
describe("findToken", () => {
  const tokens = [
    { uuid: "u1", name: "Primary", type: "Color", value: "#000" },
    { uuid: "u2", name: "Secondary", type: "Color", value: "#111" },
    { uuid: "u3", name: "Body Size", type: "FontSize", value: "16px" },
  ];

  it("finds by exact UUID", () => {
    expect(findToken(tokens, "u2")?.name).toBe("Secondary");
  });

  it("finds by case-insensitive name", () => {
    expect(findToken(tokens, "primary")?.uuid).toBe("u1");
    expect(findToken(tokens, "PRIMARY")?.uuid).toBe("u1");
    expect(findToken(tokens, "body size")?.uuid).toBe("u3");
  });

  it("prefers UUID match over name", () => {
    // If a token's UUID happens to match another token's name
    const special = [
      { uuid: "Primary", name: "Other", type: "Color", value: "#000" },
      { uuid: "x", name: "Primary", type: "Color", value: "#111" },
    ];
    expect(findToken(special, "Primary")?.name).toBe("Other"); // UUID match
  });

  it("returns null when not found", () => {
    expect(findToken(tokens, "nonexistent")).toBeNull();
  });

  it("throws on ambiguous name match", () => {
    const dupes = [
      { uuid: "a", name: "Blue", type: "Color", value: "#00f" },
      { uuid: "b", name: "Blue", type: "Color", value: "#00a" },
    ];
    expect(() => findToken(dupes, "Blue")).toThrow(/Ambiguous/);
  });
});

// ---------------------------------------------------------------------------
// getAcceptableTokenTypes
// ---------------------------------------------------------------------------
describe("getAcceptableTokenTypes", () => {
  it("maps color properties to Color type", () => {
    expect(getAcceptableTokenTypes("color")).toContain("Color");
    expect(getAcceptableTokenTypes("background-color")).toContain("Color");
    expect(getAcceptableTokenTypes("border-top-color")).toContain("Color");
    expect(getAcceptableTokenTypes("background")).toContain("Color");
  });

  it("maps spacing properties to Spacing type", () => {
    expect(getAcceptableTokenTypes("padding-top")).toContain("Spacing");
    expect(getAcceptableTokenTypes("margin-left")).toContain("Spacing");
    expect(getAcceptableTokenTypes("row-gap")).toContain("Spacing");
    expect(getAcceptableTokenTypes("column-gap")).toContain("Spacing");
    expect(getAcceptableTokenTypes("gap")).toContain("Spacing");
    expect(getAcceptableTokenTypes("border-top-width")).toContain("Spacing");
  });

  it("maps font properties to correct types", () => {
    expect(getAcceptableTokenTypes("font-size")).toContain("FontSize");
    expect(getAcceptableTokenTypes("font-family")).toContain("FontFamily");
    expect(getAcceptableTokenTypes("line-height")).toContain("LineHeight");
    expect(getAcceptableTokenTypes("opacity")).toContain("Opacity");
  });

  it("maps size properties to Spacing + FontSize", () => {
    const widthTypes = getAcceptableTokenTypes("width");
    expect(widthTypes).toContain("Spacing");
    expect(widthTypes).toContain("FontSize");
  });

  it("handles camelCase input via kebab conversion", () => {
    expect(getAcceptableTokenTypes("paddingTop")).toContain("Spacing");
    expect(getAcceptableTokenTypes("backgroundColor")).toContain("Color");
    expect(getAcceptableTokenTypes("fontSize")).toContain("FontSize");
  });

  it("returns null for unknown properties (any token type allowed)", () => {
    expect(getAcceptableTokenTypes("display")).toBeNull();
    expect(getAcceptableTokenTypes("flex-direction")).toBeNull();
    expect(getAcceptableTokenTypes("unknown-prop")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Token reference helpers
// ---------------------------------------------------------------------------
describe("mkTokenRef", () => {
  it("creates var(--token-<uuid>) string", () => {
    expect(mkTokenRef("abc123")).toBe("var(--token-abc123)");
  });
});

describe("isTokenRef", () => {
  it("returns true for token references", () => {
    expect(isTokenRef("var(--token-abc123)")).toBe(true);
  });

  it("returns false for plain values", () => {
    expect(isTokenRef("#ff0000")).toBe(false);
    expect(isTokenRef("16px")).toBe(false);
    expect(isTokenRef("var(--custom-prop)")).toBe(false);
  });
});

describe("parseTokenRefUuid", () => {
  it("extracts UUID from token reference", () => {
    expect(parseTokenRefUuid("var(--token-abc123)")).toBe("abc123");
  });

  it("returns undefined for non-token values", () => {
    expect(parseTokenRefUuid("#ff0000")).toBeUndefined();
  });
});
