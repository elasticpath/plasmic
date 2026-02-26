/**
 * Unit tests for edit-tools.ts
 *
 * Edit tools are the bridge between user intent ("change this text") and model
 * mutations + persistence. Each tool must correctly:
 *   1. Resolve the target node from a human-readable reference
 *   2. Perform the mutation inside a recorded session (for incremental save)
 *   3. Handle error cases (wrong node type, missing node, cycle, root removal)
 *   4. Save the changes and return the new revision number
 *
 * Tests use the same mock patterns as save-manager.test.ts:
 *   - Plain objects with _type discriminators for model instances
 *   - mockWithRecording to control ChangeRecorder output
 *   - mockApiClient for save endpoint assertions
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  updateText,
  updateStyles,
  updateAttrs,
  addChild,
  removeChild,
  moveChild,
  cloneChild,
  resolveVariant,
  listVariants,
  createStyleVariant,
  createVariantGroup,
  renameComponent,
  updatePageMeta,
  deleteComponent,
  sanitizeStyles,
  isValidStyleProp,
  validateStyleProperties,
  getValidStylePropertyNames,
  resolveTokenReferences,
  setVisibility,
  setDataCond,
  setDataRep,
  createToken,
  updateToken,
  removeToken,
  duplicateToken,
  listProps,
  addProp,
  removeProp,
  updateProp,
  updateRichText,
  listStates,
  addState,
  removeState,
  updateState,
  listInteractions,
  addInteraction,
  removeInteraction,
  listQueries,
  addQuery,
  removeQuery,
  updateQuery,
  listMixins,
  createMixin,
  updateMixin,
  removeMixin,
  applyMixin,
  detachMixin,
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  mockEnsureBaseVariantSetting,
  mockEnsureBaseVariant,
  mockRenameComponent,
  mockRemoveComponent,
  mockCreateStyleVariant,
  mockCreatePrivateStyleVariant,
  mockCreateVariantGroup,
  mockCreateVariant,
  mockAddStyleToken,
  mockRenameStyleToken,
  mockDuplicateStyleToken,
  mockGetUniqueParamName,
  mockRenameParam,
  mockRemoveComponentQuery,
  mockRemoveComponentServerQuery,
  mockAddMixin,
  mockRemoveMixin,
  mockRenameMixin,
} from "../__mocks__/wab-tpl-mgr";
import { mockMkTplTagX, mockMkTplInlinedText, mockMkTplComponentX } from "../__mocks__/wab-tpls";
import { mockEnsureVariantSetting } from "../__mocks__/wab-variants";
import { mockUndoChanges } from "../__mocks__/wab-undo-util";
import type { PlasmicApiClient } from "../api-client";
import type { Session } from "../session";

// --- Test helpers ---

function mockApiClient() {
  return {
    saveRevision: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn(),
    getProjectBundle: vi.fn(),
    updateProject: vi.fn(),
  } as unknown as PlasmicApiClient & { saveRevision: ReturnType<typeof vi.fn> };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    projectId: "proj1",
    projectName: "Test",
    site: { components: [] },
    bundler: {
      fastBundle: mockFastBundle,
      addrOf: mockAddrOf,
      bundle: vi.fn().mockReturnValue({ map: {}, root: "0" }),
    },
    revisionNum: 10,
    modelVersion: 5,
    hostlessDataVersion: 2,
    projectUuid: "proj1",
    ...overrides,
  };
}

/** Build a TplTag node with optional children and text */
function mkTag(opts: {
  uuid?: string;
  name?: string;
  tag?: string;
  text?: string;
  children?: any[];
  styles?: Record<string, string>;
}): any {
  const vs: any = {
    rs: { values: { ...(opts.styles ?? {}) } },
  };
  if (opts.text !== undefined) {
    vs.text = { _type: "RawText", text: opts.text, markers: [] };
  }
  return {
    _type: "TplTag",
    uuid: opts.uuid ?? `uuid-${Math.random().toString(36).slice(2, 8)}`,
    name: opts.name,
    tag: opts.tag ?? "div",
    vsettings: [vs],
    children: opts.children ?? [],
  };
}

/** Build a component with a tplTree */
function mkComponent(opts: {
  uuid?: string;
  name?: string;
  tplTree: any;
}): any {
  return {
    uuid: opts.uuid ?? "comp-uuid",
    name: opts.name ?? "TestComponent",
    tplTree: opts.tplTree,
    pageMeta: undefined,
  };
}

// =============================================================================
// sanitizeStyles — direct unit tests for CSS shorthand expansion
//
// sanitizeStyles is the gateway between user-supplied CSS and Plasmic's
// RuleSet model. Incorrect expansion causes site-invariant violations
// (Plasmic rejects shorthands) or silent data loss (dropped background
// longhands). These tests cover every expansion branch.
// =============================================================================

describe("sanitizeStyles", () => {
  // --- Padding shorthand ---

  it("expands padding with 1 value to all four longhands", () => {
    const result = sanitizeStyles({ padding: "10px" });
    expect(result).toEqual({
      paddingTop: "10px",
      paddingRight: "10px",
      paddingBottom: "10px",
      paddingLeft: "10px",
    });
  });

  it("expands padding with 2 values (vertical horizontal)", () => {
    const result = sanitizeStyles({ padding: "10px 20px" });
    expect(result).toEqual({
      paddingTop: "10px",
      paddingRight: "20px",
      paddingBottom: "10px",
      paddingLeft: "20px",
    });
  });

  it("expands padding with 3 values (top horizontal bottom)", () => {
    const result = sanitizeStyles({ padding: "10px 20px 30px" });
    expect(result).toEqual({
      paddingTop: "10px",
      paddingRight: "20px",
      paddingBottom: "30px",
      paddingLeft: "20px",
    });
  });

  it("expands padding with 4 values (top right bottom left)", () => {
    const result = sanitizeStyles({ padding: "10px 20px 30px 40px" });
    expect(result).toEqual({
      paddingTop: "10px",
      paddingRight: "20px",
      paddingBottom: "30px",
      paddingLeft: "40px",
    });
  });

  it("accepts padding-shorthand alias", () => {
    const result = sanitizeStyles({ "padding-shorthand": "5px" });
    expect(result.paddingTop).toBe("5px");
    expect(result.paddingLeft).toBe("5px");
  });

  // --- Margin shorthand ---

  it("expands margin with 2 values", () => {
    const result = sanitizeStyles({ margin: "8px 16px" });
    expect(result).toEqual({
      marginTop: "8px",
      marginRight: "16px",
      marginBottom: "8px",
      marginLeft: "16px",
    });
  });

  it("accepts margin-shorthand alias", () => {
    const result = sanitizeStyles({ "margin-shorthand": "4px" });
    expect(result.marginTop).toBe("4px");
    expect(result.marginRight).toBe("4px");
  });

  // --- Gap shorthand ---

  it("expands gap with 1 value to row-gap and column-gap", () => {
    const result = sanitizeStyles({ gap: "12px" });
    expect(result).toEqual({
      "row-gap": "12px",
      "column-gap": "12px",
    });
  });

  it("expands gap with 2 values (row column)", () => {
    const result = sanitizeStyles({ gap: "10px 20px" });
    expect(result).toEqual({
      "row-gap": "10px",
      "column-gap": "20px",
    });
  });

  // --- Border-radius shorthand ---

  it("expands borderRadius with 1 value", () => {
    const result = sanitizeStyles({ borderRadius: "8px" });
    expect(result).toEqual({
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "8px",
      "border-bottom-left-radius": "8px",
    });
  });

  it("expands border-radius kebab alias with 4 values", () => {
    const result = sanitizeStyles({ "border-radius": "4px 8px 12px 16px" });
    expect(result).toEqual({
      "border-top-left-radius": "4px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "12px",
      "border-bottom-left-radius": "16px",
    });
  });

  // --- Border-width shorthand ---

  it("expands borderWidth to side longhands", () => {
    const result = sanitizeStyles({ borderWidth: "1px 2px" });
    expect(result).toEqual({
      "border-top-width": "1px",
      "border-right-width": "2px",
      "border-bottom-width": "1px",
      "border-left-width": "2px",
    });
  });

  it("accepts border-width kebab alias", () => {
    const result = sanitizeStyles({ "border-width": "3px" });
    expect(result["border-top-width"]).toBe("3px");
    expect(result["border-left-width"]).toBe("3px");
  });

  // --- Border-style shorthand ---

  it("expands borderStyle to side longhands", () => {
    const result = sanitizeStyles({ borderStyle: "solid dashed" });
    expect(result).toEqual({
      "border-top-style": "solid",
      "border-right-style": "dashed",
      "border-bottom-style": "solid",
      "border-left-style": "dashed",
    });
  });

  it("accepts border-style kebab alias", () => {
    const result = sanitizeStyles({ "border-style": "dotted" });
    expect(result["border-top-style"]).toBe("dotted");
  });

  // --- Border-color shorthand ---

  it("expands borderColor to side longhands", () => {
    const result = sanitizeStyles({ borderColor: "red blue green yellow" });
    expect(result).toEqual({
      "border-top-color": "red",
      "border-right-color": "blue",
      "border-bottom-color": "green",
      "border-left-color": "yellow",
    });
  });

  it("accepts border-color kebab alias", () => {
    const result = sanitizeStyles({ "border-color": "#000" });
    expect(result["border-top-color"]).toBe("#000");
    expect(result["border-left-color"]).toBe("#000");
  });

  // --- Inset shorthand ---

  it("expands inset to top/right/bottom/left", () => {
    const result = sanitizeStyles({ inset: "0" });
    expect(result).toEqual({
      top: "0",
      right: "0",
      bottom: "0",
      left: "0",
    });
  });

  it("expands inset with 2 values", () => {
    const result = sanitizeStyles({ inset: "10px 20px" });
    expect(result).toEqual({
      top: "10px",
      right: "20px",
      bottom: "10px",
      left: "20px",
    });
  });

  // --- Background handling ---

  it("converts backgroundColor to linear-gradient background", () => {
    const result = sanitizeStyles({ backgroundColor: "#ff0000" });
    expect(result).toEqual({
      background: "linear-gradient(#ff0000, #ff0000)",
    });
  });

  it("accepts background-color kebab alias", () => {
    const result = sanitizeStyles({ "background-color": "blue" });
    expect(result).toEqual({
      background: "linear-gradient(blue, blue)",
    });
  });

  it("passes backgroundImage directly as background", () => {
    const result = sanitizeStyles({
      backgroundImage: "url(https://example.com/img.png)",
    });
    expect(result).toEqual({
      background: "url(https://example.com/img.png)",
    });
  });

  it("accepts background-image kebab alias", () => {
    const result = sanitizeStyles({
      "background-image": "url(test.png)",
    });
    expect(result).toEqual({ background: "url(test.png)" });
  });

  it("backgroundImage takes precedence over backgroundColor", () => {
    const result = sanitizeStyles({
      backgroundColor: "red",
      backgroundImage: "url(bg.png)",
    });
    // bgImage wins over bgColor in the post-loop consolidation
    expect(result).toEqual({ background: "url(bg.png)" });
  });

  it("explicit background shorthand overrides bgColor and bgImage", () => {
    const result = sanitizeStyles({
      backgroundColor: "red",
      backgroundImage: "url(bg.png)",
      background: "linear-gradient(blue, green)",
    });
    expect(result).toEqual({ background: "linear-gradient(blue, green)" });
  });

  it("drops unsupported background longhands and logs warning", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = sanitizeStyles({
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      fontSize: "16px",
    });

    // Longhands are dropped, pass-through property preserved
    expect(result).toEqual({ fontSize: "16px" });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dropped unsupported background longhands")
    );

    consoleSpy.mockRestore();
  });

  it("drops all background longhand variants (camel + kebab)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = sanitizeStyles({
      "background-size": "contain",
      "background-position": "top left",
      "background-repeat": "repeat-x",
      "background-attachment": "fixed",
      "background-origin": "padding-box",
      "background-clip": "border-box",
    });

    expect(Object.keys(result)).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  // --- Pass-through and edge cases ---

  it("passes through unknown properties unchanged", () => {
    const result = sanitizeStyles({
      color: "red",
      fontSize: "16px",
      display: "flex",
      "--custom-var": "42px",
    });
    expect(result).toEqual({
      color: "red",
      fontSize: "16px",
      display: "flex",
      "--custom-var": "42px",
    });
  });

  it("returns empty object for empty input", () => {
    const result = sanitizeStyles({});
    expect(result).toEqual({});
  });

  it("handles multiple shorthands in a single call", () => {
    const result = sanitizeStyles({
      padding: "10px 20px",
      margin: "5px",
      gap: "8px",
      borderRadius: "4px",
      backgroundColor: "#fff",
    });

    expect(result.paddingTop).toBe("10px");
    expect(result.paddingRight).toBe("20px");
    expect(result.marginTop).toBe("5px");
    expect(result.marginLeft).toBe("5px");
    expect(result["row-gap"]).toBe("8px");
    expect(result["column-gap"]).toBe("8px");
    expect(result["border-top-left-radius"]).toBe("4px");
    expect(result.background).toBe("linear-gradient(#fff, #fff)");
  });

  // --- Border combined shorthand ---

  it("expands border with 3 values (width style color) to 12 longhands", () => {
    const result = sanitizeStyles({ border: "1px solid #FCA5A5" });
    expect(result).toEqual({
      "border-top-width": "1px",
      "border-top-style": "solid",
      "border-top-color": "#FCA5A5",
      "border-right-width": "1px",
      "border-right-style": "solid",
      "border-right-color": "#FCA5A5",
      "border-bottom-width": "1px",
      "border-bottom-style": "solid",
      "border-bottom-color": "#FCA5A5",
      "border-left-width": "1px",
      "border-left-style": "solid",
      "border-left-color": "#FCA5A5",
    });
  });

  it("expands border with 2 values (width style, no color) to 8 longhands", () => {
    const result = sanitizeStyles({ border: "1px solid" });
    expect(result).toEqual({
      "border-top-width": "1px",
      "border-top-style": "solid",
      "border-right-width": "1px",
      "border-right-style": "solid",
      "border-bottom-width": "1px",
      "border-bottom-style": "solid",
      "border-left-width": "1px",
      "border-left-style": "solid",
    });
  });

  it("expands border with width only to 4 longhands", () => {
    const result = sanitizeStyles({ border: "1px" });
    expect(result).toEqual({
      "border-top-width": "1px",
      "border-right-width": "1px",
      "border-bottom-width": "1px",
      "border-left-width": "1px",
    });
  });

  it("expands border with style only to 4 longhands", () => {
    const result = sanitizeStyles({ border: "solid" });
    expect(result).toEqual({
      "border-top-style": "solid",
      "border-right-style": "solid",
      "border-bottom-style": "solid",
      "border-left-style": "solid",
    });
  });

  it("expands border: none to 4 style longhands", () => {
    const result = sanitizeStyles({ border: "none" });
    expect(result).toEqual({
      "border-top-style": "none",
      "border-right-style": "none",
      "border-bottom-style": "none",
      "border-left-style": "none",
    });
  });

  it("expands border: inherit to all 12 longhands", () => {
    const result = sanitizeStyles({ border: "inherit" });
    expect(result).toEqual({
      "border-top-width": "inherit",
      "border-top-style": "inherit",
      "border-top-color": "inherit",
      "border-right-width": "inherit",
      "border-right-style": "inherit",
      "border-right-color": "inherit",
      "border-bottom-width": "inherit",
      "border-bottom-style": "inherit",
      "border-bottom-color": "inherit",
      "border-left-width": "inherit",
      "border-left-style": "inherit",
      "border-left-color": "inherit",
    });
  });

  it("handles border with rgb() color value", () => {
    const result = sanitizeStyles({ border: "2px dashed rgb(252, 165, 165)" });
    expect(result["border-top-width"]).toBe("2px");
    expect(result["border-top-style"]).toBe("dashed");
    expect(result["border-top-color"]).toBe("rgb(252, 165, 165)");
    expect(result["border-bottom-color"]).toBe("rgb(252, 165, 165)");
  });

  it("handles border width keyword (thin, medium, thick)", () => {
    const result = sanitizeStyles({ border: "thick double navy" });
    expect(result["border-top-width"]).toBe("thick");
    expect(result["border-top-style"]).toBe("double");
    expect(result["border-top-color"]).toBe("navy");
  });

  // --- Border side shorthands ---

  it("expands borderTop shorthand to 3 longhands", () => {
    const result = sanitizeStyles({ borderTop: "2px dashed red" });
    expect(result).toEqual({
      "border-top-width": "2px",
      "border-top-style": "dashed",
      "border-top-color": "red",
    });
  });

  it("expands border-right shorthand (kebab-case) to 3 longhands", () => {
    const result = sanitizeStyles({ "border-right": "1px solid blue" });
    expect(result).toEqual({
      "border-right-width": "1px",
      "border-right-style": "solid",
      "border-right-color": "blue",
    });
  });

  it("expands borderBottom shorthand to 3 longhands", () => {
    const result = sanitizeStyles({ borderBottom: "3px dotted green" });
    expect(result).toEqual({
      "border-bottom-width": "3px",
      "border-bottom-style": "dotted",
      "border-bottom-color": "green",
    });
  });

  it("expands borderLeft shorthand to 3 longhands", () => {
    const result = sanitizeStyles({ borderLeft: "1px solid #ccc" });
    expect(result).toEqual({
      "border-left-width": "1px",
      "border-left-style": "solid",
      "border-left-color": "#ccc",
    });
  });

  // --- Outline shorthand ---

  it("expands outline with 3 values to 3 longhands", () => {
    const result = sanitizeStyles({ outline: "1px solid #000" });
    expect(result).toEqual({
      "outline-width": "1px",
      "outline-style": "solid",
      "outline-color": "#000",
    });
  });

  it("expands outline: none to outline-style only", () => {
    const result = sanitizeStyles({ outline: "none" });
    expect(result).toEqual({
      "outline-style": "none",
    });
  });

  // --- Border + borderRadius together ---

  it("expands border and borderRadius together to 16 longhands", () => {
    const result = sanitizeStyles({
      border: "1px solid #ccc",
      borderRadius: "8px",
    });
    // 12 border longhands + 4 radius longhands = 16
    expect(Object.keys(result)).toHaveLength(16);
    expect(result["border-top-width"]).toBe("1px");
    expect(result["border-top-style"]).toBe("solid");
    expect(result["border-top-color"]).toBe("#ccc");
    expect(result["border-top-left-radius"]).toBe("8px");
    expect(result["border-bottom-right-radius"]).toBe("8px");
  });
});

// =============================================================================
// CSS Property Validation — ensures update-styles rejects invalid properties
// with helpful "did you mean?" suggestions, preventing trial-and-error when
// users mistype property names or use unsupported shorthands.
// =============================================================================

describe("isValidStyleProp", () => {
  it("accepts standard CSS properties (kebab-case)", () => {
    expect(isValidStyleProp("color")).toBe(true);
    expect(isValidStyleProp("font-size")).toBe(true);
    expect(isValidStyleProp("display")).toBe(true);
    expect(isValidStyleProp("padding-top")).toBe(true);
    expect(isValidStyleProp("border-top-width")).toBe(true);
  });

  it("accepts standard CSS properties (camelCase)", () => {
    expect(isValidStyleProp("fontSize")).toBe(true);
    expect(isValidStyleProp("paddingTop")).toBe(true);
    expect(isValidStyleProp("borderTopWidth")).toBe(true);
    expect(isValidStyleProp("flexDirection")).toBe(true);
  });

  it("accepts CSS custom properties (--*)", () => {
    expect(isValidStyleProp("--custom-var")).toBe(true);
    expect(isValidStyleProp("--my-color")).toBe(true);
  });

  it("accepts vendor-prefixed properties", () => {
    expect(isValidStyleProp("-webkit-transform")).toBe(true);
    expect(isValidStyleProp("-moz-appearance")).toBe(true);
    expect(isValidStyleProp("-ms-grid")).toBe(true);
  });

  it("accepts modern CSS properties in additional set", () => {
    expect(isValidStyleProp("row-gap")).toBe(true);
    expect(isValidStyleProp("column-gap")).toBe(true);
    expect(isValidStyleProp("aspect-ratio")).toBe(true);
    expect(isValidStyleProp("object-fit")).toBe(true);
    expect(isValidStyleProp("grid-template-columns")).toBe(true);
  });

  it("rejects truly invalid property names", () => {
    expect(isValidStyleProp("bordr")).toBe(false);
    expect(isValidStyleProp("fontsiz")).toBe(false);
    expect(isValidStyleProp("customprop")).toBe(false);
    expect(isValidStyleProp("foobar")).toBe(false);
  });
});

describe("validateStyleProperties", () => {
  it("passes for valid properties", () => {
    expect(() =>
      validateStyleProperties({
        color: "red",
        "font-size": "16px",
        display: "flex",
        "padding-top": "10px",
      })
    ).not.toThrow();
  });

  it("passes for CSS custom properties", () => {
    expect(() =>
      validateStyleProperties({ "--custom-var": "#fff" })
    ).not.toThrow();
  });

  it("throws for invalid property with 'Did you mean' suggestions", () => {
    expect(() =>
      validateStyleProperties({ bordr: "1px" })
    ).toThrow(/Unknown CSS property "bordr".*Did you mean.*"border"/);
  });

  it("throws with property name in error message", () => {
    expect(() =>
      validateStyleProperties({ fontsiz: "16px" })
    ).toThrow(/Unknown CSS property "fontsiz"/);
  });

  it("validates after shorthand expansion (expanded properties are valid)", () => {
    const sanitized = sanitizeStyles({ border: "1px solid #ccc" });
    expect(() => validateStyleProperties(sanitized)).not.toThrow();
  });

  it("validates padding expansion output", () => {
    const sanitized = sanitizeStyles({ padding: "10px 20px" });
    expect(() => validateStyleProperties(sanitized)).not.toThrow();
  });

  it("validates mixed valid + sanitized properties", () => {
    const sanitized = sanitizeStyles({
      border: "1px solid #ccc",
      borderRadius: "8px",
      color: "red",
      display: "flex",
    });
    expect(() => validateStyleProperties(sanitized)).not.toThrow();
  });
});

