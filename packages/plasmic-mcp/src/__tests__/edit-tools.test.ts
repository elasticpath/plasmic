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
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  mockEnsureBaseVariantSetting,
  mockRenameComponent,
  mockRemoveComponent,
  mockCreateStyleVariant,
  mockCreatePrivateStyleVariant,
  mockCreateVariantGroup,
  mockCreateVariant,
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
