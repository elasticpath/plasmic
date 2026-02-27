/**
 * Unit tests for the design domain.
 *
 * Covers all design-system operations: tokens (CRUD + resolution), mixins,
 * animation sequences, themes, and image assets.
 *
 * Token reader tests (readTokens, resolveTokenValue, mkTokenRef, isTokenRef,
 * parseTokenRefUuid, getAllStyleTokens, findToken, getAcceptableTokenTypes)
 * are included here since they are core to the design domain.
 *
 * The resolveTokenReferences tests live inside an "edit-tools" describe block
 * that mirrors the shared setup from edit-tools.test.ts (lines 845-876).
 *
 * All other describes (createToken, updateToken, removeToken, duplicateToken,
 * listMixins, createMixin, updateMixin, removeMixin, listAnimationSequences,
 * createAnimationSequence, updateAnimationSequence, removeAnimationSequence,
 * listThemes, createTheme, updateTheme, removeTheme, setActiveTheme,
 * listAssets, uploadAsset, renameAsset, removeAsset) are standalone with
 * their own setup.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// --- edit-tools imports ---
import {
  resolveTokenReferences,
  createToken,
  updateToken,
  removeToken,
  duplicateToken,
  listMixins,
  createMixin,
  updateMixin,
  removeMixin,
  listAnimationSequences,
  createAnimationSequence,
  updateAnimationSequence,
  removeAnimationSequence,
  listThemes,
  createTheme,
  updateTheme,
  removeTheme,
  setActiveTheme,
  listAssets,
  uploadAsset,
  renameAsset,
  removeAsset,
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  mockAddStyleToken,
  mockRenameStyleToken,
  mockDuplicateStyleToken,
  mockAddMixin,
  mockRemoveMixin,
  mockRenameMixin,
  mockAddAnimationSequence,
  mockRemoveAnimationSequence,
  mockRenameAnimationSequence,
  mockAddImageAsset,
  mockRenameImageAsset,
  mockRemoveImageAsset,
} from "../__mocks__/wab-tpl-mgr";

// --- token-reader imports ---
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

// --- shared helpers ---
import { mockApiClient, makeSession, mkTag, mkComponent } from "./test-helpers";

// =============================================================================
// Token reader tests (from token-reader.test.ts)
// =============================================================================

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

// =============================================================================
// resolveTokenReferences — inside "edit-tools" describe with shared setup
// (mirrors lines 842-876 of edit-tools.test.ts)
// =============================================================================

describe("edit-tools", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();

    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });

    // mockWithRecording returns empty changes by default
    mockWithRecording.mockReturnValue({
      changes: [],
      newInsts: [],
      removedInsts: [],
    });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  // Helper to set up session + change tracker with a component
  function setupSession(component: any) {
    const session = makeSession({
      site: { components: [component] },
    });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  // =============================================================================
  // resolveTokenReferences — token: prefix resolution for styles
  // Tokens are addressed by name or UUID with "token:" prefix using
  // var(--token-<uuid>) format. Incorrect resolution means styles silently
  // fail to connect to the design system, producing hardcoded values instead.
  // =============================================================================

  describe("resolveTokenReferences", () => {
    const siteWithTokens = {
      styleTokens: [
        { uuid: "color-1", name: "Primary Blue", type: "Color", value: "#0066cc" },
        { uuid: "color-2", name: "Background", type: "Color", value: "#ffffff" },
        { uuid: "spacing-1", name: "Base Spacing", type: "Spacing", value: "8px" },
        { uuid: "font-1", name: "Body Font", type: "FontFamily", value: "Inter" },
        { uuid: "size-1", name: "Body Size", type: "FontSize", value: "16px" },
        { uuid: "lh-1", name: "Body Line Height", type: "LineHeight", value: "1.5" },
        { uuid: "opacity-1", name: "Disabled", type: "Opacity", value: "0.5" },
      ],
    };

    it("resolves token:Name to var(--token-<uuid>)", () => {
      const result = resolveTokenReferences(
        { color: "token:Primary Blue" },
        siteWithTokens
      );
      expect(result.color).toBe("var(--token-color-1)");
    });

    it("resolves token by UUID", () => {
      const result = resolveTokenReferences(
        { color: "token:color-1" },
        siteWithTokens
      );
      expect(result.color).toBe("var(--token-color-1)");
    });

    it("resolves token name case-insensitively", () => {
      const result = resolveTokenReferences(
        { color: "token:primary blue" },
        siteWithTokens
      );
      expect(result.color).toBe("var(--token-color-1)");
    });

    it("passes through non-token values unchanged", () => {
      const result = resolveTokenReferences(
        { color: "#ff0000", fontSize: "24px" },
        siteWithTokens
      );
      expect(result.color).toBe("#ff0000");
      expect(result.fontSize).toBe("24px");
    });

    it("handles mixed token and non-token values", () => {
      const result = resolveTokenReferences(
        { color: "token:Primary Blue", fontSize: "24px" },
        siteWithTokens
      );
      expect(result.color).toBe("var(--token-color-1)");
      expect(result.fontSize).toBe("24px");
    });

    it("throws when token name is empty", () => {
      expect(() =>
        resolveTokenReferences({ color: "token:" }, siteWithTokens)
      ).toThrow('Token name required after "token:"');
    });

    it("throws when token is not found", () => {
      expect(() =>
        resolveTokenReferences({ color: "token:Nonexistent" }, siteWithTokens)
      ).toThrow('Token "Nonexistent" not found');
    });

    it("lists available tokens of matching type in error", () => {
      try {
        resolveTokenReferences({ color: "token:Missing" }, siteWithTokens);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("Primary Blue");
        expect(err.message).toContain("Background");
        expect(err.message).toContain("Color");
      }
    });

    it("throws when token type mismatches property", () => {
      expect(() =>
        resolveTokenReferences(
          { paddingTop: "token:Primary Blue" },
          siteWithTokens
        )
      ).toThrow('Token "Primary Blue" is type "Color"');
      expect(() =>
        resolveTokenReferences(
          { paddingTop: "token:Primary Blue" },
          siteWithTokens
        )
      ).toThrow("Spacing");
    });

    it("accepts Spacing token for spacing properties", () => {
      const result = resolveTokenReferences(
        { paddingTop: "token:Base Spacing" },
        siteWithTokens
      );
      expect(result.paddingTop).toBe("var(--token-spacing-1)");
    });

    it("accepts FontFamily token for font-family", () => {
      const result = resolveTokenReferences(
        { "font-family": "token:Body Font" },
        siteWithTokens
      );
      expect(result["font-family"]).toBe("var(--token-font-1)");
    });

    it("accepts FontSize token for font-size", () => {
      const result = resolveTokenReferences(
        { "font-size": "token:Body Size" },
        siteWithTokens
      );
      expect(result["font-size"]).toBe("var(--token-size-1)");
    });

    it("accepts LineHeight token for line-height", () => {
      const result = resolveTokenReferences(
        { "line-height": "token:Body Line Height" },
        siteWithTokens
      );
      expect(result["line-height"]).toBe("var(--token-lh-1)");
    });

    it("accepts Opacity token for opacity", () => {
      const result = resolveTokenReferences(
        { opacity: "token:Disabled" },
        siteWithTokens
      );
      expect(result.opacity).toBe("var(--token-opacity-1)");
    });

    it("allows any token type for unknown properties", () => {
      // display doesn't have a specific token type requirement
      const result = resolveTokenReferences(
        { display: "token:Primary Blue" },
        siteWithTokens
      );
      expect(result.display).toBe("var(--token-color-1)");
    });

    it("searches dependency tokens", () => {
      const siteWithDeps = {
        styleTokens: [],
        projectDependencies: [
          {
            site: {
              styleTokens: [
                { uuid: "dep-color-1", name: "Theme Red", type: "Color", value: "#ff0000" },
              ],
            },
          },
        ],
      };
      const result = resolveTokenReferences(
        { color: "token:Theme Red" },
        siteWithDeps
      );
      expect(result.color).toBe("var(--token-dep-color-1)");
    });

    it("works with empty token list", () => {
      expect(() =>
        resolveTokenReferences({ color: "token:Missing" }, { styleTokens: [] })
      ).toThrow("No tokens defined");
    });
  });
});

// =============================================================================
// createToken
// =============================================================================

describe("createToken", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("creates a Color token via TplMgr.addStyleToken", async () => {
    const site = { components: [], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const mockToken = {
      uuid: "tok-1",
      name: "Primary Blue",
      type: "Color",
      value: "#0066FF",
    };
    mockAddStyleToken.mockReturnValue(mockToken);

    const result = await createToken(api, "Primary Blue", "Color", "#0066FF");

    expect(mockAddStyleToken).toHaveBeenCalledWith({
      name: "Primary Blue",
      tokenType: "Color",
      value: "#0066FF",
    });
    expect(result.tokenUuid).toBe("tok-1");
    expect(result.name).toBe("Primary Blue");
    expect(result.type).toBe("Color");
    expect(result.value).toBe("#0066FF");
    expect(result.save.revisionNum).toBe(11);
  });

  it("creates a Spacing token", async () => {
    const site = { components: [], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockAddStyleToken.mockReturnValue({
      uuid: "tok-2",
      name: "Space MD",
      type: "Spacing",
      value: "16px",
    });

    const result = await createToken(api, "Space MD", "Spacing", "16px");

    expect(result.type).toBe("Spacing");
    expect(result.value).toBe("16px");
  });
});

// =============================================================================
// updateToken
// =============================================================================

describe("updateToken", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("updates token value", async () => {
    const token = { uuid: "tok-1", name: "Primary", type: "Color", value: "#0066FF" };
    const site = { components: [], styleTokens: [token] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateToken(api, "Primary", "#FF0000");

    expect(result.previousValue).toBe("#0066FF");
    expect(result.value).toBe("#FF0000");
    expect(token.value).toBe("#FF0000");
  });

  it("renames token via TplMgr", async () => {
    const token = { uuid: "tok-1", name: "Primary", type: "Color", value: "#0066FF" };
    const site = { components: [], styleTokens: [token] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockRenameStyleToken.mockImplementation((t: any, n: string) => {
      t.name = n;
    });

    const result = await updateToken(api, "Primary", undefined, "Brand Blue");

    expect(mockRenameStyleToken).toHaveBeenCalledWith(token, "Brand Blue");
    expect(result.previousName).toBe("Primary");
    expect(result.name).toBe("Brand Blue");
  });

  it("updates both value and name", async () => {
    const token = { uuid: "tok-1", name: "Primary", type: "Color", value: "#0066FF" };
    const site = { components: [], styleTokens: [token] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockRenameStyleToken.mockImplementation((t: any, n: string) => {
      t.name = n;
    });

    const result = await updateToken(api, "tok-1", "#FF0000", "Danger");

    expect(result.previousValue).toBe("#0066FF");
    expect(result.previousName).toBe("Primary");
    expect(result.value).toBe("#FF0000");
    expect(result.name).toBe("Danger");
  });

  it("throws for non-existent token", async () => {
    const site = { components: [], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(updateToken(api, "NonExistent", "#000")).rejects.toThrow(
      /not found/
    );
  });

  it("rejects dependency tokens", async () => {
    const depToken = { uuid: "dep-tok-1", name: "DepColor", type: "Color", value: "#000" };
    const site = {
      components: [],
      styleTokens: [],
      projectDependencies: [{ site: { styleTokens: [depToken] } }],
    };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(updateToken(api, "DepColor", "#FFF")).rejects.toThrow(
      /dependency project/
    );
  });
});

// =============================================================================
// removeToken
// =============================================================================

describe("removeToken", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("removes token and splices from array", async () => {
    const token = { uuid: "tok-1", name: "Primary", type: "Color", value: "#0066FF" };
    const site = { components: [], styleTokens: [token] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeToken(api, "Primary");

    expect(result.tokenUuid).toBe("tok-1");
    expect(result.name).toBe("Primary");
    expect(site.styleTokens).toHaveLength(0);
  });

  it("inlines token references in component styles", async () => {
    const token = { uuid: "tok-1", name: "Primary", type: "Color", value: "#0066FF" };
    const node = mkTag({
      uuid: "node-1",
      styles: { color: "var(--token-tok-1)" },
    });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [token] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeToken(api, "tok-1");

    expect(result.inlinedCount).toBeGreaterThan(0);
    expect(node.vsettings[0].rs.values.color).toBe("#0066FF");
    expect(site.styleTokens).toHaveLength(0);
  });

  it("inlines token references in other tokens", async () => {
    const primary = { uuid: "tok-1", name: "Primary", type: "Color", value: "#0066FF" };
    const accent = {
      uuid: "tok-2",
      name: "Accent",
      type: "Color",
      value: "var(--token-tok-1)",
    };
    const site = { components: [], styleTokens: [primary, accent] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeToken(api, "Primary");

    expect(accent.value).toBe("#0066FF");
    expect(result.inlinedCount).toBe(1);
    expect(site.styleTokens).toEqual([accent]);
  });

  it("throws for non-existent token", async () => {
    const site = { components: [], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeToken(api, "NonExistent")).rejects.toThrow(/not found/);
  });

  it("rejects dependency tokens", async () => {
    const depToken = { uuid: "dep-tok-1", name: "DepColor", type: "Color", value: "#000" };
    const site = {
      components: [],
      styleTokens: [],
      projectDependencies: [{ site: { styleTokens: [depToken] } }],
    };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeToken(api, "DepColor")).rejects.toThrow(
      /dependency project/
    );
  });

  it("replaces all occurrences of a token in a single CSS value (not just the first)", async () => {
    const token = {
      uuid: "tok-dup",
      name: "Primary",
      type: "Color",
      value: "#ff0000",
    };
    // Component style references the same token twice (e.g., box-shadow with two shadows)
    const comp = {
      name: "DualRef",
      tplTree: {
        _type: "TplTag",
        children: [],
        vsettings: [
          {
            rs: {
              values: {
                "box-shadow": `0 0 5px var(--token-${token.uuid}), 0 0 10px var(--token-${token.uuid})`,
              },
            },
          },
        ],
      },
    };
    const site = {
      components: [comp],
      styleTokens: [token],
      projectDependencies: [],
    };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await removeToken(api, "Primary");

    // Both occurrences must be replaced, not just the first
    const val = comp.tplTree.vsettings[0].rs.values["box-shadow"];
    expect(val).not.toContain("var(--token-");
    expect(val).toBe("0 0 5px #ff0000, 0 0 10px #ff0000");
  });
});

// =============================================================================
// duplicateToken
// =============================================================================

describe("duplicateToken", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("duplicates token via TplMgr", async () => {
    const token = { uuid: "tok-1", name: "Primary", type: "Color", value: "#0066FF" };
    const site = { components: [], styleTokens: [token] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const dupToken = {
      uuid: "tok-2",
      name: "Primary 2",
      type: "Color",
      value: "#0066FF",
    };
    mockDuplicateStyleToken.mockReturnValue(dupToken);

    const result = await duplicateToken(api, "Primary");

    expect(mockDuplicateStyleToken).toHaveBeenCalledWith(token);
    expect(result.tokenUuid).toBe("tok-2");
    expect(result.name).toBe("Primary 2");
    expect(result.sourceUuid).toBe("tok-1");
    expect(result.sourceName).toBe("Primary");
  });

  it("duplicates with custom name", async () => {
    const token = { uuid: "tok-1", name: "Primary", type: "Color", value: "#0066FF" };
    const site = { components: [], styleTokens: [token] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const dupToken = {
      uuid: "tok-2",
      name: "Primary 2",
      type: "Color",
      value: "#0066FF",
    };
    mockDuplicateStyleToken.mockReturnValue(dupToken);
    mockRenameStyleToken.mockImplementation((t: any, n: string) => {
      t.name = n;
    });

    const result = await duplicateToken(api, "Primary", "Secondary");

    expect(mockRenameStyleToken).toHaveBeenCalledWith(dupToken, "Secondary");
    expect(result.name).toBe("Secondary");
  });

  it("throws for non-existent token", async () => {
    const site = { components: [], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(duplicateToken(api, "NonExistent")).rejects.toThrow(
      /not found/
    );
  });
});

// =============================================================================
// Mixins — CRUD for reusable style bundles + apply/detach on elements
// =============================================================================

describe("listMixins", () => {
  afterEach(() => {
    clearSession();
  });

  it("returns empty array when no mixins exist", () => {
    const site = { components: [], mixins: [] };
    setSession(makeSession({ site } as any));
    expect(listMixins()).toEqual([]);
  });

  it("returns all mixins with their properties", () => {
    const site = {
      components: [],
      mixins: [
        { uuid: "m1", name: "Button Styles", rs: { values: { "font-size": "16px", color: "#333" } }, forTheme: false },
        { uuid: "m2", name: "Theme Base", rs: { values: { "background-color": "#fff" } }, forTheme: true },
      ],
    };
    setSession(makeSession({ site } as any));
    const result = listMixins();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      uuid: "m1",
      name: "Button Styles",
      styles: { "font-size": "16px", color: "#333" },
      forTheme: false,
    });
    expect(result[1]).toEqual({
      uuid: "m2",
      name: "Theme Base",
      styles: { "background-color": "#fff" },
      forTheme: true,
    });
  });

  it("handles mixins with empty rs.values", () => {
    const site = {
      components: [],
      mixins: [{ uuid: "m1", name: "Empty", rs: { values: {} }, forTheme: false }],
    };
    setSession(makeSession({ site } as any));
    const result = listMixins();
    expect(result[0].styles).toEqual({});
  });

  it("handles undefined mixins array", () => {
    const site = { components: [] };
    setSession(makeSession({ site } as any));
    const result = listMixins();
    expect(result).toEqual([]);
  });
});

describe("createMixin", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("creates a mixin with no styles", async () => {
    const site = { components: [], mixins: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockAddMixin.mockReturnValue({
      _type: "Mixin", uuid: "new-m1", name: "Card Styles",
      rs: { values: {}, mixins: [] }, forTheme: false, variantedRs: [],
    });

    const result = await createMixin(api, "Card Styles");
    expect(result.mixinUuid).toBe("new-m1");
    expect(result.name).toBe("Card Styles");
    expect(mockAddMixin).toHaveBeenCalled();
    expect(mockAddMixin.mock.calls[0][0]).toBe("Card Styles");
  });

  it("creates a mixin with initial styles", async () => {
    const site = { components: [], mixins: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const rsValues: Record<string, string> = {};
    mockAddMixin.mockReturnValue({
      _type: "Mixin", uuid: "new-m2", name: "Heading",
      rs: { values: rsValues, mixins: [] }, forTheme: false, variantedRs: [],
    });

    const result = await createMixin(api, "Heading", { fontSize: "24px", fontWeight: "bold" });
    expect(result.name).toBe("Heading");
    // The styles should have been assigned to rs.values
    expect(rsValues).toHaveProperty("fontSize", "24px");
    expect(rsValues).toHaveProperty("fontWeight", "bold");
  });

  it("sanitizes shorthand styles", async () => {
    const site = { components: [], mixins: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const rsValues: Record<string, string> = {};
    mockAddMixin.mockReturnValue({
      _type: "Mixin", uuid: "new-m3", name: "Padded",
      rs: { values: rsValues, mixins: [] }, forTheme: false, variantedRs: [],
    });

    await createMixin(api, "Padded", { padding: "10px" });
    // padding shorthand should be expanded
    expect(rsValues).toHaveProperty("paddingTop", "10px");
    expect(rsValues).toHaveProperty("paddingRight", "10px");
    expect(rsValues).toHaveProperty("paddingBottom", "10px");
    expect(rsValues).toHaveProperty("paddingLeft", "10px");
    expect(rsValues).not.toHaveProperty("padding");
  });
});

describe("updateMixin", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("renames a mixin", async () => {
    const mixin = { uuid: "m1", name: "Old Name", rs: { values: {} }, forTheme: false };
    const site = { components: [], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateMixin(api, "Old Name", "New Name");
    expect(result.updatedFields).toContain("name");
    expect(mockRenameMixin).toHaveBeenCalledWith(mixin, "New Name");
  });

  it("updates styles", async () => {
    const rsValues: Record<string, string> = { color: "red" };
    const mixin = { uuid: "m1", name: "Styled", rs: { values: rsValues }, forTheme: false };
    const site = { components: [], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateMixin(api, "Styled", undefined, { fontSize: "18px" });
    expect(result.updatedFields).toContain("styles");
    expect(rsValues).toHaveProperty("fontSize", "18px");
    // Existing styles should be preserved
    expect(rsValues).toHaveProperty("color", "red");
  });

  it("updates both name and styles", async () => {
    const rsValues: Record<string, string> = {};
    const mixin = { uuid: "m1", name: "Mixin", rs: { values: rsValues }, forTheme: false };
    const site = { components: [], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateMixin(api, "m1", "Updated", { color: "blue" });
    expect(result.updatedFields).toContain("name");
    expect(result.updatedFields).toContain("styles");
  });

  it("throws when neither name nor styles provided", async () => {
    const mixin = { uuid: "m1", name: "Test", rs: { values: {} }, forTheme: false };
    const site = { components: [], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateMixin(api, "Test", undefined, undefined)
    ).rejects.toThrow(/At least/);
  });

  it("throws when mixin not found", async () => {
    const site = { components: [], mixins: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateMixin(api, "nonexistent", "NewName")
    ).rejects.toThrow(/not found/);
  });

  it("finds mixin by UUID", async () => {
    const mixin = { uuid: "m1-uuid", name: "My Mixin", rs: { values: {} }, forTheme: false };
    const site = { components: [], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateMixin(api, "m1-uuid", "Renamed");
    expect(result.mixinUuid).toBe("m1-uuid");
    expect(mockRenameMixin).toHaveBeenCalledWith(mixin, "Renamed");
  });
});

describe("removeMixin", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("removes a mixin by name", async () => {
    const mixin = { uuid: "m1", name: "Old Mixin", rs: { values: {} }, forTheme: false };
    const site = { components: [], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeMixin(api, "Old Mixin");
    expect(result.removedName).toBe("Old Mixin");
    expect(result.removedUuid).toBe("m1");
    expect(mockRemoveMixin).toHaveBeenCalledWith(mixin);
  });

  it("removes a mixin by UUID", async () => {
    const mixin = { uuid: "m1-uuid", name: "Some Mixin", rs: { values: {} }, forTheme: false };
    const site = { components: [], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeMixin(api, "m1-uuid");
    expect(result.removedUuid).toBe("m1-uuid");
    expect(mockRemoveMixin).toHaveBeenCalledWith(mixin);
  });

  it("throws when mixin not found", async () => {
    const site = { components: [], mixins: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeMixin(api, "nonexistent")
    ).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// Animations — CRUD for animation sequences + apply/remove on elements
// =============================================================================

describe("listAnimationSequences", () => {
  afterEach(() => {
    clearSession();
  });

  it("returns empty array when no sequences exist", () => {
    const site = { components: [], animationSequences: [] };
    setSession(makeSession({ site } as any));
    expect(listAnimationSequences()).toEqual([]);
  });

  it("returns all sequences with their properties", () => {
    const site = {
      components: [],
      animationSequences: [
        { uuid: "s1", name: "Fade In", keyframes: [{ percentage: 0 }, { percentage: 100 }] },
        { uuid: "s2", name: "Slide Up", keyframes: [] },
      ],
    };
    setSession(makeSession({ site } as any));
    const result = listAnimationSequences();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ uuid: "s1", name: "Fade In", keyframeCount: 2 });
    expect(result[1]).toEqual({ uuid: "s2", name: "Slide Up", keyframeCount: 0 });
  });

  it("handles undefined animationSequences array", () => {
    const site = { components: [] };
    setSession(makeSession({ site } as any));
    expect(listAnimationSequences()).toEqual([]);
  });
});

describe("createAnimationSequence", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("creates a sequence with no keyframes", async () => {
    const site = { components: [], animationSequences: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockAddAnimationSequence.mockReturnValue({
      _type: "AnimationSequence", uuid: "new-s1", name: "Bounce",
      keyframes: [],
    });

    const result = await createAnimationSequence(api, "Bounce");
    expect(result.sequenceUuid).toBe("new-s1");
    expect(result.name).toBe("Bounce");
    expect(mockAddAnimationSequence).toHaveBeenCalled();
  });

  it("creates a sequence with keyframes", async () => {
    const site = { components: [], animationSequences: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const kfs: any[] = [];
    mockAddAnimationSequence.mockReturnValue({
      _type: "AnimationSequence", uuid: "new-s2", name: "Fade In",
      keyframes: kfs,
    });

    const result = await createAnimationSequence(api, "Fade In", [
      { percentage: 0, styles: { opacity: "0" } },
      { percentage: 100, styles: { opacity: "1" } },
    ]);
    expect(result.name).toBe("Fade In");
    expect(kfs).toHaveLength(2);
    expect(kfs[0].percentage).toBe(0);
    expect(kfs[1].percentage).toBe(100);
  });

  it("rejects invalid keyframe percentage", async () => {
    const site = { components: [], animationSequences: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockAddAnimationSequence.mockReturnValue({
      _type: "AnimationSequence", uuid: "s", name: "Bad", keyframes: [],
    });

    await expect(
      createAnimationSequence(api, "Bad", [{ percentage: 150, styles: {} }])
    ).rejects.toThrow(/0-100/);
  });
});

describe("updateAnimationSequence", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("renames a sequence", async () => {
    const seq = { uuid: "s1", name: "Old", keyframes: [] };
    const site = { components: [], animationSequences: [seq] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateAnimationSequence(api, "Old", "New");
    expect(result.updatedFields).toContain("name");
    expect(mockRenameAnimationSequence).toHaveBeenCalledWith(seq, "New");
  });

  it("replaces keyframes", async () => {
    const seq = { uuid: "s1", name: "Fade", keyframes: [{ percentage: 0 }] };
    const site = { components: [], animationSequences: [seq] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateAnimationSequence(api, "Fade", undefined, [
      { percentage: 0, styles: { opacity: "0" } },
      { percentage: 50, styles: { opacity: "0.5" } },
      { percentage: 100, styles: { opacity: "1" } },
    ]);
    expect(result.updatedFields).toContain("keyframes");
    expect(seq.keyframes).toHaveLength(3);
  });

  it("throws when neither name nor keyframes provided", async () => {
    const seq = { uuid: "s1", name: "Test", keyframes: [] };
    const site = { components: [], animationSequences: [seq] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateAnimationSequence(api, "Test", undefined, undefined)
    ).rejects.toThrow(/At least/);
  });

  it("throws when sequence not found", async () => {
    const site = { components: [], animationSequences: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateAnimationSequence(api, "nonexistent", "New")
    ).rejects.toThrow(/not found/);
  });
});

describe("removeAnimationSequence", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("removes a sequence by name", async () => {
    const seq = { uuid: "s1", name: "FadeOut", keyframes: [] };
    const site = { components: [], animationSequences: [seq] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeAnimationSequence(api, "FadeOut");
    expect(result.removedName).toBe("FadeOut");
    expect(result.removedUuid).toBe("s1");
    expect(mockRemoveAnimationSequence).toHaveBeenCalledWith(seq);
  });

  it("throws when sequence not found", async () => {
    const site = { components: [], animationSequences: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeAnimationSequence(api, "nonexistent")
    ).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// Themes — CRUD for site-level themes
// =============================================================================

describe("listThemes", () => {
  afterEach(() => {
    clearSession();
  });

  it("returns empty array when no themes exist", () => {
    const site = { components: [], themes: [] };
    setSession(makeSession({ site } as any));
    expect(listThemes()).toEqual([]);
  });

  it("returns themes with active status and styles", () => {
    const theme1 = {
      defaultStyle: { name: "Default Typography", rs: { values: { fontSize: "16px" } } },
      styles: [{ selector: "h1", style: { rs: { values: { fontSize: "32px" } } } }],
    };
    const theme2 = {
      defaultStyle: { name: "Custom Typography", rs: { values: { fontSize: "14px" } } },
      styles: [],
    };
    const site = { components: [], themes: [theme1, theme2], activeTheme: theme1 };
    setSession(makeSession({ site } as any));

    const result = listThemes();
    expect(result).toHaveLength(2);
    expect(result[0].index).toBe(0);
    expect(result[0].isActive).toBe(true);
    expect(result[0].defaultStyleName).toBe("Default Typography");
    expect(result[0].defaultStyles).toEqual({ fontSize: "16px" });
    expect(result[0].themeStyles).toHaveLength(1);
    expect(result[0].themeStyles[0].selector).toBe("h1");
    expect(result[1].isActive).toBe(false);
  });
});

describe("createTheme", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("creates a theme with default styles", async () => {
    const site = { components: [], themes: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createTheme(api, { fontSize: "16px" });
    expect(result.themeIndex).toBe(0);
    expect(site.themes).toHaveLength(1);
    expect(site.themes[0].defaultStyle.rs.values).toHaveProperty("fontSize", "16px");
  });

  it("creates a theme with per-tag overrides", async () => {
    const site = { components: [], themes: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createTheme(api, undefined, [
      { selector: "h1", styles: { fontSize: "32px" } },
      { selector: "a", styles: { color: "blue" } },
    ]);
    expect(result.themeIndex).toBe(0);
    expect(site.themes[0].styles).toHaveLength(2);
  });

  it("sets theme as active when setActive is true", async () => {
    const site = { components: [], themes: [], activeTheme: null };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await createTheme(api, undefined, undefined, true);
    expect(site.activeTheme).toBe(site.themes[0]);
  });

  it("rejects invalid selector", async () => {
    const site = { components: [], themes: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      createTheme(api, undefined, [{ selector: "div", styles: { color: "red" } }])
    ).rejects.toThrow(/Invalid selector/);
  });
});

describe("updateTheme", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("updates default styles", async () => {
    const defaultStyle = { name: "Default", rs: { values: { fontSize: "16px" } } };
    const theme = { defaultStyle, styles: [] };
    const site = { components: [], themes: [theme] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateTheme(api, 0, { fontSize: "18px", color: "red" });
    expect(result.updatedFields).toContain("defaultStyles");
    expect(defaultStyle.rs.values).toHaveProperty("fontSize", "18px");
    expect(defaultStyle.rs.values).toHaveProperty("color", "red");
  });

  it("updates existing ThemeStyle", async () => {
    const h1Style = { selector: "h1", style: { rs: { values: { fontSize: "32px" } } } };
    const theme = { defaultStyle: { name: "D", rs: { values: {} } }, styles: [h1Style] };
    const site = { components: [], themes: [theme] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateTheme(api, 0, undefined, [{ selector: "h1", styles: { fontSize: "36px" } }]);
    expect(h1Style.style.rs.values).toHaveProperty("fontSize", "36px");
  });

  it("adds new ThemeStyle for unknown selector", async () => {
    const theme = { defaultStyle: { name: "D", rs: { values: {} } }, styles: [] };
    const site = { components: [], themes: [theme] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateTheme(api, 0, undefined, [{ selector: "h2", styles: { fontSize: "28px" } }]);
    expect(theme.styles).toHaveLength(1);
    expect((theme.styles[0] as any).selector).toBe("h2");
  });

  it("throws when theme index out of range", async () => {
    const site = { components: [], themes: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(updateTheme(api, 0, { color: "red" })).rejects.toThrow(/out of range/);
  });

  it("throws when neither field provided", async () => {
    const theme = { defaultStyle: { name: "D", rs: { values: {} } }, styles: [] };
    const site = { components: [], themes: [theme] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(updateTheme(api, 0)).rejects.toThrow(/At least/);
  });
});

describe("removeTheme", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("removes an inactive theme", async () => {
    const theme1 = { defaultStyle: {}, styles: [] };
    const theme2 = { defaultStyle: {}, styles: [] };
    const site = { components: [], themes: [theme1, theme2], activeTheme: theme1 };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeTheme(api, 1);
    expect(result.removedIndex).toBe(1);
    expect(site.themes).toHaveLength(1);
  });

  it("throws when removing active theme", async () => {
    const theme = { defaultStyle: {}, styles: [] };
    const site = { components: [], themes: [theme], activeTheme: theme };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeTheme(api, 0)).rejects.toThrow(/active theme/);
  });

  it("throws when index out of range", async () => {
    const site = { components: [], themes: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeTheme(api, 0)).rejects.toThrow(/out of range/);
  });
});

describe("setActiveTheme", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("sets a theme as active", async () => {
    const theme1 = { defaultStyle: {}, styles: [] };
    const theme2 = { defaultStyle: {}, styles: [] };
    const site = { components: [], themes: [theme1, theme2], activeTheme: theme1 };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await setActiveTheme(api, 1);
    expect(result.activeThemeIndex).toBe(1);
    expect(site.activeTheme).toBe(theme2);
  });

  it("deactivates all themes when null", async () => {
    const theme = { defaultStyle: {}, styles: [] };
    const site = { components: [], themes: [theme], activeTheme: theme };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await setActiveTheme(api, null);
    expect(result.activeThemeIndex).toBe(-1);
    expect(site.activeTheme).toBeNull();
  });

  it("throws when index out of range", async () => {
    const site = { components: [], themes: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(setActiveTheme(api, 0)).rejects.toThrow(/out of range/);
  });
});

// =============================================================================
// Image Assets CRUD
// =============================================================================

describe("listAssets", () => {
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("lists all image assets", () => {
    const assets = [
      { uuid: "a1", name: "Hero Banner", type: "picture", width: 1920, height: 1080, aspectRatio: 16/9 },
      { uuid: "a2", name: "Logo", type: "icon", width: null, height: null },
    ];
    const session = makeSession({ site: { components: [], imageAssets: assets } } as any);
    setSession(session);

    const result = listAssets();
    expect(result.assets).toHaveLength(2);
    expect(result.assets[0]).toEqual({
      uuid: "a1", name: "Hero Banner", type: "picture",
      width: 1920, height: 1080, aspectRatio: 16/9,
    });
    expect(result.assets[1]).toEqual({ uuid: "a2", name: "Logo", type: "icon" });
  });

  it("filters by type", () => {
    const assets = [
      { uuid: "a1", name: "Hero", type: "picture" },
      { uuid: "a2", name: "Logo", type: "icon" },
    ];
    const session = makeSession({ site: { components: [], imageAssets: assets } } as any);
    setSession(session);

    const result = listAssets("icon");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].name).toBe("Logo");
  });

  it("returns empty array when no assets", () => {
    const session = makeSession({ site: { components: [], imageAssets: [] } } as any);
    setSession(session);

    const result = listAssets();
    expect(result.assets).toHaveLength(0);
  });
});

describe("uploadAsset", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => {
    vi.clearAllMocks();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); vi.restoreAllMocks(); });

  it("creates an asset from dataUri via TplMgr.addImageAsset", async () => {
    const site = { components: [], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockAddImageAsset.mockReturnValue({
      uuid: "asset-1", name: "Hero", type: "picture",
      dataUri: "data:image/png;base64,abc", width: 800, height: 600,
    });

    const result = await uploadAsset(api, "Hero", "picture", {
      dataUri: "data:image/png;base64,abc",
      width: 800,
      height: 600,
    });

    expect(mockAddImageAsset).toHaveBeenCalledWith({
      name: "Hero",
      type: "picture",
      dataUri: "data:image/png;base64,abc",
      width: 800,
      height: 600,
      aspectRatio: 800 / 600,
    });
    expect(result.assetUuid).toBe("asset-1");
    expect(result.name).toBe("Hero");
    expect(result.type).toBe("picture");
    expect(result.save.revisionNum).toBe(11);
  });

  it("throws when neither url nor dataUri provided", async () => {
    const site = { components: [], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(uploadAsset(api, "Test", "picture", {})).rejects.toThrow(
      /Either url or dataUri must be provided/
    );
  });

  it("creates an asset from URL via fetch", async () => {
    const site = { components: [], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);

    mockAddImageAsset.mockReturnValue({
      uuid: "asset-2", name: "Photo", type: "picture",
    });

    const result = await uploadAsset(api, "Photo", "picture", {
      url: "https://example.com/photo.jpg",
    });

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/photo.jpg");
    expect(mockAddImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Photo",
        type: "picture",
        dataUri: expect.stringContaining("data:image/jpeg;base64,"),
      })
    );
    expect(result.assetUuid).toBe("asset-2");

    vi.unstubAllGlobals();
  });

  it("throws on non-image content type from URL", async () => {
    const site = { components: [], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "text/html" },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }));

    await expect(
      uploadAsset(api, "Bad", "picture", { url: "https://example.com/page.html" })
    ).rejects.toThrow(/does not point to a supported image format/);

    vi.unstubAllGlobals();
  });
});

describe("renameAsset", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => {
    vi.clearAllMocks();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); vi.restoreAllMocks(); });

  it("renames an asset via TplMgr.renameImageAsset", async () => {
    const asset = { uuid: "a1", name: "Old Name", type: "picture" };
    const site = { components: [], imageAssets: [asset] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await renameAsset(api, "Old Name", "New Name");

    expect(mockRenameImageAsset).toHaveBeenCalledWith(asset, "New Name");
    expect(result.oldName).toBe("Old Name");
    expect(result.assetUuid).toBe("a1");
    expect(result.save.revisionNum).toBe(11);
  });

  it("finds asset by UUID", async () => {
    const asset = { uuid: "a1", name: "Hero", type: "picture" };
    const site = { components: [], imageAssets: [asset] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await renameAsset(api, "a1", "Banner");
    expect(mockRenameImageAsset).toHaveBeenCalledWith(asset, "Banner");
  });

  it("throws when asset not found", async () => {
    const site = { components: [], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(renameAsset(api, "Nonexistent", "New")).rejects.toThrow(/not found/);
  });
});

describe("removeAsset", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => {
    vi.clearAllMocks();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); vi.restoreAllMocks(); });

  it("removes an asset via TplMgr.removeImageAsset", async () => {
    const asset = { uuid: "a1", name: "Old Image", type: "picture" };
    const site = { components: [], imageAssets: [asset] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeAsset(api, "Old Image");

    expect(mockRemoveImageAsset).toHaveBeenCalledWith(asset);
    expect(result.removedName).toBe("Old Image");
    expect(result.removedUuid).toBe("a1");
    expect(result.save.revisionNum).toBe(11);
  });

  it("throws when asset not found", async () => {
    const site = { components: [], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeAsset(api, "Nonexistent")).rejects.toThrow(/not found/);
  });
});