describe("getValidStylePropertyNames", () => {
  it("returns a sorted array of property names", () => {
    const names = getValidStylePropertyNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(100);
    // Verify sorted
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("includes common CSS properties", () => {
    const names = getValidStylePropertyNames();
    expect(names).toContain("color");
    expect(names).toContain("font-size");
    expect(names).toContain("display");
    expect(names).toContain("padding-top");
    expect(names).toContain("border-top-width");
    expect(names).toContain("border-top-style");
    expect(names).toContain("border-top-color");
    expect(names).toContain("border-top-left-radius");
  });

  it("includes modern CSS properties", () => {
    const names = getValidStylePropertyNames();
    expect(names).toContain("row-gap");
    expect(names).toContain("column-gap");
    expect(names).toContain("aspect-ratio");
    expect(names).toContain("object-fit");
    expect(names).toContain("grid-template-columns");
  });
});

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

  // --- update-text ---

  describe("updateText", () => {
    it("updates existing RawText content", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Hero Title",
        text: "Old text",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      // ensureBaseVariantSetting returns the existing vsettings[0]
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      setupSession(comp);

      const result = await updateText(api, "comp-1", "Hero Title", "New text");

      expect(result.previousText).toBe("Old text");
      expect(result.newText).toBe("New text");
      expect(result.nodeName).toBe("Hero Title");
      expect(result.nodeUuid).toBe("text-1");
      expect(result.save.revisionNum).toBe(11);
      // The mutation callback updated the text
      expect(textNode.vsettings[0].text.text).toBe("New text");
    });

    it("creates new RawText when none exists", async () => {
      const node = mkTag({ uuid: "node-1", name: "Empty Node" });
      // No text set on this node
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateText(api, "comp-1", "Empty Node", "Brand new text");

      expect(result.previousText).toBeUndefined();
      expect(result.newText).toBe("Brand new text");
      // The vsettings[0].text should now be a RawText-like object
      expect(node.vsettings[0].text._type).toBe("RawText");
      expect(node.vsettings[0].text.text).toBe("Brand new text");
    });

    it("rejects update on a container node", async () => {
      const child = mkTag({ uuid: "child-1" });
      const container = mkTag({
        uuid: "container-1",
        name: "Section",
        children: [child],
        styles: { flexDirection: "column" },
      });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        updateText(api, "comp-1", "Section", "Should fail")
      ).rejects.toThrow("container");
    });

    it("rejects update on a non-TplTag node", async () => {
      const compNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "SubComp",
        component: { name: "Other", uuid: "other-uuid" },
        vsettings: [],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [compNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        updateText(api, "comp-1", "tpl-comp-1", "text")
      ).rejects.toThrow("not a TplTag");
    });

    it("throws when component UUID is not found", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        updateText(api, "wrong-uuid", "root-1", "text")
      ).rejects.toThrow('Component UUID "wrong-uuid" not found');
    });

    it("throws when node reference is not found", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        updateText(api, "comp-1", "nonexistent", "text")
      ).rejects.toThrow("not found");
    });

    it("resolves nodes by UUID", async () => {
      const textNode = mkTag({ uuid: "exact-uuid-123", text: "Hello" });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateText(api, "comp-1", "exact-uuid-123", "Updated");
      expect(result.nodeUuid).toBe("exact-uuid-123");
    });

    // --- Dynamic text (ExprText) ---

    it("creates ExprText when dynamic is true", async () => {
      const textNode = mkTag({
        uuid: "dyn-1",
        name: "Price",
        text: "Old static text",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateText(
        api, "comp-1", "Price", "$ctx.product.price",
        undefined, true
      );

      expect(result.previousText).toBe("Old static text");
      expect(result.newText).toBe("$ctx.product.price");
      expect(result.dynamic).toBe(true);
      // The vsettings[0].text should now be an ExprText
      const vs = textNode.vsettings[0];
      expect(vs.text._type).toBe("ExprText");
      expect(vs.text.expr._type).toBe("CustomCode");
      expect(vs.text.expr.code).toBe("$ctx.product.price");
      expect(vs.text.html).toBe(false);
    });

    it("creates ExprText with fallback when provided", async () => {
      const textNode = mkTag({
        uuid: "dyn-fb-1",
        name: "Email",
        text: "Loading...",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateText(
        api, "comp-1", "Email", "$ctx.user.email",
        undefined, true, "N/A"
      );

      expect(result.dynamic).toBe(true);
      expect(result.fallback).toBe("N/A");
      const vs = textNode.vsettings[0];
      expect(vs.text._type).toBe("ExprText");
      expect(vs.text.expr.fallback._type).toBe("CustomCode");
      expect(vs.text.expr.fallback.code).toBe('"N/A"');
    });

    it("creates ExprText with html: true when specified", async () => {
      const textNode = mkTag({ uuid: "dyn-html-1", name: "RichText" });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await updateText(
        api, "comp-1", "RichText", "$ctx.htmlContent",
        undefined, true, undefined, true
      );

      const vs = textNode.vsettings[0];
      expect(vs.text._type).toBe("ExprText");
      expect(vs.text.html).toBe(true);
    });

    it("converts dynamic text back to static (ExprText → RawText)", async () => {
      // Start with an ExprText node
      const textNode = mkTag({ uuid: "dyn-to-static", name: "Title" });
      textNode.vsettings[0].text = {
        _type: "ExprText",
        expr: { _type: "CustomCode", code: "$ctx.title", fallback: null },
        html: false,
      };
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateText(api, "comp-1", "Title", "Static Title");

      expect(result.previousText).toBe("$ctx.title");
      expect(result.newText).toBe("Static Title");
      expect(result.dynamic).toBeUndefined();
      const vs = textNode.vsettings[0];
      expect(vs.text._type).toBe("RawText");
      expect(vs.text.text).toBe("Static Title");
    });

    it("rejects empty expression for dynamic text", async () => {
      const textNode = mkTag({ uuid: "dyn-empty", name: "Empty" });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        updateText(api, "comp-1", "Empty", "", undefined, true)
      ).rejects.toThrow("Dynamic text expression cannot be empty");

      await expect(
        updateText(api, "comp-1", "Empty", "   ", undefined, true)
      ).rejects.toThrow("Dynamic text expression cannot be empty");
    });

    it("does not treat ExprText nodes as containers", async () => {
      // ExprText node with no children should not trigger container check
      const textNode = mkTag({ uuid: "expr-nocontainer", name: "DynText" });
      textNode.vsettings[0].text = {
        _type: "ExprText",
        expr: { _type: "CustomCode", code: "$ctx.old", fallback: null },
        html: false,
      };
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      // Should succeed (not throw container error)
      const result = await updateText(api, "comp-1", "DynText", "new-expr", undefined, true);
      expect(result.newText).toBe("new-expr");
    });

    it("replaces one dynamic expression with another", async () => {
      const textNode = mkTag({ uuid: "dyn-replace", name: "DynReplace" });
      textNode.vsettings[0].text = {
        _type: "ExprText",
        expr: { _type: "CustomCode", code: "$ctx.old", fallback: null },
        html: false,
      };
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateText(
        api, "comp-1", "DynReplace", "$ctx.new",
        undefined, true
      );

      expect(result.previousText).toBe("$ctx.old");
      expect(result.dynamic).toBe(true);
      const vs = textNode.vsettings[0];
      expect(vs.text.expr.code).toBe("$ctx.new");
    });
  });

  // --- update-styles ---

  describe("updateStyles", () => {
    it("sets style properties via RSH merge", async () => {
      const node = mkTag({
        uuid: "styled-1",
        name: "Box",
        styles: { color: "red" },
      });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateStyles(api, "comp-1", "Box", {
        fontSize: "24px",
        backgroundColor: "#ff0000",
      });

      expect(result.updatedProperties).toEqual(["fontSize", "background"]);
      expect(result.nodeName).toBe("Box");
      expect(result.save.revisionNum).toBe(11);
      // RSH mock actually mutates rs.values
      expect(node.vsettings[0].rs.values.fontSize).toBe("24px");
      // backgroundColor is sanitized to a background gradient shorthand
      expect(node.vsettings[0].rs.values.background).toBe(
        "linear-gradient(#ff0000, #ff0000)"
      );
      // Existing style preserved
      expect(node.vsettings[0].rs.values.color).toBe("red");
    });

    it("rejects style update on non-TplTag", async () => {
      const compNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "Sub",
        component: { name: "Other", uuid: "other-uuid" },
        vsettings: [],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [compNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        updateStyles(api, "comp-1", "tpl-comp-1", { color: "blue" })
      ).rejects.toThrow("not a TplTag");
    });

    it("saves with correct modifiedComponentIids", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-42" });
      setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { color: "green" });

      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11,
        expect.objectContaining({
          modifiedComponentIids: ["comp-iid-42"],
        })
      );
    });

    it("rejects invalid CSS property with suggestions", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        updateStyles(api, "comp-1", "Box", { bordr: "1px solid red" })
      ).rejects.toThrow(/Unknown CSS property "bordr".*Did you mean/);
      // Should not save when validation fails
      expect(api.saveRevision).not.toHaveBeenCalled();
    });

    it("accepts valid CSS properties including expanded shorthands", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      // border shorthand → 12 longhands, all should be valid
      const result = await updateStyles(api, "comp-1", "Box", {
        border: "1px solid #ccc",
      });
      expect(result.updatedProperties).toHaveLength(12);
      expect(result.save.revisionNum).toBe(11);
    });
  });

  // --- add-child ---

  describe("addChild", () => {
    it("adds a text child at default position (last)", async () => {
      const existingChild = mkTag({ uuid: "existing-1" });
      const container = mkTag({
        uuid: "container-1",
        name: "Section",
        children: [existingChild],
      });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Text elements use mkTplInlinedText, not mkTplTagX
      const newTpl = mkTag({ uuid: "new-child-1", tag: "div" });
      mockMkTplInlinedText.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      const result = await addChild(
        api,
        "comp-1",
        "Section",
        { type: "text", value: "Hello World" }
      );

      expect(result.parentName).toBe("Section");
      expect(result.position).toBe("last");
      expect(result.save.revisionNum).toBe(11);
      // Child was appended
      expect(container.children.length).toBe(2);
      expect(container.children[1]).toBe(newTpl);
    });

    it("inserts child at 'first' position", async () => {
      const existingChild = mkTag({ uuid: "existing-1" });
      const container = mkTag({
        uuid: "container-1",
        name: "Section",
        children: [existingChild],
      });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-child-1" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      await addChild(
        api,
        "comp-1",
        "Section",
        { type: "box", children: [] },
        "first"
      );

      expect(container.children[0]).toBe(newTpl);
      expect(container.children[1]).toBe(existingChild);
    });

    it("inserts child at numeric index", async () => {
      const child1 = mkTag({ uuid: "child-1" });
      const child2 = mkTag({ uuid: "child-2" });
      const container = mkTag({
        uuid: "container-1",
        name: "Section",
        children: [child1, child2],
      });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-child-1" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      await addChild(api, "comp-1", "Section", { type: "box" }, 1);

      expect(container.children[0]).toBe(child1);
      expect(container.children[1]).toBe(newTpl);
      expect(container.children[2]).toBe(child2);
    });

    it("rejects adding children to a text node", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Hello",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        addChild(api, "comp-1", "Title", { type: "text", value: "Extra" })
      ).rejects.toThrow("text element and cannot have children");
    });

    it("calls mkTplTagX with correct tag for element types", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      await addChild(api, "comp-1", "Section", {
        type: "img",
        src: "https://example.com/img.png",
      });

      expect(mockMkTplTagX).toHaveBeenCalledWith(
        "img",
        { baseVariant: undefined, styles: {} }
      );
    });
  });

  // --- add-child with component instances ---

  describe("addChild with component instances", () => {
    /** Build a TplComponent-like node (as returned by mkTplComponentX mock) */
    function mkTplComponent(opts: {
      uuid?: string;
      name?: string;
      componentName: string;
      componentUuid: string;
    }): any {
      return {
        _type: "TplComponent",
        uuid: opts.uuid ?? `tpl-comp-${Math.random().toString(36).slice(2, 8)}`,
        name: opts.name ?? null,
        component: { name: opts.componentName, uuid: opts.componentUuid },
        vsettings: [{ rs: { values: {} }, args: [] }],
        children: [],
      };
    }

    it("creates a TplComponent when type is 'component'", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });

      // The component being EDITED (owning component)
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      // The component being REFERENCED (added as an instance)
      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-1",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      // Session must include BOTH the owning component and the referenced component
      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
      });

      expect(result.parentName).toBe("Section");
      expect(result.newNodeUuid).toBe("new-tpl-comp-1");
      expect(result.save.revisionNum).toBe(11);

      // Verify mkTplComponentX was called with the correct component
      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: cardComp,
        })
      );

      // Verify the TplComponent was inserted into the container
      expect(container.children.length).toBe(1);
      expect(container.children[0]).toBe(newTplComp);
    });

    it("resolves component by UUID when name doesn't match", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const headerComp = {
        uuid: "header-uuid-123",
        name: "Header",
        tplTree: mkTag({ uuid: "header-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-2",
        componentName: "Header",
        componentUuid: "header-uuid-123",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, headerComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      // Reference by UUID instead of name
      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "header-uuid-123",
      });

      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: headerComp,
        })
      );
    });

    it("throws descriptive error when component name is not found", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({
        uuid: "comp-1",
        name: "Page",
        tplTree: root,
      });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
      };

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await expect(
        addChild(api, "comp-1", "Section", {
          type: "component",
          name: "NonExistent",
        })
      ).rejects.toThrow('Component "NonExistent" not found');

      // Error should list available component names
      await expect(
        addChild(api, "comp-1", "Section", {
          type: "component",
          name: "NonExistent",
        })
      ).rejects.toThrow("Card");
    });

    it("handles type 'default-component' using kind field", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const buttonComp = {
        uuid: "button-uuid",
        name: "Button",
        tplTree: mkTag({ uuid: "button-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-3",
        componentName: "Button",
        componentUuid: "button-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, buttonComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "default-component",
        kind: "Button",
      });

      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: buttonComp,
        })
      );
      expect(container.children[0]).toBe(newTplComp);
    });

    it("passes children to mkTplComponentX for slot wiring", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [{ variable: { name: "children" } }],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-4",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);

      // mkTplInlinedText is called for the string child inside the component
      const childTpl = mkTag({ uuid: "child-text-1", tag: "div" });
      mockMkTplInlinedText.mockReturnValue(childTpl);

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
        children: [{ type: "text", value: "Card content" }],
      });

      // mkTplComponentX should be called with children array
      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: cardComp,
          children: [childTpl],
        })
      );
    });

    it("finds component from dependency projects", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Component only exists in a dependency, not locally
      const depComp = {
        uuid: "dep-comp-uuid",
        name: "DepButton",
        tplTree: mkTag({ uuid: "dep-button-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-5",
        componentName: "DepButton",
        componentUuid: "dep-comp-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: {
          components: [owningComp],
          projectDependencies: [
            { site: { components: [depComp] } },
          ],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "DepButton",
      });

      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: depComp,
        })
      );
    });
  });

  // --- add-child with component props ---
  //
  // The "props" field on ComponentElement allows setting non-slot prop
  // overrides on component instances. Each prop value is converted to a
  // CustomCode expression and passed as args to mkTplComponentX. This
  // enables richer component composition (e.g., { type: "component",
  // name: "Button", props: { label: "Click me", disabled: true } }).

  describe("addChild with component props", () => {
    /** Build a TplComponent-like node (as returned by mkTplComponentX mock) */
    function mkTplComponent(opts: {
      uuid?: string;
      componentName: string;
      componentUuid: string;
    }): any {
      return {
        _type: "TplComponent",
        uuid: opts.uuid ?? `tpl-comp-${Math.random().toString(36).slice(2, 8)}`,
        name: null,
        component: { name: opts.componentName, uuid: opts.componentUuid },
        vsettings: [{ rs: { values: {} }, args: [] }],
        children: [],
      };
    }

    it("passes props as args dict to mkTplComponentX", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const buttonComp = {
        uuid: "button-uuid",
        name: "Button",
        tplTree: mkTag({ uuid: "button-root" }),
        params: [
          { variable: { name: "label" } },
          { variable: { name: "disabled" } },
          { variable: { name: "count" } },
        ],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-1",
        componentName: "Button",
        componentUuid: "button-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, buttonComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Button",
        props: { label: "Click me", disabled: true, count: 42 },
      });

      // mkTplComponentX should receive an args dict with CustomCode values
      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.component).toBe(buttonComp);
      expect(callArgs.args).toBeDefined();
      expect(callArgs.args.label._type).toBe("CustomCode");
      expect(callArgs.args.label.code).toBe('"Click me"');
      expect(callArgs.args.disabled._type).toBe("CustomCode");
      expect(callArgs.args.disabled.code).toBe("true");
      expect(callArgs.args.count._type).toBe("CustomCode");
      expect(callArgs.args.count.code).toBe("42");
    });

    it("passes both props and children together", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [
          { variable: { name: "title" } },
          { variable: { name: "children" }, tplSlot: {} }, // slot param
        ],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-2",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      const childTpl = mkTag({ uuid: "child-text-1", tag: "div" });
      mockMkTplInlinedText.mockReturnValue(childTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
        props: { title: "My Card" },
        children: [{ type: "text", value: "Card body" }],
      });

      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.args.title._type).toBe("CustomCode");
      expect(callArgs.args.title.code).toBe('"My Card"');
      expect(callArgs.children).toEqual([childTpl]);
    });

    it("handles null and array prop values", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const widgetComp = {
        uuid: "widget-uuid",
        name: "Widget",
        tplTree: mkTag({ uuid: "widget-root" }),
        params: [
          { variable: { name: "items" } },
          { variable: { name: "fallback" } },
        ],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-3",
        componentName: "Widget",
        componentUuid: "widget-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, widgetComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Widget",
        props: { items: ["a", "b"], fallback: null },
      });

      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.args.items.code).toBe('["a","b"]');
      expect(callArgs.args.fallback.code).toBe("null");
    });

    it("throws error for unknown prop name", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const buttonComp = {
        uuid: "button-uuid",
        name: "Button",
        tplTree: mkTag({ uuid: "button-root" }),
        params: [{ variable: { name: "label" } }],
      };

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, buttonComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await expect(
        addChild(api, "comp-1", "Section", {
          type: "component",
          name: "Button",
          props: { nonExistent: "value" },
        })
      ).rejects.toThrow('Unknown prop "nonExistent" on component "Button"');
    });

    it("throws error when prop targets a slot param", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [
          { variable: { name: "children" }, tplSlot: { name: "children" } },
        ],
      };

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await expect(
        addChild(api, "comp-1", "Section", {
          type: "component",
          name: "Card",
          props: { children: "some text" },
        })
      ).rejects.toThrow('Prop "children" is a slot on component "Card"');
    });

    it("skips args when props is empty object", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const buttonComp = {
        uuid: "button-uuid",
        name: "Button",
        tplTree: mkTag({ uuid: "button-root" }),
        params: [{ variable: { name: "label" } }],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-6",
        componentName: "Button",
        componentUuid: "button-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, buttonComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Button",
        props: {},
      });

      // Empty props should NOT produce an args field
      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.args).toBeUndefined();
    });

    it("works with default-component type and props", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const inputComp = {
        uuid: "input-uuid",
        name: "TextInput",
        tplTree: mkTag({ uuid: "input-root" }),
        params: [
          { variable: { name: "placeholder" } },
          { variable: { name: "required" } },
        ],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-7",
        componentName: "TextInput",
        componentUuid: "input-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, inputComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "default-component",
        kind: "TextInput",
        props: { placeholder: "Enter text...", required: true },
      });

      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.component).toBe(inputComp);
      expect(callArgs.args.placeholder.code).toBe('"Enter text..."');
      expect(callArgs.args.required.code).toBe("true");
    });
  });

  // --- remove-child ---

  describe("removeChild", () => {
    it("removes a child node from its parent", async () => {
      const child = mkTag({ uuid: "child-1", name: "ToRemove" });
      const root = mkTag({
        uuid: "root-1",
        name: "Root",
        children: [child],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      const result = await removeChild(api, "comp-1", "ToRemove");

      expect(result.removedName).toBe("ToRemove");
      expect(result.removedUuid).toBe("child-1");
      expect(result.save.revisionNum).toBe(11);
      expect(root.children.length).toBe(0);
    });

    it("removes the correct child when multiple exist", async () => {
      const child1 = mkTag({ uuid: "child-1", name: "First" });
      const child2 = mkTag({ uuid: "child-2", name: "Second" });
      const child3 = mkTag({ uuid: "child-3", name: "Third" });
      const root = mkTag({
        uuid: "root-1",
        children: [child1, child2, child3],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await removeChild(api, "comp-1", "child-2");

      expect(root.children).toEqual([child1, child3]);
    });

    it("prevents removal of root node", async () => {
      const root = mkTag({ uuid: "root-1", name: "Root" });
      const comp = mkComponent({
        uuid: "comp-1",
        name: "MyComp",
        tplTree: root,
      });

      setupSession(comp);

      await expect(
        removeChild(api, "comp-1", "root-1")
      ).rejects.toThrow('Cannot remove the root node of component "MyComp"');
    });

    it("removes deeply nested children", async () => {
      const deepChild = mkTag({ uuid: "deep-1", name: "DeepChild" });
      const middle = mkTag({
        uuid: "mid-1",
        children: [deepChild],
      });
      const root = mkTag({ uuid: "root-1", children: [middle] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await removeChild(api, "comp-1", "DeepChild");

      expect(middle.children.length).toBe(0);
    });
  });

  // --- move-child ---

  describe("moveChild", () => {
    it("moves a node from one parent to another", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const source = mkTag({
        uuid: "source-1",
        name: "Source",
        children: [movable],
      });
      const target = mkTag({
        uuid: "target-1",
        name: "Target",
        children: [],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, target],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      const result = await moveChild(
        api,
        "comp-1",
        "Movable",
        "Target"
      );

      expect(result.movedName).toBe("Movable");
      expect(result.newParentName).toBe("Target");
      expect(result.position).toBe("last");
      expect(source.children.length).toBe(0);
      expect(target.children).toContain(movable);
    });

    it("moves to 'first' position in new parent", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const existing = mkTag({ uuid: "existing-1" });
      const source = mkTag({
        uuid: "source-1",
        name: "Source",
        children: [movable],
      });
      const target = mkTag({
        uuid: "target-1",
        name: "Target",
        children: [existing],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, target],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await moveChild(api, "comp-1", "Movable", "Target", "first");

      expect(target.children[0]).toBe(movable);
      expect(target.children[1]).toBe(existing);
    });

    it("detects and prevents cycles", async () => {
      const innerChild = mkTag({ uuid: "inner-1", name: "Inner" });
      const outerParent = mkTag({
        uuid: "outer-1",
        name: "Outer",
        children: [innerChild],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [outerParent],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      // Try to move Outer into its own descendant Inner
      await expect(
        moveChild(api, "comp-1", "Outer", "Inner")
      ).rejects.toThrow('Cannot move "Outer" into its own descendant "Inner"');
    });

    it("prevents moving the root node", async () => {
      const target = mkTag({ uuid: "target-1", name: "Target" });
      const root = mkTag({
        uuid: "root-1",
        name: "Root",
        children: [target],
      });
      const comp = mkComponent({
        uuid: "comp-1",
        name: "MyComp",
        tplTree: root,
      });

      setupSession(comp);

      await expect(
        moveChild(api, "comp-1", "root-1", "Target")
      ).rejects.toThrow("Cannot move the root node");
    });

    it("rejects move to non-TplTag parent", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const compNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "CompTarget",
        component: { name: "Other", uuid: "other" },
        vsettings: [],
        children: [],
      };
      const root = mkTag({
        uuid: "root-1",
        children: [movable, compNode],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        moveChild(api, "comp-1", "Movable", "tpl-comp-1")
      ).rejects.toThrow("not a TplTag");
    });

    it("moves to numeric position", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const child1 = mkTag({ uuid: "child-1" });
      const child2 = mkTag({ uuid: "child-2" });
      const source = mkTag({
        uuid: "source-1",
        name: "Source",
        children: [movable],
      });
      const target = mkTag({
        uuid: "target-1",
        name: "Target",
        children: [child1, child2],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, target],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await moveChild(api, "comp-1", "Movable", "Target", 1);

      expect(target.children[0]).toBe(child1);
      expect(target.children[1]).toBe(movable);
      expect(target.children[2]).toBe(child2);
    });
  });

  // --- Variant resolution ---

  describe("resolveVariant", () => {
    /** Build a site with global variant groups */
    function mkSite(opts?: {
      globalVariantGroups?: any[];
    }): any {
      return {
        globalVariantGroups: opts?.globalVariantGroups ?? [],
        components: [],
      };
    }

    /** Build a variant object */
    function mkVariant(opts: {
      uuid?: string;
      name?: string;
      selectors?: string[];
      forTpl?: any;
      parent?: any;
    }): any {
      return {
        uuid: opts.uuid ?? `var-${Math.random().toString(36).slice(2, 8)}`,
        name: opts.name ?? "unnamed",
        selectors: opts.selectors ?? null,
        forTpl: opts.forTpl ?? null,
        parent: opts.parent ?? null,
      };
    }

    it("resolves a variant by UUID from global groups", () => {
      const mobile = mkVariant({ uuid: "mobile-uuid", name: "Mobile" });
      const site = mkSite({
        globalVariantGroups: [{
          uuid: "screen-group",
          type: "global-screen",
          param: { variable: { name: "Screen" } },
          variants: [mobile],
        }],
      });
      const comp = { variantGroups: [], variants: [{ uuid: "base-uuid", name: "base" }] };

      const result = resolveVariant(site, comp, "mobile-uuid");
      expect(result).toBe(mobile);
    });

    it("resolves a variant by UUID from component groups", () => {
      const small = mkVariant({ uuid: "small-uuid", name: "Small" });
      const site = mkSite();
      const comp = {
        variantGroups: [{
          uuid: "size-group",
          param: { variable: { name: "Size" } },
          variants: [small],
        }],
        variants: [{ uuid: "base-uuid", name: "base" }],
      };

      const result = resolveVariant(site, comp, "small-uuid");
      expect(result).toBe(small);
    });

    it("resolves a variant by name (case-insensitive)", () => {
      const mobile = mkVariant({ uuid: "mobile-uuid", name: "Mobile" });
      const site = mkSite({
        globalVariantGroups: [{
          uuid: "screen-group",
          type: "global-screen",
          param: { variable: { name: "Screen" } },
          variants: [mobile],
        }],
      });
      const comp = { variantGroups: [], variants: [] };

      const result = resolveVariant(site, comp, "mobile");
      expect(result).toBe(mobile);
    });

    it("resolves a style variant by selector", () => {
      const hover = mkVariant({
        uuid: "hover-uuid",
        name: "hover",
        selectors: [":hover"],
      });
      const site = mkSite();
      const comp = {
        variantGroups: [],
        variants: [{ uuid: "base-uuid", name: "base" }, hover],
      };

      const result = resolveVariant(site, comp, ":hover");
      expect(result).toBe(hover);
    });

    it("throws descriptive error when variant not found", () => {
      const mobile = mkVariant({ uuid: "mobile-uuid", name: "Mobile" });
      const site = mkSite({
        globalVariantGroups: [{
          uuid: "screen-group",
          type: "global-screen",
          param: { variable: { name: "Screen" } },
          variants: [mobile],
        }],
      });
      const comp = { variantGroups: [], variants: [] };

      expect(() => resolveVariant(site, comp, "Tablet")).toThrow(
        'Variant "Tablet" not found'
      );
      expect(() => resolveVariant(site, comp, "Tablet")).toThrow("Mobile");
    });

    it("throws ambiguity error when name matches multiple variants", () => {
      const globalDark = mkVariant({ uuid: "global-dark", name: "Dark" });
      const compDark = mkVariant({ uuid: "comp-dark", name: "Dark" });
      const site = mkSite({
        globalVariantGroups: [{
          uuid: "theme-group",
          type: "global-user-defined",
          param: { variable: { name: "Theme" } },
          variants: [globalDark],
        }],
      });
      const comp = {
        variantGroups: [{
          uuid: "comp-theme-group",
          param: { variable: { name: "CompTheme" } },
          variants: [compDark],
        }],
        variants: [],
      };

      expect(() => resolveVariant(site, comp, "Dark")).toThrow("Ambiguous");
      expect(() => resolveVariant(site, comp, "Dark")).toThrow("global-dark");
      expect(() => resolveVariant(site, comp, "Dark")).toThrow("comp-dark");
    });

    it("throws error for missing selector variant", () => {
      const site = mkSite();
      const comp = { variantGroups: [], variants: [] };

      expect(() => resolveVariant(site, comp, ":focus")).toThrow(
        "No :focus variant found"
      );
    });

    it("resolves variant by UUID from component.variants array", () => {
      const styleVariant = mkVariant({
        uuid: "style-var-uuid",
        name: "pressed",
        selectors: [":active"],
      });
      const site = mkSite();
      const comp = {
        variantGroups: [],
        variants: [{ uuid: "base-uuid", name: "base" }, styleVariant],
      };

      const result = resolveVariant(site, comp, "style-var-uuid");
      expect(result).toBe(styleVariant);
    });
  });

  // --- list-variants ---

  describe("listVariants", () => {
    it("returns global screen variants with mediaQuery", () => {
      const site = {
        globalVariantGroups: [{
          uuid: "screen-group",
          type: "global-screen",
          param: { variable: { name: "Screen" } },
          variants: [
            { uuid: "mobile-uuid", name: "Mobile", mediaQuery: "(max-width: 768px)" },
            { uuid: "tablet-uuid", name: "Tablet", mediaQuery: "(max-width: 1024px)" },
          ],
        }],
      };
      const comp = { variantGroups: [], variants: [] };

      const result = listVariants(site, comp);

      expect(result.globalVariants).toHaveLength(1);
      expect(result.globalVariants[0].group).toBe("Screen");
      expect(result.globalVariants[0].type).toBe("global-screen");
      expect(result.globalVariants[0].variants).toEqual([
        { uuid: "mobile-uuid", name: "Mobile", mediaQuery: "(max-width: 768px)" },
        { uuid: "tablet-uuid", name: "Tablet", mediaQuery: "(max-width: 1024px)" },
      ]);
    });

    it("returns component variant groups", () => {
      const site = { globalVariantGroups: [] };
      const comp = {
        variantGroups: [{
          uuid: "size-group",
          param: { variable: { name: "Size" } },
          variants: [
            { uuid: "small-uuid", name: "Small" },
            { uuid: "large-uuid", name: "Large" },
          ],
        }],
        variants: [],
      };

      const result = listVariants(site, comp);

      expect(result.componentVariants).toHaveLength(1);
      expect(result.componentVariants[0].group).toBe("Size");
      expect(result.componentVariants[0].variants).toEqual([
        { uuid: "small-uuid", name: "Small" },
        { uuid: "large-uuid", name: "Large" },
      ]);
    });

    it("separates style variants from regular component variants", () => {
      const site = { globalVariantGroups: [] };
      const comp = {
        variantGroups: [{
          uuid: "mixed-group",
          param: { variable: { name: "Interaction" } },
          variants: [
            { uuid: "hover-uuid", name: "hover", selectors: [":hover"], forTpl: { uuid: "node-1" } },
            { uuid: "size-uuid", name: "Large" },
          ],
        }],
        variants: [],
      };

      const result = listVariants(site, comp);

      expect(result.componentVariants).toHaveLength(1);
      expect(result.componentVariants[0].variants).toEqual([
        { uuid: "size-uuid", name: "Large" },
      ]);
      expect(result.styleVariants).toHaveLength(1);
      expect(result.styleVariants[0]).toEqual({
        uuid: "hover-uuid",
        name: "hover",
        selectors: [":hover"],
        forTpl: "node-1",
      });
    });

    it("picks up style variants from component.variants array", () => {
      const site = { globalVariantGroups: [] };
      const comp = {
        variantGroups: [],
        variants: [
          { uuid: "base", name: "base" },
          { uuid: "focus-uuid", name: "focus", selectors: [":focus"] },
        ],
      };

      const result = listVariants(site, comp);

      expect(result.styleVariants).toHaveLength(1);
      expect(result.styleVariants[0].uuid).toBe("focus-uuid");
      expect(result.styleVariants[0].selectors).toEqual([":focus"]);
    });

    it("returns empty arrays when no variants exist", () => {
      const site = { globalVariantGroups: [] };
      const comp = { variantGroups: [], variants: [] };

      const result = listVariants(site, comp);

      expect(result.globalVariants).toEqual([]);
      expect(result.componentVariants).toEqual([]);
      expect(result.styleVariants).toEqual([]);
    });

    it("does not duplicate style variants found in both variantGroups and variants", () => {
      const hoverVariant = {
        uuid: "hover-uuid",
        name: "hover",
        selectors: [":hover"],
      };
      const site = { globalVariantGroups: [] };
      const comp = {
        variantGroups: [{
          uuid: "group-1",
          param: { variable: { name: "Interaction" } },
          variants: [hoverVariant],
        }],
        // Same variant also in the flat variants array
        variants: [hoverVariant],
      };

      const result = listVariants(site, comp);
      expect(result.styleVariants).toHaveLength(1);
    });
  });

  // --- Variant-aware editing ---

  describe("variant-aware updateStyles", () => {
    it("targets the base variant when variant is omitted (backward compatible)", async () => {
      const node = mkTag({
        uuid: "styled-1",
        name: "Box",
        styles: { color: "red" },
      });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { fontSize: "24px" });

      // Should call base variant setting, not ensureVariantSetting
      expect(mockEnsureBaseVariantSetting).toHaveBeenCalled();
      expect(mockEnsureVariantSetting).not.toHaveBeenCalled();
    });

    it("targets a specific variant when variant param is provided", async () => {
      const mobileVariant = {
        uuid: "mobile-uuid",
        name: "Mobile",
        mediaQuery: "(max-width: 768px)",
      };
      const mobileVs = { rs: { values: {} }, variants: [mobileVariant] };

      const node = mkTag({
        uuid: "styled-1",
        name: "Box",
        styles: { color: "red" },
      });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Add variant groups to the session's site
      const session = makeSession({
        site: {
          components: [comp],
          globalVariantGroups: [{
            uuid: "screen-group",
            type: "global-screen",
            param: { variable: { name: "Screen" } },
            variants: [mobileVariant],
          }],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      mockEnsureVariantSetting.mockReturnValue(mobileVs);

      await updateStyles(api, "comp-1", "Box", { fontSize: "14px" }, "Mobile");

      // Should call ensureVariantSetting with the mobile variant
      expect(mockEnsureVariantSetting).toHaveBeenCalledWith(
        node,
        [mobileVariant]
      );
      // Should have set the style on the mobile VS
      expect(mobileVs.rs.values).toHaveProperty("fontSize", "14px");
    });
  });

  describe("variant-aware updateText", () => {
    it("targets the base variant when variant is omitted (backward compatible)", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Base text",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await updateText(api, "comp-1", "Title", "New text");

      expect(mockEnsureBaseVariantSetting).toHaveBeenCalled();
      expect(mockEnsureVariantSetting).not.toHaveBeenCalled();
      expect(textNode.vsettings[0].text.text).toBe("New text");
    });

    it("targets a specific variant when variant param is provided", async () => {
      const mobileVariant = {
        uuid: "mobile-uuid",
        name: "Mobile",
      };
      const mobileVs = {
        rs: { values: {} },
        variants: [mobileVariant],
        text: { _type: "RawText", text: "Mobile text", markers: [] },
      };

      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Base text",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const session = makeSession({
        site: {
          components: [comp],
          globalVariantGroups: [{
            uuid: "screen-group",
            type: "global-screen",
            param: { variable: { name: "Screen" } },
            variants: [mobileVariant],
          }],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockEnsureVariantSetting.mockReturnValue(mobileVs);

      const result = await updateText(api, "comp-1", "Title", "Mobile title", "Mobile");

      expect(mockEnsureVariantSetting).toHaveBeenCalledWith(
        textNode,
        [mobileVariant]
      );
      expect(result.previousText).toBe("Mobile text");
      expect(result.newText).toBe("Mobile title");
      expect(mobileVs.text.text).toBe("Mobile title");
      // Base variant text should be unchanged
      expect(textNode.vsettings[0].text.text).toBe("Base text");
    });

    it("throws variant not found error with helpful message", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Base text",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        updateText(api, "comp-1", "Title", "text", "NonExistent")
      ).rejects.toThrow('Variant "NonExistent" not found');
    });
  });

  // --- Integration-level behaviors ---

  describe("save integration", () => {
    it("calls saveRevision after successful mutation", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { color: "red" });

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11,
        expect.objectContaining({ incremental: true })
      );
    });

    it("increments session revision after save", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      const session = setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { color: "red" });

      expect(session.revisionNum).toBe(11);
    });
  });

  // --- rename-component ---

  describe("renameComponent", () => {
    it("calls TplMgr.renameComponent with the new name", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "OldName", tplTree: root });
      setupSession(comp);

      const result = await renameComponent(api, "comp-1", "NewName");

      expect(mockRenameComponent).toHaveBeenCalledWith(comp, "NewName");
      expect(result.oldName).toBe("OldName");
      expect(result.newName).toBe("NewName");
      expect(result.componentUuid).toBe("comp-1");
    });

    it("updates page path when newPath is provided", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = {
        ...mkComponent({ uuid: "page-1", name: "HomePage", tplTree: root }),
        pageMeta: { path: "/old" },
      };
      setupSession(comp);

      const result = await renameComponent(api, "page-1", "LandingPage", "/landing");

      expect(comp.pageMeta.path).toBe("/landing");
      expect(result.newPath).toBe("/landing");
    });

    it("does not update path when component is not a page", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Card", tplTree: root });
      setupSession(comp);

      const result = await renameComponent(api, "comp-1", "NewCard", "/some-path");

      // newPath is ignored because component has no pageMeta
      expect(result.newPath).toBeUndefined();
    });

    it("saves the changes to the server", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Card", tplTree: root });
      setupSession(comp);

      const result = await renameComponent(api, "comp-1", "NewCard");

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        renameComponent(api, "nonexistent", "Foo")
      ).rejects.toThrow("not found");
    });

    it("returns deduplicated name from TplMgr", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Original", tplTree: root });
      setupSession(comp);

      // Simulate TplMgr deduplication: renameComponent changes name to "Card 2"
      mockRenameComponent.mockImplementation((c: any, name: string) => {
        c.name = name + " 2";
      });

      const result = await renameComponent(api, "comp-1", "Card");

      expect(result.oldName).toBe("Original");
      expect(result.newName).toBe("Card 2");
    });
  });

  // --- update-page-meta ---

  describe("updatePageMeta", () => {
    function mkPageComponent(uuid: string, name: string, pageMeta: any) {
      const root = mkTag({ uuid: `${uuid}-root` });
      return {
        ...mkComponent({ uuid, name, tplTree: root }),
        pageMeta,
      };
    }

    it("updates title and description", async () => {
      const comp = mkPageComponent("page-1", "HomePage", {
        path: "/",
        title: null,
        description: "",
      });
      setupSession(comp);

      const result = await updatePageMeta(api, "page-1", {
        title: "Welcome",
        description: "Landing page",
      });

      expect(comp.pageMeta.title).toBe("Welcome");
      expect(comp.pageMeta.description).toBe("Landing page");
      expect(result.updatedFields).toEqual(["title", "description"]);
      expect(result.componentName).toBe("HomePage");
    });

    it("updates all metadata fields at once", async () => {
      const comp = mkPageComponent("page-1", "HomePage", {
        path: "/",
        title: null,
        description: "",
        openGraphImage: null,
        canonical: null,
      });
      setupSession(comp);

      const result = await updatePageMeta(api, "page-1", {
        title: "My Site",
        description: "Description",
        openGraphImage: "https://example.com/og.png",
        canonical: "https://example.com/",
        path: "/welcome",
      });

      expect(result.updatedFields).toHaveLength(5);
      expect(comp.pageMeta.path).toBe("/welcome");
      expect(comp.pageMeta.openGraphImage).toBe("https://example.com/og.png");
    });

    it("only updates provided fields, leaves others unchanged", async () => {
      const comp = mkPageComponent("page-1", "HomePage", {
        path: "/",
        title: "Old Title",
        description: "Old Description",
      });
      setupSession(comp);

      await updatePageMeta(api, "page-1", { title: "New Title" });

      expect(comp.pageMeta.title).toBe("New Title");
      expect(comp.pageMeta.description).toBe("Old Description"); // unchanged
    });

    it("throws when component is not a page", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Header", tplTree: root });
      setupSession(comp);

      await expect(
        updatePageMeta(api, "comp-1", { title: "Fail" })
      ).rejects.toThrow("not a page");
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        updatePageMeta(api, "nonexistent", { title: "Fail" })
      ).rejects.toThrow("not found");
    });

    it("saves the changes to the server", async () => {
      const comp = mkPageComponent("page-1", "HomePage", {
        path: "/",
        title: null,
      });
      setupSession(comp);

      const result = await updatePageMeta(api, "page-1", { title: "New" });

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });
  });

  // --- delete-component ---

  describe("deleteComponent", () => {
    it("deletes a component with no references", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "OldCard", tplTree: root });

      // Set up session with the component to delete (no other components reference it)
      const session = makeSession({
        site: { components: [comp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await deleteComponent(api, "comp-1");

      expect(mockRemoveComponent).toHaveBeenCalledWith(comp);
      expect(result.deletedName).toBe("OldCard");
      expect(result.deletedUuid).toBe("comp-1");
    });

    it("throws when references exist and force is not set", async () => {
      const root = mkTag({ uuid: "root-1" });
      const cardComp = mkComponent({ uuid: "comp-card", name: "Card", tplTree: root });

      // Create a component that references Card via a TplComponent node
      const tplCompNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        component: cardComp,
        vsettings: [],
        children: [],
      };
      const pageRoot = mkTag({ uuid: "root-2", children: [tplCompNode] });
      const pageComp = mkComponent({ uuid: "comp-page", name: "HomePage", tplTree: pageRoot });

      const session = makeSession({
        site: { components: [cardComp, pageComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await expect(
        deleteComponent(api, "comp-card")
      ).rejects.toThrow("referenced by HomePage");
    });

    it("deletes when force is true despite references", async () => {
      const root = mkTag({ uuid: "root-1" });
      const cardComp = mkComponent({ uuid: "comp-card", name: "Card", tplTree: root });

      const tplCompNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        component: cardComp,
        vsettings: [],
        children: [],
      };
      const pageRoot = mkTag({ uuid: "root-2", children: [tplCompNode] });
      const pageComp = mkComponent({ uuid: "comp-page", name: "HomePage", tplTree: pageRoot });

      const session = makeSession({
        site: { components: [cardComp, pageComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await deleteComponent(api, "comp-card", true);

      expect(mockRemoveComponent).toHaveBeenCalledWith(cardComp);
      expect(result.deletedName).toBe("Card");
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        deleteComponent(api, "nonexistent")
      ).rejects.toThrow("not found");
    });

    it("saves the changes to the server", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "ToDelete", tplTree: root });
      setupSession(comp);

      const result = await deleteComponent(api, "comp-1");

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });
  });

  // --- createStyleVariant ---

  describe("createStyleVariant", () => {
    it("creates a component-level :hover variant", async () => {
      const root = mkTag({ uuid: "root-1", name: "Root" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      // No existing style variants
      (comp as any).variants = [{ name: "base", uuid: "base-uuid" }];
      setupSession(comp);

      const mockVariant = { uuid: "new-hover-uuid", selectors: [":hover"], forTpl: null };
      mockCreateStyleVariant.mockReturnValue(mockVariant);

      const result = await createStyleVariant(api, "comp-1", ":hover");

      expect(mockCreateStyleVariant).toHaveBeenCalledWith(comp, [":hover"]);
      expect(result.variantUuid).toBe("new-hover-uuid");
      expect(result.selector).toBe(":hover");
      expect(result.scope).toBe("component");
      expect(result.forTplUuid).toBeUndefined();
    });

    it("creates an element-scoped :hover variant when nodeRef is provided", async () => {
      const textNode = mkTag({ uuid: "text-1", name: "Heading", text: "Hello" });
      const root = mkTag({ uuid: "root-1", name: "Root", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [{ name: "base", uuid: "base-uuid" }];
      setupSession(comp);

      const mockVariant = { uuid: "new-hover-uuid", selectors: [":hover"], forTpl: textNode };
      mockCreatePrivateStyleVariant.mockReturnValue(mockVariant);

      const result = await createStyleVariant(api, "comp-1", ":hover", "Heading");

      expect(mockCreatePrivateStyleVariant).toHaveBeenCalledWith(comp, textNode, [":hover"]);
      expect(result.variantUuid).toBe("new-hover-uuid");
      expect(result.selector).toBe(":hover");
      expect(result.scope).toBe("element");
      expect(result.forTplUuid).toBe("text-1");
      expect(result.forTplName).toBe("Heading");
    });

    it("rejects invalid selectors", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        createStyleVariant(api, "comp-1", ":invalid-selector")
      ).rejects.toThrow("Invalid selector");
    });

    it("rejects duplicate component-level style variant", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [
        { name: "base", uuid: "base-uuid" },
        { uuid: "existing-hover", selectors: [":hover"], forTpl: null },
      ];
      setupSession(comp);

      await expect(
        createStyleVariant(api, "comp-1", ":hover")
      ).rejects.toThrow("already exists for this component");
    });

    it("rejects duplicate element-scoped style variant", async () => {
      const textNode = mkTag({ uuid: "text-1", name: "Heading", text: "Hello" });
      const root = mkTag({ uuid: "root-1", name: "Root", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [
        { name: "base", uuid: "base-uuid" },
        { uuid: "existing-hover", selectors: [":hover"], forTpl: textNode },
      ];
      setupSession(comp);

      await expect(
        createStyleVariant(api, "comp-1", ":hover", "Heading")
      ).rejects.toThrow("already exists for this element");
    });

    it("allows same selector on different elements", async () => {
      const heading = mkTag({ uuid: "text-1", name: "Heading", text: "Hello" });
      const subtitle = mkTag({ uuid: "text-2", name: "Subtitle", text: "World" });
      const root = mkTag({ uuid: "root-1", name: "Root", children: [heading, subtitle] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      // existing hover on heading, but not on subtitle
      (comp as any).variants = [
        { name: "base", uuid: "base-uuid" },
        { uuid: "existing-hover", selectors: [":hover"], forTpl: heading },
      ];
      setupSession(comp);

      const mockVariant = { uuid: "new-hover-uuid", selectors: [":hover"], forTpl: subtitle };
      mockCreatePrivateStyleVariant.mockReturnValue(mockVariant);

      const result = await createStyleVariant(api, "comp-1", ":hover", "Subtitle");

      expect(result.variantUuid).toBe("new-hover-uuid");
      expect(result.scope).toBe("element");
      expect(result.forTplName).toBe("Subtitle");
    });

    it("rejects nodeRef targeting a non-TplTag", async () => {
      const tplComp = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "MyComp",
        component: { name: "Inner" },
        vsettings: [],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [tplComp] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [];
      setupSession(comp);

      await expect(
        createStyleVariant(api, "comp-1", ":hover", "tpl-comp-1")
      ).rejects.toThrow("not a TplTag");
    });

    it("saves changes to the server", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [];
      setupSession(comp);

      const mockVariant = { uuid: "hover-uuid", selectors: [":hover"], forTpl: null };
      mockCreateStyleVariant.mockReturnValue(mockVariant);

      const result = await createStyleVariant(api, "comp-1", ":hover");

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });

    it("supports all valid selectors", async () => {
      const validSelectors = [
        ":hover", ":active", ":focus", ":focus-visible",
        ":focus-within", ":focus-visible-within",
        ":disabled", ":visited", ":link", "::placeholder",
      ];

      for (const selector of validSelectors) {
        vi.clearAllMocks();
        mockFastBundle.mockReturnValue({ map: {}, root: "0" });
        mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
        mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });

        const root = mkTag({ uuid: "root-1" });
        const comp = mkComponent({ uuid: "comp-1", tplTree: root });
        (comp as any).variants = [];
        const session = makeSession({ site: { components: [comp] } });
        setSession(session);
        initChangeTracker(session.site);

        const mockVariant = { uuid: `${selector}-uuid`, selectors: [selector], forTpl: null };
        mockCreateStyleVariant.mockReturnValue(mockVariant);

        const result = await createStyleVariant(api, "comp-1", selector);
        expect(result.selector).toBe(selector);

        disposeChangeTracker();
        clearSession();
      }
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        createStyleVariant(api, "nonexistent", ":hover")
      ).rejects.toThrow("not found");
    });
  });

  // --- createVariantGroup ---

  describe("createVariantGroup", () => {
    it("creates a single-choice variant group with no initial variants", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Card", tplTree: root });
      setupSession(comp);

      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "Size" } },
        variants: [],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      const result = await createVariantGroup(api, "comp-1", "Size");

      expect(mockCreateVariantGroup).toHaveBeenCalledWith({
        component: comp,
        name: "Size",
        optionsType: "singleChoice",
      });
      expect(result.groupUuid).toBe("group-uuid");
      expect(result.groupName).toBe("Size");
      expect(result.type).toBe("single");
      expect(result.variants).toEqual([]);
    });

    it("creates a multi-choice variant group", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "Features" } },
        variants: [],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      const result = await createVariantGroup(api, "comp-1", "Features", "multi");

      expect(mockCreateVariantGroup).toHaveBeenCalledWith({
        component: comp,
        name: "Features",
        optionsType: "multiChoice",
      });
      expect(result.type).toBe("multi");
    });

    it("creates a toggle (standalone) variant group with auto-created variant", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      // Standalone auto-creates one variant named after the group
      const autoVariant = { uuid: "auto-var-uuid", name: "isActive" };
      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "isActive" } },
        variants: [autoVariant],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      const result = await createVariantGroup(api, "comp-1", "isActive", "toggle");

      expect(mockCreateVariantGroup).toHaveBeenCalledWith({
        component: comp,
        name: "isActive",
        optionsType: "standalone",
      });
      expect(result.type).toBe("toggle");
      expect(result.variants).toEqual([{ uuid: "auto-var-uuid", name: "isActive" }]);
    });

    it("creates initial variants when provided", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "Size" } },
        variants: [],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      // Mock createVariant to return proper objects
      let callCount = 0;
      mockCreateVariant.mockImplementation((_comp: any, _group: any, name: string) => {
        callCount++;
        return { uuid: `var-${callCount}`, name };
      });

      const result = await createVariantGroup(
        api, "comp-1", "Size", "single", ["Small", "Medium", "Large"]
      );

      expect(mockCreateVariant).toHaveBeenCalledTimes(3);
      expect(mockCreateVariant).toHaveBeenCalledWith(comp, mockGroup, "Small");
      expect(mockCreateVariant).toHaveBeenCalledWith(comp, mockGroup, "Medium");
      expect(mockCreateVariant).toHaveBeenCalledWith(comp, mockGroup, "Large");
      expect(result.variants).toEqual([
        { uuid: "var-1", name: "Small" },
        { uuid: "var-2", name: "Medium" },
        { uuid: "var-3", name: "Large" },
      ]);
    });

    it("saves changes to the server", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "Size" } },
        variants: [],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      const result = await createVariantGroup(api, "comp-1", "Size");

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        createVariantGroup(api, "nonexistent", "Size")
      ).rejects.toThrow("not found");
    });

    it("includes both toggle auto-variant and initial variants", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      const autoVariant = { uuid: "auto-uuid", name: "isExpanded" };
      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "isExpanded" } },
        variants: [autoVariant],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);
      mockCreateVariant.mockReturnValue({ uuid: "extra-uuid", name: "Extra" });

      const result = await createVariantGroup(
        api, "comp-1", "isExpanded", "toggle", ["Extra"]
      );

      // Should have the auto-created variant plus the explicitly created one
      expect(result.variants).toEqual([
        { uuid: "auto-uuid", name: "isExpanded" },
        { uuid: "extra-uuid", name: "Extra" },
      ]);
    });
  });

  // ==========================================================================
  // Error recovery: auto-rollback on save failure
  //
  // When saveManager.saveChanges() fails (network error, 412 conflict, site
  // invariant violation), the in-memory model must be automatically reverted
  // so the next mutation can succeed without calling refresh-project.
  // ==========================================================================

  describe("error recovery: auto-rollback on save failure", () => {
    it("rolls back model changes when updateStyles save fails", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      // Return non-empty changes so rollback has something to undo
      const fakeChanges = {
        changes: [{ changeNode: { inst: {}, field: "text" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      };
      mockWithRecording.mockReturnValue(fakeChanges);

      setupSession(comp);

      // Make save fail
      api.saveRevision.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow("Network error");

      // undoChanges should have been called to rollback
      expect(mockUndoChanges).toHaveBeenCalledWith(fakeChanges.changes);
    });

    it("rolls back model changes when updateText save fails", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Original",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      const fakeChanges = {
        changes: [{ changeNode: { inst: {}, field: "text" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      };
      mockWithRecording.mockReturnValue(fakeChanges);

      setupSession(comp);

      api.saveRevision.mockRejectedValueOnce(new Error("Save failed"));

      await expect(
        updateText(api, "comp-1", "Title", "New text")
      ).rejects.toThrow("Save failed");

      // undoChanges should have been called to rollback
      expect(mockUndoChanges).toHaveBeenCalledWith(fakeChanges.changes);
    });

    it("does not push to undo stack when save fails", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      setupSession(comp);

      // Clear undo stack before test to isolate from other tests
      const { getUndoDepth, clearUndoStack } = await import("../undo-manager");
      clearUndoStack();

      api.saveRevision.mockRejectedValueOnce(new Error("Server down"));

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow();

      expect(getUndoDepth()).toBe(0);
    });

    it("does not increment revision when save fails", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      const session = setupSession(comp);
      const originalRevision = session.revisionNum;
      api.saveRevision.mockRejectedValueOnce(new Error("Conflict"));

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow();

      expect(session.revisionNum).toBe(originalRevision);
    });

    it("subsequent mutation succeeds after failed save (no refresh needed)", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      setupSession(comp);

      // First call fails
      api.saveRevision.mockRejectedValueOnce(new Error("Temporary error"));
      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow("Temporary error");

      // Second call succeeds (no refresh-project needed)
      api.saveRevision.mockResolvedValueOnce({});
      const result = await updateStyles(api, "comp-1", "Box", { color: "blue" });
      expect(result.save.revisionNum).toBe(11);
    });

    it("validation errors do not accumulate in change tracker", async () => {
      const containerNode = mkTag({
        uuid: "container-1",
        name: "Container",
        children: [mkTag({ uuid: "child-1" })],
      });
      const root = mkTag({ uuid: "root-1", children: [containerNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      setupSession(comp);

      // updateText on a container should fail before any recording
      await expect(
        updateText(api, "comp-1", "Container", "text")
      ).rejects.toThrow("container");

      // No save should have been attempted
      expect(api.saveRevision).not.toHaveBeenCalled();
      // No undo should have been called (no changes to undo)
      expect(mockUndoChanges).not.toHaveBeenCalled();
    });

    it("reports rollback failure with refresh-project guidance", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      setupSession(comp);

      api.saveRevision.mockRejectedValueOnce(new Error("Save failed"));
      // Make undoChanges throw to simulate rollback failure
      mockUndoChanges.mockImplementationOnce(() => {
        throw new Error("Rollback crashed");
      });

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow("refresh-project");
    });
  });

  // ==========================================================================
  // Element tag validation
  //
  // Container and text elements support an optional `tag` field that overrides
  // the default HTML tag. This enables semantic HTML (<section>, <nav>, <h1>)
  // instead of everything being <div>. Tags are validated against allowlists
  // and unsafe tags (script, style, iframe) are rejected.
  // ==========================================================================

  describe("addChild with tag validation", () => {
    it("creates a container element with a custom tag", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1", tag: "section" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await addChild(api, "comp-1", "Section", {
        type: "box",
        tag: "section",
        children: [],
      });

      // mkTplTagX should be called with the validated tag "section"
      expect(mockMkTplTagX).toHaveBeenCalledWith(
        "section",
        expect.anything(),
      );
    });

    it("creates a container element with tag 'nav'", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1", tag: "nav" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await addChild(api, "comp-1", "Parent", {
        type: "hbox",
        tag: "nav",
        children: [],
      });

      expect(mockMkTplTagX).toHaveBeenCalledWith(
        "nav",
        expect.anything(),
      );
    });

    it("creates a text element with tag 'h1'", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1", tag: "h1", text: "Title" });
      mockMkTplInlinedText.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await addChild(api, "comp-1", "Parent", {
        type: "text",
        value: "Title",
        tag: "h1",
      });

      // mkTplInlinedText should be called with the validated tag "h1"
      expect(mockMkTplInlinedText).toHaveBeenCalledWith(
        "Title",
        expect.anything(),
        "h1",
        expect.anything(),
      );
    });

    it("defaults container tag to 'div' when no tag specified", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await addChild(api, "comp-1", "Parent", {
        type: "box",
        children: [],
      });

      expect(mockMkTplTagX).toHaveBeenCalledWith(
        "div",
        expect.anything(),
      );
    });

    it("rejects unsafe tag 'script' on container", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        addChild(api, "comp-1", "Parent", {
          type: "box",
          tag: "script",
          children: [],
        })
      ).rejects.toThrow("not allowed (unsafe)");
    });

    it("rejects unsafe tag 'style' on container", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        addChild(api, "comp-1", "Parent", {
          type: "box",
          tag: "style",
          children: [],
        })
      ).rejects.toThrow("not allowed (unsafe)");
    });

    it("rejects unsafe tag 'iframe' on text", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        addChild(api, "comp-1", "Parent", {
          type: "text",
          value: "X",
          tag: "iframe",
        })
      ).rejects.toThrow("not allowed (unsafe)");
    });

    it("rejects invalid container tag 'span'", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        addChild(api, "comp-1", "Parent", {
          type: "box",
          tag: "span",
          children: [],
        })
      ).rejects.toThrow('Invalid tag "span" for container element');
    });

    it("rejects invalid text tag 'nav'", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        addChild(api, "comp-1", "Parent", {
          type: "text",
          value: "X",
          tag: "nav",
        })
      ).rejects.toThrow('Invalid tag "nav" for text element');
    });

    it("supports all valid container tags", async () => {
      const validContainerTags = [
        "div", "section", "article", "nav", "header", "footer",
        "aside", "main", "ul", "ol", "li", "form", "fieldset",
      ];

      for (const validTag of validContainerTags) {
        const container = mkTag({ uuid: "container-1", name: "Parent" });
        const root = mkTag({ uuid: "root-1", children: [container] });
        const comp = mkComponent({ uuid: "comp-1", tplTree: root });

        const newTpl = mkTag({ uuid: "new-1", tag: validTag });
        mockMkTplTagX.mockReturnValue(newTpl);
        mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
        setupSession(comp);

        await addChild(api, "comp-1", "Parent", {
          type: "box",
          tag: validTag,
          children: [],
        });

        expect(mockMkTplTagX).toHaveBeenCalledWith(
          validTag,
          expect.anything(),
        );

        // Clean up for next iteration
        disposeChangeTracker();
        clearSession();
        vi.clearAllMocks();
        mockFastBundle.mockReturnValue({ map: {}, root: "0" });
        mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
        mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
      }
    });

    it("supports all valid text tags", async () => {
      const validTextTags = [
        "div", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6",
        "label", "a", "blockquote", "pre", "code",
      ];

      for (const validTag of validTextTags) {
        const container = mkTag({ uuid: "container-1", name: "Parent" });
        const root = mkTag({ uuid: "root-1", children: [container] });
        const comp = mkComponent({ uuid: "comp-1", tplTree: root });

        const newTpl = mkTag({ uuid: "new-1", tag: validTag, text: "T" });
        mockMkTplInlinedText.mockReturnValue(newTpl);
        mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
        setupSession(comp);

        await addChild(api, "comp-1", "Parent", {
          type: "text",
          value: "T",
          tag: validTag,
        });

        expect(mockMkTplInlinedText).toHaveBeenCalledWith(
          "T",
          expect.anything(),
          validTag,
          expect.anything(),
        );

        // Clean up for next iteration
        disposeChangeTracker();
        clearSession();
        vi.clearAllMocks();
        mockFastBundle.mockReturnValue({ map: {}, root: "0" });
        mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
        mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
      }
    });
  });

  // ==========================================================================
  // updateAttrs — HTML attribute management
  //
  // updateAttrs sets, updates, and removes HTML attributes on TplTag nodes.
  // It validates attribute names (rejecting event handlers and invalid syntax),
  // supports static and dynamic values, and works with variant targeting.
  // ==========================================================================

  describe("updateAttrs", () => {
    it("sets static string attributes", async () => {
      const node = mkTag({ uuid: "node-1", name: "Link" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Link", {
        href: "/about",
        title: "About page",
      });

      expect(result.updatedAttributes).toEqual(["href", "title"]);
      expect(result.removedAttributes).toEqual([]);
      expect(result.nodeName).toBe("Link");
      expect(result.save.revisionNum).toBe(11);

      // Verify attrs were set as CustomCode expressions
      const attrs = node.vsettings[0].attrs;
      expect(attrs.href._type).toBe("CustomCode");
      expect(attrs.href.code).toBe('"/about"');
      expect(attrs.title._type).toBe("CustomCode");
      expect(attrs.title.code).toBe('"About page"');
    });

    it("sets dynamic attribute with $ prefix", async () => {
      const node = mkTag({ uuid: "node-1", name: "Link" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await updateAttrs(api, "comp-1", "Link", {
        href: "$props.url",
      });

      const attrs = node.vsettings[0].attrs;
      expect(attrs.href._type).toBe("CustomCode");
      expect(attrs.href.code).toBe("props.url");
    });

    it("sets dynamic attribute with {{...}} wrapper", async () => {
      const node = mkTag({ uuid: "node-1", name: "Link" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await updateAttrs(api, "comp-1", "Link", {
        href: "{{props.url}}",
      });

      const attrs = node.vsettings[0].attrs;
      expect(attrs.href._type).toBe("CustomCode");
      expect(attrs.href.code).toBe("props.url");
    });

    it("removes attributes with null value", async () => {
      const node = mkTag({ uuid: "node-1", name: "Link" });
      // Pre-set an attribute to remove
      node.vsettings[0].attrs = {
        href: { _type: "CustomCode", code: '"/old"', fallback: null },
        title: { _type: "CustomCode", code: '"Old title"', fallback: null },
      };
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Link", {
        href: null,
      });

      expect(result.removedAttributes).toEqual(["href"]);
      expect(result.updatedAttributes).toEqual([]);

      // href should be removed, title should remain
      expect(node.vsettings[0].attrs.href).toBeUndefined();
      expect(node.vsettings[0].attrs.title).toBeDefined();
    });

    it("supports ARIA attributes", async () => {
      const node = mkTag({ uuid: "node-1", name: "Nav" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await updateAttrs(api, "comp-1", "Nav", {
        role: "navigation",
        "aria-label": "Main menu",
        "aria-hidden": "false",
      });

      const attrs = node.vsettings[0].attrs;
      expect(attrs.role._type).toBe("CustomCode");
      expect(attrs.role.code).toBe('"navigation"');
      expect(attrs["aria-label"].code).toBe('"Main menu"');
      expect(attrs["aria-hidden"].code).toBe('"false"');
    });

    it("supports data-* attributes", async () => {
      const node = mkTag({ uuid: "node-1", name: "Card" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await updateAttrs(api, "comp-1", "Card", {
        "data-testid": "card-1",
        "data-custom": "value",
      });

      const attrs = node.vsettings[0].attrs;
      expect(attrs["data-testid"].code).toBe('"card-1"');
      expect(attrs["data-custom"].code).toBe('"value"');
    });

    it("rejects event handler attributes", async () => {
      const node = mkTag({ uuid: "node-1", name: "Btn" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        updateAttrs(api, "comp-1", "Btn", { onclick: "alert(1)" })
      ).rejects.toThrow("Event handler attribute");

      await expect(
        updateAttrs(api, "comp-1", "Btn", { onload: "init()" })
      ).rejects.toThrow("Event handler attribute");
    });

    it("rejects attribute names with whitespace", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        updateAttrs(api, "comp-1", "Box", { "bad attr": "value" })
      ).rejects.toThrow("no whitespace");
    });

    it("rejects update on non-TplTag", async () => {
      const compNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "Sub",
        component: { name: "Other", uuid: "other-uuid" },
        vsettings: [],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [compNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        updateAttrs(api, "comp-1", "tpl-comp-1", { title: "X" })
      ).rejects.toThrow("not a TplTag");
    });

    it("sets boolean attribute values", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await updateAttrs(api, "comp-1", "Input", {
        disabled: true,
        checked: false,
      });

      const attrs = node.vsettings[0].attrs;
      expect(attrs.disabled.code).toBe("true");
      expect(attrs.checked.code).toBe("false");
    });

    it("handles empty string attribute value", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await updateAttrs(api, "comp-1", "Input", {
        disabled: "",
      });

      const attrs = node.vsettings[0].attrs;
      expect(attrs.disabled.code).toBe('""');
    });

    it("supports variant targeting for attributes", async () => {
      const node = mkTag({ uuid: "node-1", name: "Link" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Set up a variant for targeting
      const mobileVariant = {
        uuid: "mobile-var",
        name: "Mobile",
        selectors: null,
      };
      const mobileVs = {
        variants: [mobileVariant],
        attrs: {},
        rs: { values: {} },
      };

      const session = makeSession({
        site: {
          components: [comp],
          globalVariantGroups: [
            {
              uuid: "screen-group",
              param: { variable: { name: "Screen" } },
              variants: [mobileVariant],
              type: "global-screen",
            },
          ],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      mockEnsureVariantSetting.mockReturnValue(mobileVs);

      await updateAttrs(api, "comp-1", "Link", { "aria-hidden": "true" }, "Mobile");

      expect(mockEnsureVariantSetting).toHaveBeenCalledWith(node, [mobileVariant]);
      expect(mobileVs.attrs["aria-hidden"]._type).toBe("CustomCode");
      expect(mobileVs.attrs["aria-hidden"].code).toBe('"true"');
    });

    it("allows mixed set and remove operations", async () => {
      const node = mkTag({ uuid: "node-1", name: "Link" });
      node.vsettings[0].attrs = {
        href: { _type: "CustomCode", code: '"/old"', fallback: null },
        title: { _type: "CustomCode", code: '"remove me"', fallback: null },
      };
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Link", {
        href: "/new",
        title: null,
        "aria-label": "Link",
      });

      expect(result.updatedAttributes).toEqual(["href", "aria-label"]);
      expect(result.removedAttributes).toEqual(["title"]);

      const attrs = node.vsettings[0].attrs;
      expect(attrs.href.code).toBe('"/new"');
      expect(attrs.title).toBeUndefined();
      expect(attrs["aria-label"].code).toBe('"Link"');
    });
  });

  // ==========================================================================
  // Attrs during element creation
  //
  // The attrs field on PlasmicElement types is processed during add-child to
  // set HTML attributes on the newly created node. This verifies the end-to-end
  // flow from element JSON to stored attrs on the TplTag.
  // ==========================================================================

  describe("addChild with attrs", () => {
    it("sets attrs on container element during creation", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1" });
      newTpl.vsettings[0].attrs = {};
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await addChild(api, "comp-1", "Parent", {
        type: "box",
        tag: "nav",
        attrs: { role: "navigation", "aria-label": "Main" },
        children: [],
      });

      const attrs = newTpl.vsettings[0].attrs;
      expect(attrs.role._type).toBe("CustomCode");
      expect(attrs.role.code).toBe('"navigation"');
      expect(attrs["aria-label"].code).toBe('"Main"');
    });

    it("sets attrs on text element during creation", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1", tag: "a", text: "Click" });
      newTpl.vsettings[0].attrs = {};
      mockMkTplInlinedText.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await addChild(api, "comp-1", "Parent", {
        type: "text",
        value: "Click",
        tag: "a",
        attrs: { href: "/about", target: "_blank" },
      });

      const attrs = newTpl.vsettings[0].attrs;
      expect(attrs.href.code).toBe('"/about"');
      expect(attrs.target.code).toBe('"_blank"');
    });

    it("rejects event handler attr during creation", async () => {
      const container = mkTag({ uuid: "container-1", name: "Parent" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        addChild(api, "comp-1", "Parent", {
          type: "box",
          attrs: { onclick: "bad()" },
          children: [],
        })
      ).rejects.toThrow("Event handler attribute");
    });
  });

  // =============================================================================
  // resolveTokenReferences — converts token:Name values to var(--token-<uuid>)
  //
  // This is the bridge between human-readable token names and WAB's internal
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

  // --- updateStyles with token references ---

  describe("updateStyles with token references", () => {
    it("resolves token:Name and applies var(--token-<uuid>) to style", async () => {
      const node = mkTag({
        uuid: "styled-1",
        name: "Box",
        styles: {},
      });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      const session = makeSession({
        site: {
          components: [comp],
          styleTokens: [
            { uuid: "color-1", name: "Primary Blue", type: "Color", value: "#0066cc" },
          ],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await updateStyles(api, "comp-1", "Box", {
        color: "token:Primary Blue",
      });

      expect(result.updatedProperties).toContain("color");
      // The stored value should be the WAB token reference format
      expect(node.vsettings[0].rs.values.color).toBe("var(--token-color-1)");
    });

    it("rejects invalid token in updateStyles", async () => {
      const node = mkTag({
        uuid: "styled-1",
        name: "Box",
        styles: {},
      });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      const session = makeSession({
        site: {
          components: [comp],
          styleTokens: [
            { uuid: "color-1", name: "Primary Blue", type: "Color", value: "#0066cc" },
          ],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      await expect(
        updateStyles(api, "comp-1", "Box", {
          color: "token:Nonexistent",
        })
      ).rejects.toThrow('Token "Nonexistent" not found');
    });
  });
});

// =============================================================================
// addChild — slot content targeting (P6)
//
// When parentRef is a TplComponent, the `slot` parameter targets a named slot
// on the component instance. Content is added to the slot's RenderExpr.tpl[]
// array. A new Arg+RenderExpr is created when no override exists yet.
// =============================================================================

describe("addChild with slot targeting", () => {
  let api: PlasmicApiClient & { saveRevision: ReturnType<typeof vi.fn> };

  function setupSession(component: any) {
    const session = makeSession({
      site: { components: [component] },
    });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  /** Helper to build a TplComponent node with slot params. */
  function mkTplComp(opts: {
    uuid?: string;
    name?: string;
    componentName?: string;
    slotNames?: string[];
    existingSlotArgs?: Array<{ slotName: string; children: any[] }>;
    noSlots?: boolean;
  }): any {
    const params = (opts.slotNames ?? ["children"]).map((name) => ({
      variable: { name },
      tplSlot: { _type: "TplSlot" },
    }));

    const args = (opts.existingSlotArgs ?? []).map((sa) => ({
      _type: "Arg",
      param: params.find((p: any) => p.variable.name === sa.slotName),
      expr: { _type: "RenderExpr", tpl: [...sa.children] },
    }));

    return {
      _type: "TplComponent",
      uuid: opts.uuid ?? "tplcomp-1",
      name: opts.name,
      component: {
        name: opts.componentName ?? "Card",
        params: opts.noSlots ? [] : params,
      },
      vsettings: [{
        rs: { values: {} },
        args,
      }],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
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

  it("adds child to a named slot creating new Arg+RenderExpr", async () => {
    const tplComp = mkTplComp({
      uuid: "card-1",
      name: "MyCard",
      slotNames: ["children", "header", "footer"],
    });
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    const newTpl = mkTag({ uuid: "new-header-1" });
    mockMkTplInlinedText.mockReturnValue(newTpl);
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    const result = await addChild(
      api,
      "comp-1",
      "card-1",
      { type: "text", value: "Header Text" },
      undefined,
      "header"
    );

    expect(result.slotName).toBe("header");
    expect(result.parentName).toBe("MyCard");
    expect(result.save.revisionNum).toBe(11);

    // Verify Arg+RenderExpr was created
    const vs = tplComp.vsettings[0];
    const headerArg = vs.args.find(
      (a: any) => a.param?.variable?.name === "header"
    );
    expect(headerArg).toBeDefined();
    expect(headerArg.expr.tpl).toContain(newTpl);
  });

  it("appends to existing slot RenderExpr", async () => {
    const existingChild = mkTag({ uuid: "existing-1" });
    const tplComp = mkTplComp({
      uuid: "card-1",
      name: "MyCard",
      slotNames: ["children", "header"],
      existingSlotArgs: [
        { slotName: "header", children: [existingChild] },
      ],
    });
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    const newTpl = mkTag({ uuid: "new-header-2" });
    mockMkTplInlinedText.mockReturnValue(newTpl);
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    await addChild(
      api,
      "comp-1",
      "card-1",
      { type: "text", value: "More Header" },
      undefined,
      "header"
    );

    // Existing child should still be there, new one appended
    const vs = tplComp.vsettings[0];
    const headerArg = vs.args.find(
      (a: any) => a.param?.variable?.name === "header"
    );
    expect(headerArg.expr.tpl).toEqual([existingChild, newTpl]);
  });

  it("inserts at position 'first' in existing slot", async () => {
    const existingChild = mkTag({ uuid: "existing-1" });
    const tplComp = mkTplComp({
      uuid: "card-1",
      slotNames: ["children", "header"],
      existingSlotArgs: [
        { slotName: "header", children: [existingChild] },
      ],
    });
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    const newTpl = mkTag({ uuid: "new-first" });
    mockMkTplInlinedText.mockReturnValue(newTpl);
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    await addChild(
      api,
      "comp-1",
      "card-1",
      { type: "text", value: "First" },
      "first",
      "header"
    );

    const headerArg = tplComp.vsettings[0].args.find(
      (a: any) => a.param?.variable?.name === "header"
    );
    expect(headerArg.expr.tpl[0]).toBe(newTpl);
    expect(headerArg.expr.tpl[1]).toBe(existingChild);
  });

  it("inserts at numeric position in existing slot", async () => {
    const child1 = mkTag({ uuid: "slot-child-1" });
    const child2 = mkTag({ uuid: "slot-child-2" });
    const tplComp = mkTplComp({
      uuid: "card-1",
      slotNames: ["children", "actions"],
      existingSlotArgs: [
        { slotName: "actions", children: [child1, child2] },
      ],
    });
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    const newTpl = mkTag({ uuid: "inserted-middle" });
    mockMkTplTagX.mockReturnValue(newTpl);
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    await addChild(
      api,
      "comp-1",
      "card-1",
      { type: "box" },
      1,
      "actions"
    );

    const actionsArg = tplComp.vsettings[0].args.find(
      (a: any) => a.param?.variable?.name === "actions"
    );
    expect(actionsArg.expr.tpl).toEqual([child1, newTpl, child2]);
  });

  it("defaults to 'children' slot when slot omitted on TplComponent", async () => {
    const tplComp = mkTplComp({
      uuid: "card-1",
      name: "MyCard",
      slotNames: ["children", "header"],
    });
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    const newTpl = mkTag({ uuid: "new-default" });
    mockMkTplInlinedText.mockReturnValue(newTpl);
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    const result = await addChild(
      api,
      "comp-1",
      "card-1",
      { type: "text", value: "Default slot content" }
    );

    expect(result.slotName).toBe("children");
    const childrenArg = tplComp.vsettings[0].args.find(
      (a: any) => a.param?.variable?.name === "children"
    );
    expect(childrenArg).toBeDefined();
    expect(childrenArg.expr.tpl).toContain(newTpl);
  });

  it("explicit slot:'children' works same as default", async () => {
    const tplComp = mkTplComp({
      uuid: "card-1",
      slotNames: ["children", "header"],
    });
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    const newTpl = mkTag({ uuid: "new-explicit" });
    mockMkTplInlinedText.mockReturnValue(newTpl);
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    const result = await addChild(
      api,
      "comp-1",
      "card-1",
      { type: "text", value: "Explicit children" },
      undefined,
      "children"
    );

    expect(result.slotName).toBe("children");
  });

  it("errors when slot name doesn't exist on component", async () => {
    const tplComp = mkTplComp({
      uuid: "card-1",
      slotNames: ["children", "header"],
      componentName: "Card",
    });
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    await expect(
      addChild(api, "comp-1", "card-1", { type: "text", value: "x" }, undefined, "sidebar")
    ).rejects.toThrow(
      'Slot "sidebar" not found on component "Card". Available slots: children, header'
    );
  });

  it("errors when component has no slots", async () => {
    const tplComp = mkTplComp({
      uuid: "card-1",
      componentName: "Badge",
      noSlots: true,
    });
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    await expect(
      addChild(api, "comp-1", "card-1", { type: "text", value: "x" })
    ).rejects.toThrow('Component "Badge" has no slots.');
  });

  it("errors when slot used with TplTag parent", async () => {
    const container = mkTag({ uuid: "container-1", name: "Box" });
    const root = mkTag({ uuid: "root-1", children: [container] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    await expect(
      addChild(api, "comp-1", "container-1", { type: "text", value: "x" }, undefined, "header")
    ).rejects.toThrow("Slot targeting only applies to component instances");
  });

  it("errors when slot contains code expression", async () => {
    const headerParam = { variable: { name: "header" }, tplSlot: {} };
    const tplComp = {
      _type: "TplComponent",
      uuid: "card-1",
      component: {
        name: "Card",
        params: [
          { variable: { name: "children" }, tplSlot: {} },
          headerParam,
        ],
      },
      vsettings: [{
        rs: { values: {} },
        args: [{
          _type: "Arg",
          param: headerParam,
          expr: { _type: "CustomCode", code: '"dynamic"', fallback: null },
        }],
      }],
    };
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    setupSession(comp);

    await expect(
      addChild(api, "comp-1", "card-1", { type: "text", value: "x" }, undefined, "header")
    ).rejects.toThrow("contains a code expression, not renderable content");
  });
});

// =============================================================================
// removeChild — slot override content removal (P6)
//
// removeChild should find and remove nodes that live inside slot override
// RenderExpr.tpl arrays, not just direct children of TplTag nodes.
// =============================================================================

describe("removeChild from slot override content", () => {
  let api: PlasmicApiClient & { saveRevision: ReturnType<typeof vi.fn> };

  function setupSession(component: any) {
    const session = makeSession({
      site: { components: [component] },
    });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
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

  it("removes a node from inside a slot RenderExpr.tpl", async () => {
    const slotChild = mkTag({ uuid: "slot-child-1", name: "SlotContent" });
    const headerParam = { variable: { name: "header" }, tplSlot: {} };
    const tplComp = {
      _type: "TplComponent",
      uuid: "card-1",
      name: "Card",
      component: {
        name: "CardComponent",
        params: [headerParam],
      },
      vsettings: [{
        rs: { values: {} },
        args: [{
          _type: "Arg",
          param: headerParam,
          expr: { _type: "RenderExpr", tpl: [slotChild] },
        }],
      }],
    };
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    const result = await removeChild(api, "comp-1", "slot-child-1");

    expect(result.removedUuid).toBe("slot-child-1");
    // The slot's tpl array should now be empty
    const slotArg = tplComp.vsettings[0].args[0];
    expect(slotArg.expr.tpl).toEqual([]);
  });

  it("removes deeply nested child within slot override", async () => {
    const deepChild = mkTag({ uuid: "deep-1", name: "DeepChild" });
    const wrapper = mkTag({
      uuid: "wrapper-1",
      children: [deepChild],
    });
    const headerParam = { variable: { name: "header" }, tplSlot: {} };
    const tplComp = {
      _type: "TplComponent",
      uuid: "card-1",
      component: {
        name: "CardComponent",
        params: [headerParam],
      },
      vsettings: [{
        rs: { values: {} },
        args: [{
          _type: "Arg",
          param: headerParam,
          expr: { _type: "RenderExpr", tpl: [wrapper] },
        }],
      }],
    };
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await removeChild(api, "comp-1", "deep-1");

    // deep child removed from wrapper's children
    expect(wrapper.children).toEqual([]);
    // wrapper still in slot
    expect(tplComp.vsettings[0].args[0].expr.tpl).toEqual([wrapper]);
  });

  it("removes correct node when slot has multiple children", async () => {
    const child1 = mkTag({ uuid: "sc-1", name: "First" });
    const child2 = mkTag({ uuid: "sc-2", name: "Second" });
    const child3 = mkTag({ uuid: "sc-3", name: "Third" });
    const headerParam = { variable: { name: "header" }, tplSlot: {} };
    const tplComp = {
      _type: "TplComponent",
      uuid: "card-1",
      component: {
        name: "CardComponent",
        params: [headerParam],
      },
      vsettings: [{
        rs: { values: {} },
        args: [{
          _type: "Arg",
          param: headerParam,
          expr: { _type: "RenderExpr", tpl: [child1, child2, child3] },
        }],
      }],
    };
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await removeChild(api, "comp-1", "sc-2");

    const tplArr = tplComp.vsettings[0].args[0].expr.tpl;
    expect(tplArr).toEqual([child1, child3]);
  });
});

// =============================================================================
// cloneChild — deep node cloning (P8)
//
// clone-child duplicates a node and all its descendants within a component.
// Every cloned node gets a new UUID. All variant settings (styles, text, attrs)
// and slot override content are preserved. The clone is inserted as a sibling
// after the original by default, or at a specified parent + position.
//
// Why this matters: building repetitive layouts (card grids, list items, feature
// sections) requires duplicating existing elements. Without clone-child, Claude
// must read the full tree, reconstruct the element from scratch via add-child,
// then copy all styles/text — a fragile multi-step process. clone-child does it
// in one atomic operation with undo support.
// =============================================================================

describe("cloneChild", () => {
  let api: PlasmicApiClient & { saveRevision: ReturnType<typeof vi.fn> };

  function setupSession(component: any) {
    const session = makeSession({
      site: { components: [component] },
    });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();

    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({
      changes: [],
      newInsts: [],
      removedInsts: [],
    });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings?.[0] ?? {});
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("clones a simple TplTag node as next sibling", async () => {
    const child = mkTag({
      uuid: "child-1",
      name: "Card",
      tag: "section",
      text: "Hello World",
      styles: { "font-size": "16px", color: "red" },
    });
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    const result = await cloneChild(api, "comp-1", "Card");

    // Clone is inserted as next sibling
    expect(root.children).toHaveLength(2);
    const clone = root.children[1];

    // New UUID
    expect(clone.uuid).not.toBe("child-1");
    expect(result.clonedUuid).toBe(clone.uuid);
    expect(result.originalUuid).toBe("child-1");

    // Name is auto-generated as "Card (copy)"
    expect(clone.name).toBe("Card (copy)");
    expect(result.clonedName).toBe("Card (copy)");

    // Tag preserved
    expect(clone.tag).toBe("section");
    expect(clone._type).toBe("TplTag");

    // Text preserved (deep cloned)
    expect(clone.vsettings[0].text._type).toBe("RawText");
    expect(clone.vsettings[0].text.text).toBe("Hello World");
    // Text is a new instance, not the same object
    expect(clone.vsettings[0].text).not.toBe(child.vsettings[0].text);

    // Styles preserved (deep cloned)
    expect(clone.vsettings[0].rs.values).toEqual({
      "font-size": "16px",
      color: "red",
    });
    // RuleSet is a new object
    expect(clone.vsettings[0].rs).not.toBe(child.vsettings[0].rs);

    // Parent pointer set
    expect(clone.parent).toBe(root);
  });

  it("clones with custom newName", async () => {
    const child = mkTag({ uuid: "child-1", name: "Original" });
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    const result = await cloneChild(api, "comp-1", "Original", "CustomClone");

    const clone = root.children[1];
    expect(clone.name).toBe("CustomClone");
    expect(result.clonedName).toBe("CustomClone");
  });

  it("clones a node without name — clone has no auto-name", async () => {
    const child = mkTag({ uuid: "child-1" });
    // No name set
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    const result = await cloneChild(api, "comp-1", "child-1");

    const clone = root.children[1];
    // No name on original → no auto-name on clone
    expect(clone.name).toBeUndefined();
    expect(result.clonedName).toBeUndefined();
  });

  it("deep clones children recursively with new UUIDs", async () => {
    const grandchild = mkTag({ uuid: "gc-1", name: "GrandChild", text: "Nested text" });
    const child = mkTag({
      uuid: "child-1",
      name: "Parent",
      children: [grandchild],
    });
    grandchild.parent = child;
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await cloneChild(api, "comp-1", "Parent");

    const clone = root.children[1];
    expect(clone.uuid).not.toBe("child-1");
    expect(clone.children).toHaveLength(1);

    const clonedGc = clone.children[0];
    expect(clonedGc.uuid).not.toBe("gc-1");
    expect(clonedGc.name).toBe("GrandChild");
    expect(clonedGc.vsettings[0].text.text).toBe("Nested text");

    // Parent pointers are correct
    expect(clonedGc.parent).toBe(clone);
    expect(clone.parent).toBe(root);
  });

  it("preserves multiple variant settings", async () => {
    const baseVariant = { uuid: "base-v", name: "base" };
    const hoverVariant = { uuid: "hover-v", name: "hover" };
    const child = {
      _type: "TplTag",
      uuid: "child-1",
      name: "Styled",
      tag: "div",
      parent: null as any,
      children: [],
      vsettings: [
        {
          variants: [baseVariant],
          rs: { values: { color: "blue" }, mixins: [] },
          text: null,
          attrs: null,
          args: null,
        },
        {
          variants: [hoverVariant],
          rs: { values: { color: "red" }, mixins: [] },
          text: null,
          attrs: null,
          args: null,
        },
      ],
    };
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await cloneChild(api, "comp-1", "Styled");

    const clone = root.children[1];
    expect(clone.vsettings).toHaveLength(2);

    // Base variant setting
    expect(clone.vsettings[0].variants).toEqual([baseVariant]); // Same variant references
    expect(clone.vsettings[0].rs.values).toEqual({ color: "blue" });
    expect(clone.vsettings[0].rs).not.toBe(child.vsettings[0].rs); // Different rs object

    // Hover variant setting
    expect(clone.vsettings[1].variants).toEqual([hoverVariant]);
    expect(clone.vsettings[1].rs.values).toEqual({ color: "red" });
    expect(clone.vsettings[1].rs).not.toBe(child.vsettings[1].rs);
  });

  it("clones attrs with dynamic expressions", async () => {
    const child = {
      _type: "TplTag",
      uuid: "child-1",
      name: "Link",
      tag: "a",
      parent: null as any,
      children: [],
      vsettings: [{
        rs: { values: {}, mixins: [] },
        text: null,
        attrs: {
          href: { _type: "CustomCode", code: '"https://example.com"', fallback: null },
          "data-id": { _type: "CustomCode", code: '"123"', fallback: null },
        },
        args: null,
      }],
    };
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await cloneChild(api, "comp-1", "Link");

    const clone = root.children[1];
    expect(clone.vsettings[0].attrs.href._type).toBe("CustomCode");
    expect(clone.vsettings[0].attrs.href.code).toBe('"https://example.com"');
    // Attrs are new objects
    expect(clone.vsettings[0].attrs).not.toBe(child.vsettings[0].attrs);
    expect(clone.vsettings[0].attrs.href).not.toBe(child.vsettings[0].attrs.href);
  });

  it("clones ExprText (dynamic text)", async () => {
    const child = {
      _type: "TplTag",
      uuid: "child-1",
      name: "DynText",
      tag: "div",
      parent: null as any,
      children: [],
      vsettings: [{
        rs: { values: {}, mixins: [] },
        text: {
          _type: "ExprText",
          expr: { _type: "CustomCode", code: "$ctx.title", fallback: null },
          html: false,
        },
        attrs: null,
        args: null,
      }],
    };
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await cloneChild(api, "comp-1", "DynText");

    const clone = root.children[1];
    expect(clone.vsettings[0].text._type).toBe("ExprText");
    expect(clone.vsettings[0].text.expr._type).toBe("CustomCode");
    expect(clone.vsettings[0].text.expr.code).toBe("$ctx.title");
    expect(clone.vsettings[0].text.html).toBe(false);
    // New instances
    expect(clone.vsettings[0].text).not.toBe(child.vsettings[0].text);
    expect(clone.vsettings[0].text.expr).not.toBe(child.vsettings[0].text.expr);
  });

  it("clones TplComponent with slot override content", async () => {
    const slotChild = mkTag({ uuid: "sc-1", name: "SlotContent", text: "Slot text" });
    const childrenParam = { variable: { name: "children" }, tplSlot: { _type: "TplSlot" } };

    const tplComp: any = {
      _type: "TplComponent",
      uuid: "tcomp-1",
      name: "CardInstance",
      tag: undefined,
      parent: null,
      children: [],
      component: { name: "Card", params: [childrenParam] },
      vsettings: [{
        variants: [],
        rs: { values: {}, mixins: [] },
        text: null,
        attrs: null,
        args: [{
          _type: "Arg",
          param: childrenParam,
          expr: { _type: "RenderExpr", tpl: [slotChild] },
        }],
      }],
    };
    slotChild.parent = tplComp;

    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    tplComp.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await cloneChild(api, "comp-1", "CardInstance");

    expect(root.children).toHaveLength(2);
    const clone = root.children[1];

    // Clone is a TplComponent
    expect(clone._type).toBe("TplComponent");
    expect(clone.uuid).not.toBe("tcomp-1");
    expect(clone.component).toBe(tplComp.component); // Same component ref

    // Slot override content is deep cloned
    const cloneArgs = clone.vsettings[0].args;
    expect(cloneArgs).toHaveLength(1);
    expect(cloneArgs[0].expr._type).toBe("RenderExpr");
    expect(cloneArgs[0].expr.tpl).toHaveLength(1);

    const clonedSlotChild = cloneArgs[0].expr.tpl[0];
    expect(clonedSlotChild.uuid).not.toBe("sc-1"); // New UUID
    expect(clonedSlotChild.name).toBe("SlotContent");
    expect(clonedSlotChild.vsettings[0].text.text).toBe("Slot text");
  });

  it("inserts clone at specified parentRef + position", async () => {
    const child = mkTag({ uuid: "child-1", name: "Source" });
    const otherContainer = mkTag({ uuid: "other-1", name: "OtherBox", children: [
      mkTag({ uuid: "existing-1", name: "Existing" }),
    ] });
    const root = mkTag({ uuid: "root-1", children: [child, otherContainer] });
    child.parent = root;
    otherContainer.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    const result = await cloneChild(api, "comp-1", "Source", undefined, "OtherBox", "first");

    // Clone is in OtherBox, not next to Source
    expect(root.children).toHaveLength(2); // Source and OtherBox, no new sibling
    expect(otherContainer.children).toHaveLength(2);
    expect(otherContainer.children[0].name).toBe("Source (copy)");
    expect(otherContainer.children[0].uuid).not.toBe("child-1");
  });

  it("errors when cloning root node", async () => {
    const root = mkTag({ uuid: "root-1", name: "Root" });
    const comp = mkComponent({ uuid: "comp-1", name: "MyComp", tplTree: root });

    setupSession(comp);

    await expect(
      cloneChild(api, "comp-1", "Root")
    ).rejects.toThrow(/Cannot clone the root node/);
  });

  it("errors when node not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await expect(
      cloneChild(api, "comp-1", "nonexistent")
    ).rejects.toThrow(/not found/);
  });

  it("errors when component UUID not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await expect(
      cloneChild(api, "wrong-uuid", "root-1")
    ).rejects.toThrow(/not found/);
  });

  it("all cloned UUIDs are unique (deep tree)", async () => {
    const gc1 = mkTag({ uuid: "gc-1" });
    const gc2 = mkTag({ uuid: "gc-2" });
    const child1 = mkTag({ uuid: "c-1", children: [gc1, gc2] });
    gc1.parent = child1;
    gc2.parent = child1;
    const child2 = mkTag({ uuid: "c-2" });
    const parent = mkTag({ uuid: "p-1", children: [child1, child2] });
    child1.parent = parent;
    child2.parent = parent;
    const root = mkTag({ uuid: "root-1", children: [parent] });
    parent.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await cloneChild(api, "comp-1", "p-1");

    const clone = root.children[1];
    const originalUuids = new Set(["gc-1", "gc-2", "c-1", "c-2", "p-1"]);
    const cloneUuids = new Set<string>();

    // Collect all UUIDs from clone tree
    function collectUuids(node: any) {
      cloneUuids.add(node.uuid);
      for (const c of node.children ?? []) {
        collectUuids(c);
      }
    }
    collectUuids(clone);

    // No UUID in the clone should match any original UUID
    for (const uuid of cloneUuids) {
      expect(originalUuids.has(uuid)).toBe(false);
    }
    // All clone UUIDs should be unique
    expect(cloneUuids.size).toBe(5);
  });

  it("clone is inserted immediately after original", async () => {
    const child1 = mkTag({ uuid: "c-1", name: "First" });
    const child2 = mkTag({ uuid: "c-2", name: "Second" });
    const child3 = mkTag({ uuid: "c-3", name: "Third" });
    const root = mkTag({ uuid: "root-1", children: [child1, child2, child3] });
    child1.parent = root;
    child2.parent = root;
    child3.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await cloneChild(api, "comp-1", "Second");

    expect(root.children).toHaveLength(4);
    expect(root.children[0].name).toBe("First");
    expect(root.children[1].name).toBe("Second");
    expect(root.children[2].name).toBe("Second (copy)");
    expect(root.children[3].name).toBe("Third");
  });

  it("save is called and revision returned", async () => {
    const child = mkTag({ uuid: "child-1", name: "Item" });
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    const result = await cloneChild(api, "comp-1", "Item");

    expect(api.saveRevision).toHaveBeenCalledTimes(1);
    expect(result.save.revisionNum).toBe(11); // 10 + 1
  });

  it("modifying clone does not affect original", async () => {
    const child = mkTag({
      uuid: "child-1",
      name: "Card",
      text: "Original text",
      styles: { color: "blue" },
    });
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await cloneChild(api, "comp-1", "Card");

    const clone = root.children[1];

    // Mutate clone's text and styles
    clone.vsettings[0].text.text = "Modified text";
    clone.vsettings[0].rs.values.color = "green";

    // Original is unchanged
    expect(child.vsettings[0].text.text).toBe("Original text");
    expect(child.vsettings[0].rs.values.color).toBe("blue");
  });
});

// =============================================================================
// setVisibility — element visibility per variant
//
// Visibility is stored via dataCond (CustomCode) and the internal
// "plasmic-display-none" marker on the RuleSet. Three states:
//   visible (true): clear both fields
//   notRendered (false): dataCond = code("false")
//   displayNone: dataCond = code("true") + display-none marker
// =============================================================================

describe("setVisibility", () => {
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

  function setupSession(component: any) {
    const session = makeSession({ site: { components: [component] } });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  it("hides element (notRendered)", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setVisibility(api, "comp-1", "Banner", false);

    expect(result.newVisibility).toBe("notRendered");
    expect(result.previousVisibility).toBe("visible");
    expect(result.nodeName).toBe("Banner");
    expect(result.nodeUuid).toBe("node-1");
    expect(node.vsettings[0].dataCond._type).toBe("CustomCode");
    expect(node.vsettings[0].dataCond.code).toBe("false");
    expect(result.save.revisionNum).toBe(11);
  });

  it("shows element (visible) from hidden state", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "false", fallback: null };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setVisibility(api, "comp-1", "Banner", true);

    expect(result.newVisibility).toBe("visible");
    expect(result.previousVisibility).toBe("notRendered");
    expect(node.vsettings[0].dataCond).toBeNull();
  });

  it("hides with displayNone", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setVisibility(api, "comp-1", "Banner", "displayNone");

    expect(result.newVisibility).toBe("displayNone");
    expect(node.vsettings[0].dataCond._type).toBe("CustomCode");
    expect(node.vsettings[0].dataCond.code).toBe("true");
    expect(node.vsettings[0].rs.values["plasmic-display-none"]).toBe("true");
  });

  it("clears display-none marker when switching from displayNone to visible", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "true", fallback: null };
    node.vsettings[0].rs.values["plasmic-display-none"] = "true";
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setVisibility(api, "comp-1", "Banner", true);

    expect(result.previousVisibility).toBe("displayNone");
    expect(result.newVisibility).toBe("visible");
    expect(node.vsettings[0].dataCond).toBeNull();
    expect(node.vsettings[0].rs.values["plasmic-display-none"]).toBeUndefined();
  });

  it("clears display-none marker when switching from displayNone to notRendered", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "true", fallback: null };
    node.vsettings[0].rs.values["plasmic-display-none"] = "true";
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    await setVisibility(api, "comp-1", "Banner", false);

    expect(node.vsettings[0].dataCond.code).toBe("false");
    expect(node.vsettings[0].rs.values["plasmic-display-none"]).toBeUndefined();
  });

  it("works on TplComponent nodes", async () => {
    const compNode: any = {
      _type: "TplComponent",
      uuid: "comp-node-1",
      name: "Widget",
      component: { name: "Widget", uuid: "widget-def" },
      vsettings: [{ rs: { values: {} }, args: [] }],
    };
    const root = mkTag({ uuid: "root-1", children: [compNode] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setVisibility(api, "comp-1", "Widget", false);

    expect(result.newVisibility).toBe("notRendered");
    expect(compNode.vsettings[0].dataCond.code).toBe("false");
  });

  it("rejects TplSlot nodes", async () => {
    const slotNode: any = {
      _type: "TplSlot",
      uuid: "slot-1",
      name: "content",
      param: { variable: { name: "children" } },
      defaultContents: [],
    };
    const root = mkTag({ uuid: "root-1", children: [slotNode] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    setupSession(comp);

    await expect(
      setVisibility(api, "comp-1", "content", false)
    ).rejects.toThrow(/not a TplTag or TplComponent/);
  });

  it("supports variant-aware visibility", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const mobileVariant = {
      uuid: "mobile-v",
      name: "Mobile",
      selectors: [],
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).variantGroups = [{ variants: [mobileVariant] }];
    (comp as any).variants = [];

    // Create a separate variant setting for mobile
    const mobileVs = { rs: { values: {} }, variants: [mobileVariant] };
    mockEnsureVariantSetting.mockReturnValue(mobileVs);
    const session = makeSession({
      site: {
        components: [comp],
        globalVariantGroups: [],
      } as any,
    });
    setSession(session);
    initChangeTracker(session.site);

    const result = await setVisibility(api, "comp-1", "Banner", false, "Mobile");

    expect(result.newVisibility).toBe("notRendered");
    expect(mobileVs.rs.values["plasmic-display-none"]).toBeUndefined();
    // The mobileVs should have dataCond set
    expect((mobileVs as any).dataCond?.code).toBe("false");
  });

  it("captures conditional as previous visibility when custom dataCond exists", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "$ctx.isActive", fallback: null };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setVisibility(api, "comp-1", "Banner", false);

    expect(result.previousVisibility).toBe("conditional");
  });

  it("save is called and revision returned", async () => {
    const node = mkTag({ uuid: "node-1", name: "Item" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setVisibility(api, "comp-1", "Item", false);

    expect(api.saveRevision).toHaveBeenCalledTimes(1);
    expect(result.save.revisionNum).toBe(11);
  });
});

// =============================================================================
// setDataCond — conditional rendering via JavaScript expressions
//
// Sets or clears a data condition expression on an element's VariantSetting.
// The condition is a JS expression evaluated at render time; the element only
// renders when the expression is truthy. Clearing (null) makes the element
// always render.
// =============================================================================

describe("setDataCond", () => {
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

  function setupSession(component: any) {
    const session = makeSession({ site: { components: [component] } });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  it("sets condition expression", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Banner", "$ctx.showBanner");

    expect(result.newCondition).toBe("$ctx.showBanner");
    expect(result.previousCondition).toBeNull();
    expect(result.nodeName).toBe("Banner");
    expect(result.nodeUuid).toBe("node-1");
    expect(node.vsettings[0].dataCond._type).toBe("CustomCode");
    expect(node.vsettings[0].dataCond.code).toBe("$ctx.showBanner");
    expect(result.save.revisionNum).toBe(11);
  });

  it("removes condition with null", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "$ctx.showBanner", fallback: null };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Banner", null);

    expect(result.newCondition).toBeNull();
    expect(result.previousCondition).toBe("$ctx.showBanner");
    expect(node.vsettings[0].dataCond).toBeNull();
  });

  it("captures ObjectPath as previous condition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = {
      _type: "ObjectPath",
      path: ["$ctx", "user", "isLoggedIn"],
      fallback: null,
    };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Banner", "$ctx.isActive");

    expect(result.previousCondition).toBe("$ctx.user.isLoggedIn");
  });

  it("clears display-none marker when setting condition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "true", fallback: null };
    node.vsettings[0].rs.values["plasmic-display-none"] = "true";
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    await setDataCond(api, "comp-1", "Banner", "$ctx.showBanner");

    expect(node.vsettings[0].rs.values["plasmic-display-none"]).toBeUndefined();
    expect(node.vsettings[0].dataCond.code).toBe("$ctx.showBanner");
  });

  it("clears display-none marker when removing condition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "true", fallback: null };
    node.vsettings[0].rs.values["plasmic-display-none"] = "true";
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    await setDataCond(api, "comp-1", "Banner", null);

    expect(node.vsettings[0].rs.values["plasmic-display-none"]).toBeUndefined();
    expect(node.vsettings[0].dataCond).toBeNull();
  });

  it("works on TplComponent nodes", async () => {
    const compNode: any = {
      _type: "TplComponent",
      uuid: "comp-node-1",
      name: "Widget",
      component: { name: "Widget", uuid: "widget-def" },
      vsettings: [{ rs: { values: {} }, args: [] }],
    };
    const root = mkTag({ uuid: "root-1", children: [compNode] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Widget", "$ctx.showWidget");

    expect(result.newCondition).toBe("$ctx.showWidget");
    expect(compNode.vsettings[0].dataCond.code).toBe("$ctx.showWidget");
  });

  it("rejects TplSlot nodes", async () => {
    const slotNode: any = {
      _type: "TplSlot",
      uuid: "slot-1",
      name: "content",
      param: { variable: { name: "children" } },
      defaultContents: [],
    };
    const root = mkTag({ uuid: "root-1", children: [slotNode] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    setupSession(comp);

    await expect(
      setDataCond(api, "comp-1", "content", "$ctx.show")
    ).rejects.toThrow(/not a TplTag or TplComponent/);
  });

  it("supports variant-aware data condition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const mobileVariant = {
      uuid: "mobile-v",
      name: "Mobile",
      selectors: [],
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).variantGroups = [{ variants: [mobileVariant] }];
    (comp as any).variants = [];

    const mobileVs = { rs: { values: {} }, variants: [mobileVariant] };
    mockEnsureVariantSetting.mockReturnValue(mobileVs);
    const session = makeSession({
      site: {
        components: [comp],
        globalVariantGroups: [],
      } as any,
    });
    setSession(session);
    initChangeTracker(session.site);

    const result = await setDataCond(
      api, "comp-1", "Banner", "$ctx.isMobileUser", "Mobile"
    );

    expect(result.newCondition).toBe("$ctx.isMobileUser");
    expect((mobileVs as any).dataCond?.code).toBe("$ctx.isMobileUser");
  });

  it("save is called and revision returned", async () => {
    const node = mkTag({ uuid: "node-1", name: "Item" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Item", "$ctx.show");

    expect(api.saveRevision).toHaveBeenCalledTimes(1);
    expect(result.save.revisionNum).toBe(11);
  });
});

describe("setDataRep", () => {
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

  function setupSession(component: any) {
    const session = makeSession({ site: { components: [component] } });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  it("sets data repetition with default variables", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "Card", "$queries.products.data");

    expect(result.newDataRep).toEqual({
      collection: "$queries.products.data",
      elementVariable: "currentItem",
      indexVariable: "currentIndex",
    });
    expect(result.previousDataRep).toBeNull();
    expect(result.nodeName).toBe("Card");
    expect(result.nodeUuid).toBe("node-1");
    // Verify the Rep was set on the variant setting
    const vs = node.vsettings[0];
    expect(vs.dataRep).toBeTruthy();
    expect(vs.dataRep._type).toBe("Rep");
    expect(vs.dataRep.element._type).toBe("Var");
    expect(vs.dataRep.element.name).toBe("currentItem");
    expect(vs.dataRep.index._type).toBe("Var");
    expect(vs.dataRep.index.name).toBe("currentIndex");
    expect(vs.dataRep.collection._type).toBe("CustomCode");
    expect(vs.dataRep.collection.code).toBe("$queries.products.data");
  });

  it("sets data repetition with custom variable names", async () => {
    const node = mkTag({ uuid: "node-1", name: "ProductRow" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(
      api,
      "comp-1",
      "ProductRow",
      "$ctx.products",
      "product",
      "idx"
    );

    expect(result.newDataRep).toEqual({
      collection: "$ctx.products",
      elementVariable: "product",
      indexVariable: "idx",
    });
    const vs = node.vsettings[0];
    expect(vs.dataRep.element.name).toBe("product");
    expect(vs.dataRep.index.name).toBe("idx");
  });

  it("sets data repetition without index variable when null", async () => {
    const node = mkTag({ uuid: "node-1", name: "Item" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(
      api,
      "comp-1",
      "Item",
      "[1,2,3]",
      "num",
      null
    );

    expect(result.newDataRep).toEqual({
      collection: "[1,2,3]",
      elementVariable: "num",
    });
    const vs = node.vsettings[0];
    expect(vs.dataRep.index).toBeNull();
  });

  it("removes data repetition when collection is null", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    // Set up existing dataRep
    node.vsettings[0].dataRep = {
      _type: "Rep",
      element: { _type: "Var", name: "item", uuid: "var-1" },
      index: { _type: "Var", name: "idx", uuid: "var-2" },
      collection: { _type: "CustomCode", code: "$ctx.items", fallback: null },
    };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "Card", null);

    expect(result.newDataRep).toBeNull();
    expect(result.previousDataRep).toEqual({
      collection: "$ctx.items",
      elementVariable: "item",
      indexVariable: "idx",
    });
    expect(node.vsettings[0].dataRep).toBeNull();
  });

  it("reports previous ObjectPath collection", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    node.vsettings[0].dataRep = {
      _type: "Rep",
      element: { _type: "Var", name: "product", uuid: "var-1" },
      index: null,
      collection: { _type: "ObjectPath", path: ["$queries", "products", "data"], fallback: null },
    };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "Card", null);

    expect(result.previousDataRep).toEqual({
      collection: "$queries.products.data",
      elementVariable: "product",
    });
  });

  it("works on TplComponent nodes", async () => {
    const compNode: any = {
      _type: "TplComponent",
      uuid: "tplcomp-1",
      name: "ProductCard",
      component: { name: "Card", uuid: "card-comp-uuid" },
      vsettings: [{ rs: { values: {} }, args: [] }],
    };
    const root = mkTag({ uuid: "root-1", children: [compNode] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "ProductCard", "$ctx.items");

    expect(result.newDataRep!.collection).toBe("$ctx.items");
    expect(compNode.vsettings[0].dataRep._type).toBe("Rep");
  });

  it("rejects TplSlot nodes", async () => {
    const slot: any = {
      _type: "TplSlot",
      uuid: "slot-1",
      param: { variable: { name: "children" } },
      defaultContents: [],
    };
    const root = mkTag({ uuid: "root-1", children: [slot] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    setupSession(comp);

    await expect(
      setDataRep(api, "comp-1", "slot-1", "$ctx.items")
    ).rejects.toThrow(/not a TplTag or TplComponent/);
  });

  it("replaces existing dataRep with new one", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    node.vsettings[0].dataRep = {
      _type: "Rep",
      element: { _type: "Var", name: "oldItem", uuid: "var-1" },
      index: { _type: "Var", name: "oldIdx", uuid: "var-2" },
      collection: { _type: "CustomCode", code: "$ctx.oldItems", fallback: null },
    };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(
      api,
      "comp-1",
      "Card",
      "$ctx.newItems",
      "newItem",
      "newIdx"
    );

    expect(result.previousDataRep).toEqual({
      collection: "$ctx.oldItems",
      elementVariable: "oldItem",
      indexVariable: "oldIdx",
    });
    expect(result.newDataRep).toEqual({
      collection: "$ctx.newItems",
      elementVariable: "newItem",
      indexVariable: "newIdx",
    });
    expect(node.vsettings[0].dataRep.element.name).toBe("newItem");
  });

  it("saves changes and returns revision", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "Card", "$ctx.items");

    expect(api.saveRevision).toHaveBeenCalledTimes(1);
    expect(result.save.revisionNum).toBe(11);
  });

  it("supports variant-aware repetition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const mobileVariant = { uuid: "var-mobile", name: "Mobile" };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).variants = [
      { uuid: "var-base", name: "base", selectors: null },
      mobileVariant,
    ];
    // Add variant to site globalVariantGroups for resolution
    const session = makeSession({
      site: {
        components: [comp],
        globalVariantGroups: [
          { variants: [mobileVariant], param: { variable: { name: "Screen" } } },
        ],
      } as any,
    });
    setSession(session);
    initChangeTracker(session.site);

    const mobileVs: any = { rs: { values: {} }, variants: [mobileVariant] };
    mockEnsureVariantSetting.mockReturnValue(mobileVs);

    const result = await setDataRep(
      api,
      "comp-1",
      "Card",
      "$ctx.mobileItems",
      undefined,
      undefined,
      "Mobile"
    );

    expect(result.newDataRep!.collection).toBe("$ctx.mobileItems");
    expect(mobileVs.dataRep._type).toBe("Rep");
  });
});

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
});

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
// Component Props CRUD
// =============================================================================

describe("listProps", () => {
  it("returns empty array for component with no params", () => {
    const comp = { params: [] };
    const result = listProps(comp);
    expect(result).toEqual([]);
  });

  it("lists PropParam with correct fields", () => {
    const comp = {
      params: [
        {
          _type: "PropParam",
          uuid: "p1",
          variable: { name: "title" },
          type: { name: "text" },
          exportType: "External",
          required: false,
          description: "Page title",
          displayName: "Title",
          defaultExpr: null,
        },
      ],
    };
    const result = listProps(comp);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      uuid: "p1",
      name: "title",
      type: "text",
      paramKind: "prop",
      exportType: "External",
      required: false,
      isSlot: false,
      isState: false,
      description: "Page title",
      displayName: "Title",
    });
  });

  it("maps WAB type names to user-facing types", () => {
    const comp = {
      params: [
        { _type: "PropParam", uuid: "p1", variable: { name: "a" }, type: { name: "bool" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p2", variable: { name: "b" }, type: { name: "num" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p3", variable: { name: "c" }, type: { name: "any" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p4", variable: { name: "d" }, type: { name: "img" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p5", variable: { name: "e" }, type: { name: "href" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p6", variable: { name: "f" }, type: { name: "func" }, exportType: "External", required: false },
      ],
    };
    const result = listProps(comp);
    expect(result.map((p: any) => p.type)).toEqual([
      "boolean", "number", "object", "image", "href", "eventHandler",
    ]);
  });

  it("identifies slot params", () => {
    const comp = {
      params: [
        { _type: "SlotParam", uuid: "s1", variable: { name: "children" }, type: { name: "renderable" }, exportType: "External", required: false },
      ],
    };
    const result = listProps(comp);
    expect(result[0].isSlot).toBe(true);
    expect(result[0].paramKind).toBe("slot");
  });

  it("identifies state params", () => {
    const comp = {
      params: [
        { _type: "StateParam", uuid: "st1", variable: { name: "count" }, type: { name: "num" }, exportType: "Internal", required: false },
        { _type: "StateChangeHandlerParam", uuid: "sch1", variable: { name: "onChange" }, type: { name: "func" }, exportType: "Internal", required: false },
      ],
    };
    const result = listProps(comp);
    expect(result[0].isState).toBe(true);
    expect(result[0].paramKind).toBe("state");
    expect(result[1].isState).toBe(true);
    expect(result[1].paramKind).toBe("stateChangeHandler");
  });

  it("extracts CustomCode default expression", () => {
    const comp = {
      params: [
        {
          _type: "PropParam",
          uuid: "p1",
          variable: { name: "title" },
          type: { name: "text" },
          exportType: "External",
          required: false,
          defaultExpr: { _type: "CustomCode", code: '"Hello"', fallback: null },
        },
      ],
    };
    const result = listProps(comp);
    expect(result[0].defaultExpr).toBe('"Hello"');
  });

  it("handles component with undefined params", () => {
    const comp = {};
    const result = listProps(comp);
    expect(result).toEqual([]);
  });
});

describe("addProp", () => {
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

  it("creates a text prop with default value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addProp(api, "comp-1", "title", "text", "Untitled");

    expect(result.name).toBe("title");
    expect(result.type).toBe("text");
    expect(result.paramUuid).toBeDefined();
    expect(comp.params).toHaveLength(1);
    expect(comp.params[0]._type).toBe("PropParam");
    expect(comp.params[0].variable.name).toBe("title");
    expect(comp.params[0].type._type).toBe("Text");
    expect(comp.params[0].defaultExpr._type).toBe("CustomCode");
    expect(comp.params[0].defaultExpr.code).toBe('"Untitled"');
    expect(mockGetUniqueParamName).toHaveBeenCalledWith(comp, "title");
  });

  it("creates a boolean prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addProp(api, "comp-1", "showIcon", "boolean", "true");

    expect(result.type).toBe("boolean");
    expect(comp.params[0].type._type).toBe("BoolType");
    expect(comp.params[0].defaultExpr.code).toBe("true");
  });

  it("creates a number prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addProp(api, "comp-1", "count", "number", "42");

    expect(result.type).toBe("number");
    expect(comp.params[0].type._type).toBe("Num");
    expect(comp.params[0].defaultExpr.code).toBe("42");
  });

  it("creates a prop without default value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addProp(api, "comp-1", "data", "object");

    expect(comp.params[0].type._type).toBe("AnyType");
    expect(comp.params[0].defaultExpr).toBeNull();
  });

  it("creates an href prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addProp(api, "comp-1", "link", "href");

    expect(comp.params[0].type._type).toBe("HrefType");
  });

  it("creates an eventHandler prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addProp(api, "comp-1", "onClick", "eventHandler");

    expect(comp.params[0].type._type).toBe("FunctionType");
  });

  it("rejects reserved prop names", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(addProp(api, "comp-1", "children", "text")).rejects.toThrow(
      /reserved/
    );
    await expect(addProp(api, "comp-1", "key", "text")).rejects.toThrow(
      /reserved/
    );
    await expect(addProp(api, "comp-1", "ref", "text")).rejects.toThrow(
      /reserved/
    );
    await expect(addProp(api, "comp-1", "className", "text")).rejects.toThrow(
      /reserved/
    );
  });

  it("rejects invalid prop type", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(addProp(api, "comp-1", "x", "slot")).rejects.toThrow(
      /Invalid prop type/
    );
  });

  it("rejects invalid boolean default", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addProp(api, "comp-1", "flag", "boolean", "yes")
    ).rejects.toThrow(/Must be "true" or "false"/);
  });

  it("rejects invalid number default", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addProp(api, "comp-1", "count", "number", "abc")
    ).rejects.toThrow(/Must be a valid number/);
  });

  it("sets description when provided", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addProp(api, "comp-1", "title", "text", undefined, "The page title");

    expect(comp.params[0].description).toBe("The page title");
  });
});

describe("removeProp", () => {
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

  it("removes a prop by name", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeProp(api, "comp-1", "title");

    expect(result.removedName).toBe("title");
    expect(result.removedUuid).toBe("p1");
    expect(comp.params).toHaveLength(0);
  });

  it("removes a prop by UUID", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeProp(api, "comp-1", "p1");

    expect(result.removedName).toBe("title");
    expect(comp.params).toHaveLength(0);
  });

  it("cleans up Args on component instances", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];

    // Another component has a TplComponent instance referencing comp
    const instanceNode = {
      _type: "TplComponent",
      uuid: "inst-1",
      component: comp,
      vsettings: [
        {
          args: [
            { param, expr: { _type: "CustomCode", code: '"Hello"' } },
          ],
        },
      ],
      children: [],
    };
    const otherRoot = mkTag({ uuid: "other-root", children: [instanceNode] });
    const otherComp = mkComponent({ uuid: "other-comp", tplTree: otherRoot });

    const site = { components: [comp, otherComp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeProp(api, "comp-1", "title");

    expect(result.cleanedArgCount).toBe(1);
    expect(instanceNode.vsettings[0].args).toHaveLength(0);
  });

  it("throws for non-existent prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeProp(api, "comp-1", "nonExistent")).rejects.toThrow(
      /not found/
    );
  });

  it("rejects removal of state params", async () => {
    const param = {
      _type: "StateParam",
      uuid: "st1",
      variable: { name: "count" },
      type: { name: "num" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeProp(api, "comp-1", "count")).rejects.toThrow(
      /state param/i
    );
  });
});

describe("updateProp", () => {
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

  it("renames a prop via TplMgr.renameParam", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateProp(api, "comp-1", "title", "heading");

    expect(mockRenameParam).toHaveBeenCalledWith(comp, param, "heading");
    expect(result.previousName).toBe("title");
    expect(result.updatedFields).toContain("name");
  });

  it("updates default value", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
      defaultExpr: null,
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateProp(api, "comp-1", "title", undefined, "New Default");

    expect(result.updatedFields).toContain("defaultValue");
    expect(param.defaultExpr._type).toBe("CustomCode");
    expect(param.defaultExpr.code).toBe('"New Default"');
  });

  it("updates description", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
      description: null,
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateProp(
      api, "comp-1", "title", undefined, undefined, "Page heading"
    );

    expect(result.updatedFields).toContain("description");
    expect(param.description).toBe("Page heading");
  });

  it("clears description with empty string", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
      description: "Old desc",
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateProp(api, "comp-1", "title", undefined, undefined, "");

    expect(param.description).toBeNull();
  });

  it("throws for non-existent prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateProp(api, "comp-1", "nonExistent", "newName")
    ).rejects.toThrow(/not found/);
  });

  it("rejects reserved name for rename", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateProp(api, "comp-1", "title", "children")
    ).rejects.toThrow(/reserved/);
  });
});

// =============================================================================
// updateRichText — rich text with inline formatting marks
//
// Creates RawText with StyleMarkers (bold, italic, underline, strikethrough)
// and NodeMarkers (link, code) for inline formatting.
// =============================================================================
describe("updateRichText", () => {
  let api: ReturnType<typeof mockApiClient>;

  const mockBaseVariant = { _type: "Variant", uuid: "base-var-1", name: "base" };

  beforeEach(() => {
    api = mockApiClient();
    clearNodeCache();
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    (mockEnsureBaseVariant as any).mockReturnValue(mockBaseVariant);
    // mkTplTagX creates a minimal TplTag for inline elements (links, code)
    mockMkTplTagX.mockImplementation((tag: string) => {
      return {
        _type: "TplTag",
        tag,
        name: null,
        children: [],
        type: "text",
        uuid: `tpl-${Math.random().toString(36).slice(2, 8)}`,
        parent: null,
        vsettings: [{ rs: { values: {} }, attrs: {}, text: null }],
      };
    });
    mockWithRecording.mockImplementation((fn?: () => void) => {
      if (fn) fn();
      return { changes: [], newInsts: [], removedInsts: [] };
    });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
  });

  it("creates plain RawText when marks array is empty", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateRichText(api, "comp-1", "root-1", "Hello world", []);
    expect(result.newText).toBe("Hello world");
    expect(result.markCount).toBe(0);
    // vs.text should be a plain RawText with no markers
    const vs = root.vsettings[0];
    expect(vs.text._type).toBe("RawText");
    expect(vs.text.text).toBe("Hello world");
    expect(vs.text.markers).toEqual([]);
  });

  it("creates StyleMarker for bold mark", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateRichText(api, "comp-1", "root-1", "Hello bold world", [
      { start: 6, end: 10, type: "bold" },
    ]);
    expect(result.markCount).toBe(1);

    const vs = root.vsettings[0];
    expect(vs.text._type).toBe("RawText");
    expect(vs.text.text).toBe("Hello bold world");
    expect(vs.text.markers).toHaveLength(1);
    const marker = vs.text.markers[0];
    expect(marker._type).toBe("StyleMarker");
    expect(marker.position).toBe(6);
    expect(marker.length).toBe(4);
    expect(marker.rs.values["font-weight"]).toBe("700");
  });

  it("creates StyleMarker for italic mark", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateRichText(api, "comp-1", "root-1", "Hello italic world", [
      { start: 6, end: 12, type: "italic" },
    ]);

    const marker = root.vsettings[0].text.markers[0];
    expect(marker._type).toBe("StyleMarker");
    expect(marker.rs.values["font-style"]).toBe("italic");
  });

  it("creates StyleMarkers for underline and strikethrough", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateRichText(api, "comp-1", "root-1", "underline and strike", [
      { start: 0, end: 9, type: "underline" },
      { start: 14, end: 20, type: "strikethrough" },
    ]);

    const markers = root.vsettings[0].text.markers;
    expect(markers).toHaveLength(2);
    expect(markers[0].rs.values["text-decoration-line"]).toBe("underline");
    expect(markers[1].rs.values["text-decoration-line"]).toBe("line-through");
  });

  it("creates NodeMarker with TplTag for link mark", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateRichText(api, "comp-1", "root-1", "Click here for info", [
      { start: 6, end: 10, type: "link", href: "/about" },
    ]);

    const vs = root.vsettings[0];
    // WAB text has [child] placeholder: "Click [child] for info"
    expect(vs.text.text).toBe("Click [child] for info");
    expect(vs.text.markers).toHaveLength(1);

    const marker = vs.text.markers[0];
    expect(marker._type).toBe("NodeMarker");
    expect(marker.position).toBe(6);
    expect(marker.length).toBe(7); // length of "[child]"

    // The TplTag should be an anchor with href and text
    const childTpl = marker.tpl;
    expect(childTpl.tag).toBe("a");
    expect(childTpl.vsettings[0].text.text).toBe("here");
    expect(childTpl.vsettings[0].attrs.href.code).toBe('"\/about"');

    // Child should be added to parent's children
    expect(root.children).toContain(childTpl);
    expect(childTpl.parent).toBe(root);
  });

  it("creates NodeMarker with TplTag for code mark", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateRichText(api, "comp-1", "root-1", "Use the foo function", [
      { start: 8, end: 11, type: "code" },
    ]);

    const vs = root.vsettings[0];
    expect(vs.text.text).toBe("Use the [child] function");
    const marker = vs.text.markers[0];
    expect(marker._type).toBe("NodeMarker");
    expect(marker.tpl.tag).toBe("code");
    expect(marker.tpl.vsettings[0].text.text).toBe("foo");
  });

  it("handles bold + link on same range (overlapping marks)", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateRichText(api, "comp-1", "root-1", "Click here now", [
      { start: 6, end: 10, type: "link", href: "/page" },
      { start: 6, end: 10, type: "bold" },
    ]);

    const vs = root.vsettings[0];
    // Should have NodeMarker on parent text
    const nodeMarker = vs.text.markers.find((m: any) => m._type === "NodeMarker");
    expect(nodeMarker).toBeDefined();

    // The bold StyleMarker should be on the child TplTag's RawText (inside the link)
    const childRawText = nodeMarker.tpl.vsettings[0].text;
    expect(childRawText.markers).toHaveLength(1);
    expect(childRawText.markers[0]._type).toBe("StyleMarker");
    expect(childRawText.markers[0].rs.values["font-weight"]).toBe("700");
    expect(childRawText.markers[0].position).toBe(0);
    expect(childRawText.markers[0].length).toBe(4); // "here"
  });

  it("handles multiple node marks without overlap", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateRichText(api, "comp-1", "root-1", "Visit home and about pages", [
      { start: 6, end: 10, type: "link", href: "/" },
      { start: 15, end: 20, type: "link", href: "/about" },
    ]);

    const vs = root.vsettings[0];
    // "Visit [child] and [child] pages"
    expect(vs.text.text).toBe("Visit [child] and [child] pages");
    expect(vs.text.markers.filter((m: any) => m._type === "NodeMarker")).toHaveLength(2);
    expect(root.children).toHaveLength(2);
  });

  // --- Error cases ---

  it("rejects mark with start >= end", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateRichText(api, "comp-1", "root-1", "Hello", [
        { start: 3, end: 3, type: "bold" },
      ])
    ).rejects.toThrow(/start must be less than end/);
  });

  it("rejects mark extending beyond text length", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateRichText(api, "comp-1", "root-1", "Hello", [
        { start: 2, end: 10, type: "bold" },
      ])
    ).rejects.toThrow(/exceeds text length/);
  });

  it("rejects link mark without href", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateRichText(api, "comp-1", "root-1", "Click here", [
        { start: 6, end: 10, type: "link" },
      ])
    ).rejects.toThrow(/href/);
  });

  it("rejects overlapping node marks", async () => {
    const root = mkTag({ uuid: "root-1", text: "old text" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateRichText(api, "comp-1", "root-1", "Click here now", [
        { start: 0, end: 8, type: "link", href: "/a" },
        { start: 6, end: 14, type: "link", href: "/b" },
      ])
    ).rejects.toThrow(/cannot overlap/);
  });

  it("rejects rich text on a container node", async () => {
    const child = mkTag({ uuid: "child-1" });
    const root = mkTag({ uuid: "root-1", children: [child] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateRichText(api, "comp-1", "root-1", "Hello", [
        { start: 0, end: 5, type: "bold" },
      ])
    ).rejects.toThrow(/container|text element/i);
  });

  it("rejects rich text marks on dynamic text (ExprText)", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].text = {
      _type: "ExprText",
      expr: { _type: "CustomCode", code: "$ctx.title" },
      html: false,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateRichText(api, "comp-1", "root-1", "Hello", [
        { start: 0, end: 5, type: "bold" },
      ])
    ).rejects.toThrow(/dynamic text/);
  });

  it("preserves previousText from existing RawText", async () => {
    const root = mkTag({ uuid: "root-1", text: "old content" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateRichText(api, "comp-1", "root-1", "new content", [
      { start: 0, end: 3, type: "bold" },
    ]);
    expect(result.previousText).toBe("old content");
  });
});

// =============================================================================
// State Management — CRUD operations for component state variables
// =============================================================================

describe("listStates", () => {
  it("returns empty array for component with no states", () => {
    const comp = { states: [], params: [] };
    const result = listStates(comp);
    expect(result).toEqual([]);
  });

  it("returns named states with info", () => {
    const param = {
      _type: "StateParam",
      uuid: "state-param-1",
      variable: { name: "isOpen" },
      defaultExpr: { _type: "CustomCode", code: "false" },
    };
    const state = {
      _type: "NamedState",
      name: "isOpen",
      variableType: "boolean",
      accessType: "private",
      param,
    };
    const comp = { states: [state], params: [param] };
    const result = listStates(comp);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("isOpen");
    expect(result[0].variableType).toBe("boolean");
    expect(result[0].accessType).toBe("private");
    expect(result[0].initialValue).toBe("false");
  });

  it("filters out non-NamedState entries", () => {
    const state1 = {
      _type: "NamedState",
      name: "count",
      variableType: "number",
      accessType: "private",
      param: { _type: "StateParam", uuid: "sp1", variable: { name: "count" } },
    };
    const variantGroupState = {
      _type: "VariantGroupState",
      variableType: "variant",
      param: { _type: "StateParam", uuid: "sp2", variable: { name: "color" } },
    };
    const comp = { states: [state1, variantGroupState], params: [] };
    const result = listStates(comp);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("count");
  });
});

describe("addState", () => {
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

  it("creates a boolean state with initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addState(api, "comp-1", "isOpen", "boolean", "private", "false");

    expect(result.name).toBe("isOpen");
    expect(result.variableType).toBe("boolean");
    expect(result.accessType).toBe("private");
    expect(result.stateUuid).toBeDefined();
    expect(comp.states).toHaveLength(1);
    expect(comp.states[0]._type).toBe("NamedState");
    expect(comp.states[0].name).toBe("isOpen");
    expect(comp.states[0].variableType).toBe("boolean");
    expect(comp.states[0].accessType).toBe("private");
    // Value param
    expect(comp.states[0].param._type).toBe("StateParam");
    expect(comp.states[0].param.type._type).toBe("BoolType");
    expect(comp.states[0].param.defaultExpr._type).toBe("CustomCode");
    expect(comp.states[0].param.defaultExpr.code).toBe("false");
    expect(comp.states[0].param.exportType).toBe("ToolsOnly");
    // onChange param
    expect(comp.states[0].onChangeParam._type).toBe("StateChangeHandlerParam");
    expect(comp.states[0].onChangeParam.type._type).toBe("FunctionType");
    // Both params pushed to component.params
    expect(comp.params).toHaveLength(2);
    expect(comp.params[0]._type).toBe("StateParam");
    expect(comp.params[1]._type).toBe("StateChangeHandlerParam");
  });

  it("creates a text state without initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addState(api, "comp-1", "searchQuery", "text");

    expect(result.variableType).toBe("text");
    expect(comp.states[0].param.type._type).toBe("Text");
    expect(comp.states[0].param.defaultExpr).toBeNull();
  });

  it("creates a number state", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addState(api, "comp-1", "count", "number", "private", "0");

    expect(result.variableType).toBe("number");
    expect(comp.states[0].param.type._type).toBe("Num");
    expect(comp.states[0].param.defaultExpr.code).toBe("0");
  });

  it("creates a writable state with External export", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addState(api, "comp-1", "value", "text", "writable");

    expect(result.accessType).toBe("writable");
    expect(comp.states[0].param.exportType).toBe("External");
    expect(comp.states[0].onChangeParam.exportType).toBe("External");
  });

  it("creates a readonly state", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addState(api, "comp-1", "value", "text", "readonly");

    expect(comp.states[0].param.exportType).toBe("ToolsOnly");
    expect(comp.states[0].onChangeParam.exportType).toBe("External");
  });

  it("sets back-references: param.state and onChangeParam.state", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addState(api, "comp-1", "isOpen", "boolean");

    const state = comp.states[0];
    expect(state.param.state).toBe(state);
    expect(state.onChangeParam.state).toBe(state);
  });

  it("rejects duplicate state name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [
      { _type: "NamedState", name: "isOpen", variableType: "boolean", param: { uuid: "p1" } },
    ];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "isOpen", "boolean")
    ).rejects.toThrow(/already exists/);
  });

  it("rejects invalid variable type", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "x", "variant")
    ).rejects.toThrow(/Invalid variable type/);
  });

  it("rejects invalid access type", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "x", "text", "public" as any)
    ).rejects.toThrow(/Invalid access type/);
  });

  it("rejects invalid boolean initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "flag", "boolean", "private", "yes")
    ).rejects.toThrow(/Must be "true" or "false"/);
  });

  it("rejects invalid number initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "count", "number", "private", "abc")
    ).rejects.toThrow(/Must be a valid number/);
  });

  it("creates array and object state types", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addState(api, "comp-1", "items", "array", "private", "[]");
    expect(comp.states[0].param.type._type).toBe("AnyType");
    expect(comp.states[0].param.defaultExpr.code).toBe("[]");

    // Reset for next
    comp.params = [];
    comp.states = [];
    await addState(api, "comp-1", "config", "object", "private", "{}");
    expect(comp.states[0].param.type._type).toBe("AnyType");
    expect(comp.states[0].param.defaultExpr.code).toBe("{}");
  });

  it("calls getUniqueParamName for deduplication", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addState(api, "comp-1", "count", "number");

    expect(mockGetUniqueParamName).toHaveBeenCalledWith(comp, "count");
    // Also for the onChange param name
    expect(mockGetUniqueParamName).toHaveBeenCalledWith(comp, "On count change");
  });
});

describe("removeState", () => {
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

  it("removes a state by name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } };
    const state = {
      _type: "NamedState",
      name: "isOpen",
      variableType: "boolean",
      accessType: "private",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeState(api, "comp-1", "isOpen");

    expect(result.removedName).toBe("isOpen");
    expect(comp.states).toHaveLength(0);
    expect(comp.params).toHaveLength(0);
  });

  it("removes a state by param UUID", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "count" } };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On count change" } };
    const state = {
      _type: "NamedState",
      name: "count",
      variableType: "number",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeState(api, "comp-1", "sp1");

    expect(result.removedName).toBe("count");
    expect(result.removedUuid).toBe("sp1");
    expect(comp.states).toHaveLength(0);
    expect(comp.params).toHaveLength(0);
  });

  it("cleans up Args on TplComponent instances", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } };
    const state = {
      _type: "NamedState",
      name: "isOpen",
      variableType: "boolean",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];

    // Another component that has a TplComponent instance referencing comp
    const tplCompInstance = {
      _type: "TplComponent",
      component: comp,
      vsettings: [
        {
          args: [
            { param: valueParam, expr: { _type: "CustomCode", code: "true" } },
            { param: onChangeParam, expr: { _type: "CustomCode", code: "() => {}" } },
            { param: { uuid: "other-param" }, expr: { _type: "CustomCode", code: "42" } },
          ],
        },
      ],
      children: [],
    };
    const otherRoot = mkTag({ uuid: "other-root", children: [tplCompInstance] });
    const otherComp = mkComponent({ uuid: "comp-2", tplTree: otherRoot });

    const site = { components: [comp, otherComp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeState(api, "comp-1", "isOpen");

    expect(result.cleanedArgCount).toBe(2);
    // Only the "other-param" arg remains
    expect(tplCompInstance.vsettings[0].args).toHaveLength(1);
    expect(tplCompInstance.vsettings[0].args[0].param.uuid).toBe("other-param");
  });

  it("throws when state not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeState(api, "comp-1", "nonexistent")
    ).rejects.toThrow(/not found/);
  });
});

describe("updateState", () => {
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

  it("renames a state", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } };
    const state = {
      _type: "NamedState",
      name: "isOpen",
      variableType: "boolean",
      accessType: "private",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateState(api, "comp-1", "isOpen", "isVisible");

    expect(result.name).toBe("isVisible");
    expect(result.previousName).toBe("isOpen");
    expect(result.updatedFields).toContain("name");
    expect(state.name).toBe("isVisible");
    expect(mockRenameParam).toHaveBeenCalledWith(comp, valueParam, "isVisible");
    expect(mockRenameParam).toHaveBeenCalledWith(comp, onChangeParam, "On isVisible change");
  });

  it("updates access type from private to writable", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "value" }, exportType: "ToolsOnly" };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On value change" }, exportType: "ToolsOnly" };
    const state = {
      _type: "NamedState",
      name: "value",
      variableType: "text",
      accessType: "private",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateState(api, "comp-1", "value", undefined, "writable");

    expect(result.updatedFields).toContain("accessType");
    expect(state.accessType).toBe("writable");
    expect(valueParam.exportType).toBe("External");
    expect(onChangeParam.exportType).toBe("External");
  });

  it("updates initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = {
      _type: "StateParam", uuid: "sp1", variable: { name: "count" },
      defaultExpr: { _type: "CustomCode", code: "0" },
    };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On count change" } };
    const state = {
      _type: "NamedState",
      name: "count",
      variableType: "number",
      accessType: "private",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateState(api, "comp-1", "count", undefined, undefined, "10");

    expect(result.updatedFields).toContain("initialValue");
    expect(valueParam.defaultExpr._type).toBe("CustomCode");
    expect(valueParam.defaultExpr.code).toBe("10");
  });

  it("rejects duplicate name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const state1 = {
      _type: "NamedState", name: "isOpen", variableType: "boolean",
      param: { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } },
      onChangeParam: { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } },
    };
    const state2 = {
      _type: "NamedState", name: "count", variableType: "number",
      param: { _type: "StateParam", uuid: "sp2", variable: { name: "count" } },
      onChangeParam: { _type: "StateChangeHandlerParam", uuid: "ocp2", variable: { name: "On count change" } },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [state1.param, state1.onChangeParam, state2.param, state2.onChangeParam];
    (comp as any).states = [state1, state2];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateState(api, "comp-1", "count", "isOpen")
    ).rejects.toThrow(/already exists/);
  });

  it("rejects invalid access type", async () => {
    const root = mkTag({ uuid: "root-1" });
    const state = {
      _type: "NamedState", name: "isOpen", variableType: "boolean",
      param: { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } },
      onChangeParam: { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [state.param, state.onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateState(api, "comp-1", "isOpen", undefined, "public" as any)
    ).rejects.toThrow(/Invalid access type/);
  });

  it("throws when state not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateState(api, "comp-1", "nonexistent", "newName")
    ).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// listInteractions — reading event handler interactions from a TplTag element
// =============================================================================

describe("listInteractions", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
    clearNodeCache();
  });

  it("returns empty array when no event handlers exist", () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listInteractions(comp, "root-1");
    expect(result).toEqual([]);
  });

  it("lists interactions from an onClick handler", () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "int-1",
            interactionName: "Navigate",
            actionName: "navigation",
            conditionalMode: "always",
            condExpr: null,
            args: [
              {
                _type: "NameArg",
                name: "destination",
                expr: { _type: "CustomCode", code: '"/about"', fallback: null },
              },
            ],
          },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listInteractions(comp, "root-1");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      index: 0,
      uuid: "int-1",
      event: "onClick",
      actionName: "navigation",
      interactionName: "Navigate",
      conditionalMode: "always",
      args: { destination: '"/about"' },
    });
  });

  it("lists multiple interactions across multiple events", () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "int-1",
            interactionName: "Step 1",
            actionName: "customFunction",
            conditionalMode: "always",
            condExpr: null,
            args: [
              {
                _type: "NameArg",
                name: "customFunction",
                expr: {
                  _type: "FunctionExpr",
                  argNames: ["$steps"],
                  bodyExpr: { _type: "CustomCode", code: "console.log('hi')", fallback: null },
                },
              },
            ],
          },
        ],
      },
      onMouseEnter: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "int-2",
            interactionName: "Hover action",
            actionName: "updateVariable",
            conditionalMode: "always",
            condExpr: null,
            args: [
              {
                _type: "NameArg",
                name: "variable",
                expr: { _type: "ObjectPath", path: ["$state", "isHovered"], fallback: null },
              },
            ],
          },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listInteractions(comp, "root-1");
    expect(result).toHaveLength(2);
    expect(result[0].event).toBe("onClick");
    expect(result[0].args).toEqual({ customFunction: "console.log('hi')" });
    expect(result[1].event).toBe("onMouseEnter");
    expect(result[1].args).toEqual({ variable: "$state.isHovered" });
  });

  it("extracts condition expression from condExpr", () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "int-1",
            interactionName: "Conditional",
            actionName: "navigation",
            conditionalMode: "expression",
            condExpr: { _type: "CustomCode", code: "$state.isLoggedIn", fallback: null },
            args: [],
          },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listInteractions(comp, "root-1");
    expect(result[0].condition).toBe("$state.isLoggedIn");
    expect(result[0].conditionalMode).toBe("expression");
  });

  it("throws when target is not a TplTag", () => {
    const root = {
      _type: "TplComponent",
      uuid: "comp-inst-1",
      vsettings: [{ rs: { values: {} } }],
      children: [],
      component: { uuid: "other" },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    expect(() => listInteractions(comp, "comp-inst-1")).toThrow(/non-TplTag|TplComponent/);
  });
});

// =============================================================================
// addInteraction — adding event handler interactions to elements
// =============================================================================

describe("addInteraction", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
    clearNodeCache();
  });

  it("adds a navigation interaction to onClick", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addInteraction(
      api, "comp-1", "root-1", "onClick", "navigation",
      { destination: "/about" }
    );

    expect(result.event).toBe("onClick");
    expect(result.actionName).toBe("navigation");
    expect(result.interactionUuid).toBeTruthy();

    // Handler should be created on attrs
    const handler = root.vsettings[0].attrs.onClick;
    expect(handler._type).toBe("EventHandler");
    expect(handler.interactions).toHaveLength(1);
    expect(handler.interactions[0].actionName).toBe("navigation");
    expect(handler.interactions[0].args[0].name).toBe("destination");
  });

  it("adds an updateVariable interaction with aliases", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addInteraction(
      api, "comp-1", "root-1", "onClick", "setState",
      { variable: "isOpen", value: "!$state.isOpen" }
    );

    expect(result.actionName).toBe("updateVariable");
    const handler = root.vsettings[0].attrs.onClick;
    const interaction = handler.interactions[0];
    expect(interaction.actionName).toBe("updateVariable");

    // Check args: variable, operation, value
    const argNames = interaction.args.map((a: any) => a.name);
    expect(argNames).toContain("variable");
    expect(argNames).toContain("operation");
    expect(argNames).toContain("value");

    // variable arg should be ObjectPath
    const varArg = interaction.args.find((a: any) => a.name === "variable");
    expect(varArg.expr._type).toBe("ObjectPath");
    expect(varArg.expr.path).toEqual(["$state", "isOpen"]);
  });

  it("adds a customFunction interaction", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addInteraction(
      api, "comp-1", "root-1", "onClick", "runCode",
      { code: "alert('hello')" }
    );

    expect(result.actionName).toBe("customFunction");
    const interaction = root.vsettings[0].attrs.onClick.interactions[0];
    const codeArg = interaction.args.find((a: any) => a.name === "customFunction");
    expect(codeArg.expr._type).toBe("FunctionExpr");
    expect(codeArg.expr.bodyExpr._type).toBe("CustomCode");
    expect(codeArg.expr.bodyExpr.code).toBe("alert('hello')");
  });

  it("appends to existing EventHandler interactions", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "existing-1",
            interactionName: "First",
            actionName: "navigation",
            args: [],
            condExpr: null,
            conditionalMode: "always",
            parent: null,
          },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addInteraction(
      api, "comp-1", "root-1", "onClick", "runCode",
      { code: "console.log(1)" }
    );

    const handler = root.vsettings[0].attrs.onClick;
    expect(handler.interactions).toHaveLength(2);
    expect(handler.interactions[0].uuid).toBe("existing-1");
    expect(handler.interactions[1].actionName).toBe("customFunction");
  });

  it("adds condition expression when provided", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addInteraction(
      api, "comp-1", "root-1", "onClick", "navigation",
      { destination: "/home" },
      "Go home",
      "$state.isLoggedIn"
    );

    const interaction = root.vsettings[0].attrs.onClick.interactions[0];
    expect(interaction.interactionName).toBe("Go home");
    expect(interaction.conditionalMode).toBe("expression");
    expect(interaction.condExpr._type).toBe("CustomCode");
    expect(interaction.condExpr.code).toBe("$state.isLoggedIn");
  });

  it("generates default interaction name when not provided", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addInteraction(
      api, "comp-1", "root-1", "onClick", "navigation",
      { destination: "/about" }
    );

    expect(result.interactionName).toContain("onClick");
    expect(result.interactionName).toContain("navigation");
  });

  it("rejects unknown event name", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onBogus", "navigation", { destination: "/" })
    ).rejects.toThrow(/Unknown event/);
  });

  it("rejects unknown action name", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onClick", "doSomething", {})
    ).rejects.toThrow(/Unknown action/);
  });

  it("rejects interaction on non-TplTag node", async () => {
    const root = {
      _type: "TplComponent",
      uuid: "comp-inst-1",
      vsettings: [{ rs: { values: {} }, attrs: {} }],
      children: [],
      component: { uuid: "other" },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "comp-inst-1", "onClick", "navigation", { destination: "/" })
    ).rejects.toThrow(/non-TplTag|TplComponent/);
  });

  it("rejects navigation without destination", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onClick", "navigation", {})
    ).rejects.toThrow(/destination/);
  });

  it("rejects updateVariable without variable name", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onClick", "updateVariable", { value: "true" })
    ).rejects.toThrow(/variable/);
  });

  it("rejects customFunction without code", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onClick", "customFunction", {})
    ).rejects.toThrow(/code/);
  });
});

// =============================================================================
// removeInteraction — removing event handler interactions from elements
// =============================================================================

describe("removeInteraction", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
    clearNodeCache();
  });

  it("removes a specific interaction by index", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          { _type: "Interaction", uuid: "int-1", actionName: "navigation", args: [] },
          { _type: "Interaction", uuid: "int-2", actionName: "customFunction", args: [] },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeInteraction(api, "comp-1", "root-1", "onClick", 0);
    expect(result.removedCount).toBe(1);

    const handler = root.vsettings[0].attrs.onClick;
    expect(handler.interactions).toHaveLength(1);
    expect(handler.interactions[0].uuid).toBe("int-2");
  });

  it("removes all interactions when no index specified", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          { _type: "Interaction", uuid: "int-1", args: [] },
          { _type: "Interaction", uuid: "int-2", args: [] },
          { _type: "Interaction", uuid: "int-3", args: [] },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeInteraction(api, "comp-1", "root-1", "onClick");
    expect(result.removedCount).toBe(3);

    // Handler itself should be removed from attrs when empty
    expect(root.vsettings[0].attrs.onClick).toBeUndefined();
  });

  it("cleans up empty handler from attrs", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          { _type: "Interaction", uuid: "int-1", args: [] },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await removeInteraction(api, "comp-1", "root-1", "onClick", 0);
    expect(root.vsettings[0].attrs.onClick).toBeUndefined();
  });

  it("throws when event has no handler", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeInteraction(api, "comp-1", "root-1", "onClick")
    ).rejects.toThrow(/No event handler/);
  });

  it("throws when interaction index is out of range", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          { _type: "Interaction", uuid: "int-1", args: [] },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeInteraction(api, "comp-1", "root-1", "onClick", 5)
    ).rejects.toThrow(/out of range/);
  });

  it("throws when target is not a TplTag", async () => {
    const root = {
      _type: "TplComponent",
      uuid: "comp-inst-1",
      vsettings: [{ rs: { values: {} }, attrs: {} }],
      children: [],
      component: { uuid: "other" },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeInteraction(api, "comp-1", "comp-inst-1", "onClick")
    ).rejects.toThrow(/non-TplTag|TplComponent/);
  });
});

// =============================================================================
// listQueries — reading data queries from a component
// =============================================================================

describe("listQueries", () => {
  beforeEach(() => {
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
    clearNodeCache();
  });

  it("returns empty array when no queries exist", () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listQueries(comp);
    expect(result).toEqual([]);
  });

  it("lists data queries", () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [
      { uuid: "q1", name: "products", op: null },
      { uuid: "q2", name: "categories", op: null },
    ];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listQueries(comp);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ uuid: "q1", name: "products", queryType: "dataQuery" });
    expect(result[1]).toEqual({ uuid: "q2", name: "categories", queryType: "dataQuery" });
  });

  it("lists both data and server queries", () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [
      { uuid: "q1", name: "products", op: null },
    ];
    (comp as any).serverQueries = [
      { uuid: "q2", name: "fetchUser", op: null },
    ];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listQueries(comp);
    expect(result).toHaveLength(2);
    expect(result[0].queryType).toBe("dataQuery");
    expect(result[1].queryType).toBe("serverQuery");
    expect(result[1].name).toBe("fetchUser");
  });
});

// =============================================================================
// addQuery — creating data queries on a component
// =============================================================================

describe("addQuery", () => {
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
    clearNodeCache();
  });

  it("adds a data query", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addQuery(api, "comp-1", "products");
    expect(result.name).toBe("products");
    expect(result.queryType).toBe("dataQuery");
    expect(result.queryUuid).toBeTruthy();

    expect(comp.dataQueries).toHaveLength(1);
    expect(comp.dataQueries[0].name).toBe("products");
    expect(comp.dataQueries[0].uuid).toBe(result.queryUuid);
  });

  it("adds a server query", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addQuery(api, "comp-1", "fetchUser", "serverQuery");
    expect(result.queryType).toBe("serverQuery");
    expect(comp.serverQueries).toHaveLength(1);
    expect(comp.serverQueries[0].name).toBe("fetchUser");
  });

  it("normalizes query name to valid identifier", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addQuery(api, "comp-1", "user-data");
    expect(result.name).toBe("userData");
  });

  it("rejects duplicate query name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [{ uuid: "q1", name: "products", op: null }];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addQuery(api, "comp-1", "products")
    ).rejects.toThrow(/already exists/);
  });

  it("rejects empty query name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addQuery(api, "comp-1", "")
    ).rejects.toThrow(/cannot be empty/);
  });
});

// =============================================================================
// removeQuery — removing data queries from a component
// =============================================================================

describe("removeQuery", () => {
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
    clearNodeCache();
  });

  it("removes a data query by name", async () => {
    const query = { _type: "ComponentDataQuery", uuid: "q1", name: "products", op: null };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [query];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeQuery(api, "comp-1", "products");
    expect(result.removedName).toBe("products");
    expect(result.removedUuid).toBe("q1");
    expect(result.queryType).toBe("dataQuery");
    expect(mockRemoveComponentQuery).toHaveBeenCalledWith(comp, query);
  });

  it("removes a server query by UUID", async () => {
    const query = { _type: "ComponentServerQuery", uuid: "sq1", name: "fetchUser", op: null };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [query];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeQuery(api, "comp-1", "sq1");
    expect(result.removedName).toBe("fetchUser");
    expect(result.queryType).toBe("serverQuery");
    expect(mockRemoveComponentServerQuery).toHaveBeenCalledWith(comp, query);
  });

  it("throws when query not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeQuery(api, "comp-1", "nonexistent")
    ).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// updateQuery — renaming data queries
// =============================================================================

describe("updateQuery", () => {
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
    clearNodeCache();
  });

  it("renames a data query", async () => {
    const query = { uuid: "q1", name: "products", op: null };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [query];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateQuery(api, "comp-1", "products", "items");
    expect(result.name).toBe("items");
    expect(query.name).toBe("items");
  });

  it("rejects duplicate name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [
      { uuid: "q1", name: "products", op: null },
      { uuid: "q2", name: "categories", op: null },
    ];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateQuery(api, "comp-1", "products", "categories")
    ).rejects.toThrow(/already exists/);
  });

  it("throws when no name provided", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [{ uuid: "q1", name: "products", op: null }];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateQuery(api, "comp-1", "products", undefined)
    ).rejects.toThrow(/name must be provided/);
  });

  it("throws when query not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateQuery(api, "comp-1", "nonexistent", "newName")
    ).rejects.toThrow(/not found/);
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

describe("applyMixin", () => {
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
    clearNodeCache();
  });

  it("applies a mixin to an element", async () => {
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.mixins = [];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const mixin = { uuid: "m1", name: "Button", rs: { values: {} }, forTheme: false };
    const site = { components: [comp], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    const result = await applyMixin(api, "comp-1", "Root", "Button");
    expect(result.mixinName).toBe("Button");
    expect(result.nodeUuid).toBe("root-1");
    expect(root.vsettings[0].rs.mixins).toContain(mixin);
  });

  it("is idempotent — applying same mixin twice does not duplicate", async () => {
    const mixin = { uuid: "m1", name: "Button", rs: { values: {} }, forTheme: false };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.mixins = [mixin]; // already applied
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    await applyMixin(api, "comp-1", "Root", "Button");
    expect(root.vsettings[0].rs.mixins).toHaveLength(1);
  });

  it("throws when mixin not found", async () => {
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.mixins = [];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], mixins: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      applyMixin(api, "comp-1", "Root", "nonexistent")
    ).rejects.toThrow(/not found/);
  });

  it("throws when component not found", async () => {
    const site = { components: [], mixins: [{ uuid: "m1", name: "Test", rs: { values: {} }, forTheme: false }] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      applyMixin(api, "bad-comp", "Root", "Test")
    ).rejects.toThrow(/not found/);
  });
});

describe("detachMixin", () => {
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
    clearNodeCache();
  });

  it("detaches a mixin from an element", async () => {
    const mixin = { uuid: "m1", name: "Button", rs: { values: {} }, forTheme: false };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.mixins = [mixin];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    const result = await detachMixin(api, "comp-1", "Root", "Button");
    expect(result.mixinName).toBe("Button");
    expect(result.nodeUuid).toBe("root-1");
    expect(root.vsettings[0].rs.mixins).toHaveLength(0);
  });

  it("throws when mixin is not applied to element", async () => {
    const mixin = { uuid: "m1", name: "Button", rs: { values: {} }, forTheme: false };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.mixins = [];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], mixins: [mixin] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    await expect(
      detachMixin(api, "comp-1", "Root", "Button")
    ).rejects.toThrow(/not applied/);
  });

  it("throws when mixin not found in site", async () => {
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.mixins = [];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], mixins: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      detachMixin(api, "comp-1", "Root", "nonexistent")
    ).rejects.toThrow(/not found/);
  });

  it("only removes the specified mixin, preserving others", async () => {
    const mixin1 = { uuid: "m1", name: "One", rs: { values: {} }, forTheme: false };
    const mixin2 = { uuid: "m2", name: "Two", rs: { values: {} }, forTheme: false };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.mixins = [mixin1, mixin2];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], mixins: [mixin1, mixin2] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    await detachMixin(api, "comp-1", "Root", "One");
    expect(root.vsettings[0].rs.mixins).toHaveLength(1);
    expect(root.vsettings[0].rs.mixins[0]).toBe(mixin2);
  });
});
