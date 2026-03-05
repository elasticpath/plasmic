/**
 * Unit tests for node domain tools.
 *
 * Extracted from edit-tools.test.ts — covers all tools in the node domain:
 * updateText, updateStyles, updateAttrs, addChild, removeChild, moveChild,
 * cloneChild, setVisibility, updateRichText, applyMixin, detachMixin,
 * addNodeAnimation, removeNodeAnimation, reorderChildren, setImage,
 * resolveTokenReferences, sanitizeStyles, isValidStyleProp,
 * validateStyleProperties, getValidStylePropertyNames.
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
  sanitizeStyles,
  isValidStyleProp,
  validateStyleProperties,
  getValidStylePropertyNames,
  resolveTokenReferences,
  setVisibility,
  updateRichText,
  applyMixin,
  detachMixin,
  addNodeAnimation,
  removeNodeAnimation,
  reorderChildren,
  setImage,
  updateProps,
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  mockEnsureBaseVariantSetting,
  mockEnsureBaseVariant,
  mockAddAnimation,
  mockReorderChildren,
  mockSetTplComponentArg,
} from "../__mocks__/wab-tpl-mgr";
import { mockMkTplTagX, mockMkTplInlinedText, mockMkTplComponentX, TplTagType } from "../__mocks__/wab-tpls";
import { mockEnsureVariantSetting } from "../__mocks__/wab-variants";
import { mockElementSchemaToTpl } from "../__mocks__/wab-code-components";
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

  it("warns when background longhands provided without image or color", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = sanitizeStyles({
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      fontSize: "16px",
    });

    // Longhands without image/color can't form a shorthand; warn but keep other props
    expect(result).toEqual({ fontSize: "16px" });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("require backgroundImage, backgroundColor")
    );

    consoleSpy.mockRestore();
  });

  it("warns for all background longhand variants (camel + kebab) without image", () => {
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
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("require backgroundImage, backgroundColor")
    );

    consoleSpy.mockRestore();
  });

  it("incorporates background longhands into composite shorthand with image", () => {
    const result = sanitizeStyles({
      backgroundImage: "url(img.png)",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    });
    expect(result).toEqual({
      background: "url(img.png) center / cover no-repeat",
    });
  });

  it("incorporates background longhands into composite shorthand with color", () => {
    const result = sanitizeStyles({
      backgroundColor: "#fff",
      backgroundSize: "contain",
      backgroundPosition: "top left",
      backgroundAttachment: "fixed",
    });
    expect(result).toEqual({
      background: "linear-gradient(#fff, #fff) top left / contain fixed",
    });
  });

  it("incorporates origin and clip into composite shorthand", () => {
    const result = sanitizeStyles({
      backgroundImage: "url(bg.png)",
      backgroundOrigin: "padding-box",
      backgroundClip: "content-box",
    });
    expect(result).toEqual({
      background: "url(bg.png) padding-box content-box",
    });
  });

  it("uses single box value when origin equals clip", () => {
    const result = sanitizeStyles({
      backgroundImage: "url(bg.png)",
      backgroundOrigin: "border-box",
      backgroundClip: "border-box",
    });
    expect(result).toEqual({
      background: "url(bg.png) border-box",
    });
  });

  it("adds default position when size provided without position", () => {
    const result = sanitizeStyles({
      backgroundImage: "url(bg.png)",
      backgroundSize: "50% 50%",
    });
    // CSS requires position before "/ size"
    expect(result).toEqual({
      background: "url(bg.png) 0% 0% / 50% 50%",
    });
  });

  it("explicit background shorthand overrides longhands", () => {
    const result = sanitizeStyles({
      background: "red",
      backgroundSize: "cover",
      backgroundImage: "url(bg.png)",
    });
    // Explicit shorthand takes precedence
    expect(result).toEqual({ background: "red" });
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
// CSS Property Validation
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

// =============================================================================
// Node domain tools — shared session setup
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

    it("sets TplTagType.Text when converting a non-text node to text", async () => {
      // Empty node (no text, no children) — acts as a "free box"
      const node = mkTag({ uuid: "node-1", name: "EmptyBox" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      // Before: node has no type set (defaults to "other" in real Plasmic)
      expect(node.type).toBeUndefined();

      await updateText(api, "comp-1", "EmptyBox", "Hello World");

      // After: node.type should be set to TplTagType.Text so Studio renders text, not "free box"
      expect(node.type).toBe(TplTagType.Text);
      expect(node.vsettings[0].text._type).toBe("RawText");
      expect(node.vsettings[0].text.text).toBe("Hello World");
    });

    it("does not change type when updating existing text node", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Old text",
      });
      // Simulate an existing text node with type already set
      textNode.type = TplTagType.Text;
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await updateText(api, "comp-1", "Title", "New text");

      // Type should remain Text (not changed)
      expect(textNode.type).toBe(TplTagType.Text);
      expect(textNode.vsettings[0].text.text).toBe("New text");
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

    it("applies styles to TplComponent instances", async () => {
      const compNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "CardInstance",
        component: { name: "Card", uuid: "card-uuid" },
        vsettings: [{ rs: { values: {} }, args: [] }],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [compNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateStyles(api, "comp-1", "tpl-comp-1", {
        padding: "16px",
      });

      expect(result.nodeName).toBe("CardInstance");
      expect(result.nodeUuid).toBe("tpl-comp-1");
      expect(result.updatedProperties.length).toBeGreaterThan(0);
    });

    it("rejects style update on TplSlot", async () => {
      const slotNode = {
        _type: "TplSlot",
        uuid: "slot-1",
        name: "content",
        vsettings: [],
        children: [],
        param: { name: "content" },
      };
      const root = mkTag({ uuid: "root-1", children: [slotNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        updateStyles(api, "comp-1", "slot-1", { color: "blue" })
      ).rejects.toThrow(
        "Only HTML elements and component instances support styling"
      );
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

      // Studio's elementSchemaToTpl returns a failable with a tpl
      const newTpl = mkTag({ uuid: "new-child-1", tag: "div" });
      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: false, value: { tpl: newTpl, warnings: [] } },
      });
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
      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: false, value: { tpl: newTpl, warnings: [] } },
      });
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
      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: false, value: { tpl: newTpl, warnings: [] } },
      });
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

    it("delegates element creation to Studio's elementSchemaToTpl", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1" });
      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: false, value: { tpl: newTpl, warnings: [] } },
      });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      const schema = { type: "text", value: "Hello", tag: "h1" };
      await addChild(api, "comp-1", "Section", schema as any);

      // Verify Studio's function was called with the element schema
      expect(mockElementSchemaToTpl).toHaveBeenCalledWith(
        expect.anything(), // site
        undefined, // component (not used for self-ref detection)
        schema,
        expect.objectContaining({ codeComponentsOnly: false })
      );
      expect(container.children).toContain(newTpl);
    });

    it("throws when Studio's elementSchemaToTpl returns an error", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: true, error: { message: "Bad schema" } },
      });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      await expect(
        addChild(api, "comp-1", "Section", { type: "text", value: "x" })
      ).rejects.toThrow("Bad schema");
    });
  });

  // --- add-child input normalization ---

  describe("addChild input normalization", () => {
    it("normalizes text property to value for type:text elements", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section", children: [] });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1", tag: "div" });
      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: false, value: { tpl: newTpl, warnings: [] } },
      });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });
      setupSession(comp);

      // Pass "text" (not "value") — normalization should map it to "value"
      await addChild(api, "comp-1", "Section", { type: "text", text: "Hello" } as any);

      // elementSchemaToTpl should receive element with value, not text
      const passedElement = mockElementSchemaToTpl.mock.calls[0][2];
      expect(passedElement.value).toBe("Hello");
      expect(passedElement.text).toBeUndefined();
      expect(passedElement.type).toBe("text");
    });

    it("normalizes type:tag to type:box for backward compatibility", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section", children: [] });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1", tag: "div" });
      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: false, value: { tpl: newTpl, warnings: [] } },
      });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await addChild(api, "comp-1", "Section", { type: "tag", tag: "section" } as any);

      const passedElement = mockElementSchemaToTpl.mock.calls[0][2];
      expect(passedElement.type).toBe("box");
      expect(passedElement.tag).toBe("section");
    });

    it("preserves value property when already set", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section", children: [] });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1", tag: "div" });
      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: false, value: { tpl: newTpl, warnings: [] } },
      });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });
      setupSession(comp);

      // When "value" is already set, don't overwrite from "text"
      await addChild(api, "comp-1", "Section", { type: "text", value: "Correct" } as any);

      const passedElement = mockElementSchemaToTpl.mock.calls[0][2];
      expect(passedElement.value).toBe("Correct");
    });

    it("recursively normalizes children", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section", children: [] });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const parentTpl = mkTag({ uuid: "new-1", tag: "div" });
      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: false, value: { tpl: parentTpl, warnings: [] } },
      });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await addChild(api, "comp-1", "Section", {
        type: "vbox",
        children: [
          { type: "text", text: "Nested" } as any,
        ],
      } as any);

      const passedElement = mockElementSchemaToTpl.mock.calls[0][2];
      expect(passedElement.children[0].value).toBe("Nested");
      expect(passedElement.children[0].text).toBeUndefined();
    });
  });

  // --- add-child with component instances ---

  describe("addChild with component instances", () => {
    /** Build a TplComponent-like node */
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

    it("inserts a TplComponent into the container via Studio delegation", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-1",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: false, value: { tpl: newTplComp, warnings: [] } },
      });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(owningComp);

      const result = await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
      });

      expect(result.parentName).toBe("Section");
      expect(result.newNodeUuid).toBe("new-tpl-comp-1");
      expect(container.children.length).toBe(1);
      expect(container.children[0]).toBe(newTplComp);
    });

    it("propagates Studio error for unknown component", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockElementSchemaToTpl.mockReturnValue({
        result: { isError: true, error: { message: 'Unknown component "NonExistent"' } },
      });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(owningComp);

      await expect(
        addChild(api, "comp-1", "Section", {
          type: "component",
          name: "NonExistent",
        })
      ).rejects.toThrow('Unknown component "NonExistent"');
    });
  });

  // --- add-child with registry enrichment ---

  describe("addChild with registry enrichment", () => {
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

    it("applies defaultStyles from registry when adding a component instance", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

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
      mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      // Session includes registryData with defaultStyles for "Card"
      const session = makeSession({
        site: { components: [owningComp, cardComp] },
        registryData: {
          components: [
            {
              name: "Card",
              defaultStyles: { color: "red", fontSize: "16px" },
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
      });

      expect(result.parentName).toBe("Section");
      expect(result.newNodeUuid).toBe("new-tpl-comp-1");

      // Verify defaultStyles were applied via RSH.merge
      // Note: mock RSH stores keys as-is (no kebab-case normalization)
      const vs = newTplComp.vsettings[0];
      expect(vs.rs.values.color).toBe("red");
      expect(vs.rs.values.fontSize).toBe("16px");
    });

    it("matches registry components with $dev suffix", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Site model has name without $dev
      const buttonComp = {
        uuid: "btn-uuid",
        name: "EPButton",
        tplTree: mkTag({ uuid: "btn-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-btn-1",
        componentName: "EPButton",
        componentUuid: "btn-uuid",
      });
      mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      // Registry has $dev suffix
      const session = makeSession({
        site: { components: [owningComp, buttonComp] },
        registryData: {
          components: [
            {
              name: "EPButton$dev",
              defaultStyles: { color: "blue" },
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "EPButton",
      });

      // Should match despite $dev suffix
      const vs = newTplComp.vsettings[0];
      expect(vs.rs.values.color).toBe("blue");
    });

    it("works normally when session has no registryData", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-card-1",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      // No registryData on session
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
      expect(result.newNodeUuid).toBe("new-card-1");
      // No styles applied — rs.values should be empty
      expect(newTplComp.vsettings[0].rs.values).toEqual({});
    });

    it("returns warning when parentComponentName does not match", async () => {
      // The parent is a TplComponent "Accordion"
      const accordionComp = {
        uuid: "accordion-uuid",
        name: "Accordion",
        tplTree: mkTag({ uuid: "acc-root" }),
        params: [{
          variable: { name: "children" },
          tplSlot: true,
        }],
      };

      // The owning component wraps an Accordion
      const accordionTpl: any = {
        _type: "TplComponent",
        uuid: "acc-tpl-1",
        name: "MyAccordion",
        component: accordionComp,
        vsettings: [{ variants: [], rs: { values: {} }, args: [] }],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [accordionTpl] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      // AccordionItem should be inside "Accordion" according to registry
      const itemComp = {
        uuid: "item-uuid",
        name: "AccordionItem",
        tplTree: mkTag({ uuid: "item-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-item-1",
        componentName: "AccordionItem",
        componentUuid: "item-uuid",
      });
      mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} }, args: [] }];
        }
        return tpl.vsettings[0];
      });

      // Registry says AccordionItem should be inside "EPAccordion"
      const session = makeSession({
        site: { components: [owningComp, accordionComp, itemComp] },
        registryData: {
          components: [
            {
              name: "AccordionItem",
              parentComponentName: "EPAccordion",
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await addChild(
        api, "comp-1", "MyAccordion",
        { type: "component", name: "AccordionItem" },
        undefined,
        "children"
      );

      // Should succeed but with warning
      expect(result.newNodeUuid).toBe("new-item-1");
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0]).toContain("AccordionItem");
      expect(result.warnings![0]).toContain("EPAccordion");
      expect(result.warnings![0]).toContain("Accordion");
    });

    it("returns no warning when parentComponentName matches", async () => {
      // Parent is correct "Accordion" (matches "Accordion" in registry)
      const accordionComp = {
        uuid: "accordion-uuid",
        name: "Accordion",
        tplTree: mkTag({ uuid: "acc-root" }),
        params: [{
          variable: { name: "children" },
          tplSlot: true,
        }],
      };

      const accordionTpl: any = {
        _type: "TplComponent",
        uuid: "acc-tpl-1",
        name: "MyAccordion",
        component: accordionComp,
        vsettings: [{ variants: [], rs: { values: {} }, args: [] }],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [accordionTpl] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const itemComp = {
        uuid: "item-uuid",
        name: "AccordionItem",
        tplTree: mkTag({ uuid: "item-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-item-1",
        componentName: "AccordionItem",
        componentUuid: "item-uuid",
      });
      mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} }, args: [] }];
        }
        return tpl.vsettings[0];
      });

      // Registry parentComponentName matches the actual parent
      const session = makeSession({
        site: { components: [owningComp, accordionComp, itemComp] },
        registryData: {
          components: [
            {
              name: "AccordionItem",
              parentComponentName: "Accordion",
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await addChild(
        api, "comp-1", "MyAccordion",
        { type: "component", name: "AccordionItem" },
        undefined,
        "children"
      );

      expect(result.newNodeUuid).toBe("new-item-1");
      expect(result.warnings).toBeUndefined();
    });

    it("returns warning when adding component with parentComponentName to a TplTag parent", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const itemComp = {
        uuid: "item-uuid",
        name: "AccordionItem",
        tplTree: mkTag({ uuid: "item-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-item-1",
        componentName: "AccordionItem",
        componentUuid: "item-uuid",
      });
      mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, itemComp] },
        registryData: {
          components: [
            {
              name: "AccordionItem",
              parentComponentName: "Accordion",
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "AccordionItem",
      });

      expect(result.newNodeUuid).toBe("new-item-1");
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0]).toContain("non-component container");
    });

    it("populates slot defaultValue from registry when no explicit children provided", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Card component has a "children" slot param in the WAB model
      const childrenSlotParam = {
        variable: { name: "children" },
        tplSlot: { _type: "TplSlot" },
      };
      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [childrenSlotParam],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-card-1",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      // Override component to include slot params
      newTplComp.component = cardComp;

      // Mock for the text node created from defaultValue
      const defaultTextTpl = {
        _type: "TplTag",
        uuid: "default-text-1",
        tag: "div",
        vsettings: [{ rs: { values: {} } }],
      };
      mockElementSchemaToTpl
        .mockReturnValueOnce({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } })
        .mockReturnValueOnce({ result: { isError: false, value: { tpl: defaultTextTpl, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} }, args: [] }];
        }
        return tpl.vsettings[0];
      });

      // Registry has slot defaultValue for "children"
      const session = makeSession({
        site: { components: [owningComp, cardComp] },
        registryData: {
          components: [
            {
              name: "Card",
              props: {
                children: {
                  type: "slot",
                  defaultValue: { type: "text", value: "Default card content" },
                },
              },
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
      });

      expect(result.newNodeUuid).toBe("new-card-1");

      // Verify the children slot was populated with default content
      const vs = newTplComp.vsettings[0];
      expect(vs.args.length).toBe(1);
      expect(vs.args[0].param).toBe(childrenSlotParam);
      expect(vs.args[0].expr._type).toBe("RenderExpr");
      expect(vs.args[0].expr.tpl).toHaveLength(1);
      expect(vs.args[0].expr.tpl[0]).toBe(defaultTextTpl);
      // Parent pointer set
      expect(defaultTextTpl.parent).toBe(newTplComp);
    });

    it("populates named slot defaults from registry", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Card component has both "children" and "header" slot params
      const childrenSlotParam = {
        variable: { name: "children" },
        tplSlot: { _type: "TplSlot" },
      };
      const headerSlotParam = {
        variable: { name: "header" },
        tplSlot: { _type: "TplSlot" },
      };
      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [childrenSlotParam, headerSlotParam],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-card-1",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      newTplComp.component = cardComp;

      // Two different text nodes for two different slots
      const bodyTextTpl = {
        _type: "TplTag",
        uuid: "body-text-1",
        tag: "div",
        vsettings: [{ rs: { values: {} } }],
      };
      const headerTextTpl = {
        _type: "TplTag",
        uuid: "header-text-1",
        tag: "div",
        vsettings: [{ rs: { values: {} } }],
      };
      mockElementSchemaToTpl
        .mockReturnValueOnce({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } })
        .mockReturnValueOnce({ result: { isError: false, value: { tpl: bodyTextTpl, warnings: [] } } })
        .mockReturnValueOnce({ result: { isError: false, value: { tpl: headerTextTpl, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} }, args: [] }];
        }
        return tpl.vsettings[0];
      });

      // Registry has defaultValues for both slots
      const session = makeSession({
        site: { components: [owningComp, cardComp] },
        registryData: {
          components: [
            {
              name: "Card",
              props: {
                children: {
                  type: "slot",
                  defaultValue: { type: "text", value: "Body content" },
                },
                header: {
                  type: "slot",
                  defaultValue: { type: "text", value: "Header content" },
                },
              },
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
      });

      // Both slots should be populated
      const vs = newTplComp.vsettings[0];
      expect(vs.args.length).toBe(2);

      const childrenArg = vs.args.find((a: any) => a.param === childrenSlotParam);
      expect(childrenArg).toBeDefined();
      expect(childrenArg.expr.tpl[0]).toBe(bodyTextTpl);

      const headerArg = vs.args.find((a: any) => a.param === headerSlotParam);
      expect(headerArg).toBeDefined();
      expect(headerArg.expr.tpl[0]).toBe(headerTextTpl);
    });

    it("does not override explicit children with slot defaults", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const childrenSlotParam = {
        variable: { name: "children" },
        tplSlot: { _type: "TplSlot" },
      };
      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [childrenSlotParam],
      };

      // mkTplComponentX receives explicit children and creates an arg for them
      const explicitChildTpl = {
        _type: "TplTag",
        uuid: "explicit-child-1",
        tag: "div",
        vsettings: [{ rs: { values: {} } }],
      };
      const newTplComp = mkTplComponent({
        uuid: "new-card-1",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      newTplComp.component = cardComp;
      // Simulate that elementSchemaToTpl created an arg for the "children" slot
      // because explicit children were provided via PlasmicElement.children
      newTplComp.vsettings[0].args = [{
        _type: "Arg",
        param: childrenSlotParam,
        expr: { _type: "RenderExpr", tpl: [explicitChildTpl] },
      }];

      // The child element that the user explicitly provides
      const childTextTpl = {
        _type: "TplTag",
        uuid: "user-text-1",
        tag: "div",
        vsettings: [{ rs: { values: {} } }],
      };
      mockElementSchemaToTpl
        .mockReturnValueOnce({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } })
        .mockReturnValueOnce({ result: { isError: false, value: { tpl: childTextTpl, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} }, args: [] }];
        }
        return tpl.vsettings[0];
      });

      // Registry has defaultValue, but user provides explicit children
      const session = makeSession({
        site: { components: [owningComp, cardComp] },
        registryData: {
          components: [
            {
              name: "Card",
              props: {
                children: {
                  type: "slot",
                  defaultValue: { type: "text", value: "Should NOT appear" },
                },
              },
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
        children: [{ type: "text", value: "User content" }],
      });

      // Should still have only the explicit children arg, not the default
      const vs = newTplComp.vsettings[0];
      expect(vs.args.length).toBe(1);
      expect(vs.args[0].expr.tpl[0]).toBe(explicitChildTpl);
    });

    it("skips slot defaults for slots that don't exist in WAB model", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Component has only "children" slot, no "footer" slot
      const childrenSlotParam = {
        variable: { name: "children" },
        tplSlot: { _type: "TplSlot" },
      };
      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [childrenSlotParam],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-card-1",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      newTplComp.component = cardComp;

      const defaultTextTpl = {
        _type: "TplTag",
        uuid: "default-text-1",
        tag: "div",
        vsettings: [{ rs: { values: {} } }],
      };
      mockElementSchemaToTpl
        .mockReturnValueOnce({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } })
        .mockReturnValueOnce({ result: { isError: false, value: { tpl: defaultTextTpl, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} }, args: [] }];
        }
        return tpl.vsettings[0];
      });

      // Registry has defaultValue for "footer" slot that doesn't exist in WAB model
      // AND "children" which does exist
      const session = makeSession({
        site: { components: [owningComp, cardComp] },
        registryData: {
          components: [
            {
              name: "Card",
              props: {
                children: {
                  type: "slot",
                  defaultValue: { type: "text", value: "Body" },
                },
                footer: {
                  type: "slot",
                  defaultValue: { type: "text", value: "Footer text" },
                },
              },
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
      });

      // Only "children" should be populated (footer slot doesn't exist)
      const vs = newTplComp.vsettings[0];
      expect(vs.args.length).toBe(1);
      expect(vs.args[0].param).toBe(childrenSlotParam);
    });

    it("handles non-slot props with defaultValue without treating them as slots", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-card-1",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      newTplComp.component = cardComp;
      mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTplComp, warnings: [] } } });
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} }, args: [] }];
        }
        return tpl.vsettings[0];
      });

      // Registry has a non-slot prop with a defaultValue (e.g., a string prop)
      const session = makeSession({
        site: { components: [owningComp, cardComp] },
        registryData: {
          components: [
            {
              name: "Card",
              props: {
                title: {
                  type: "string",
                  defaultValue: "Untitled",
                },
              },
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
      });

      // No slot args should be created (title is type "string", not "slot")
      const vs = newTplComp.vsettings[0];
      expect(vs.args.length).toBe(0);
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

    it("rejects move to TplComponent parent without slots", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const compNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "CompTarget",
        component: { name: "Other", uuid: "other", params: [] },
        vsettings: [{ rs: { values: {} }, args: [] }],
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
      ).rejects.toThrow('Component "Other" has no slots.');
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

    it("moves node into TplComponent slot creating new Arg+RenderExpr", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const childrenParam = { variable: { name: "children" }, tplSlot: { _type: "TplSlot" } };
      const headerParam = { variable: { name: "header" }, tplSlot: { _type: "TplSlot" } };
      const compNode: any = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "CardTarget",
        component: { name: "Card", params: [childrenParam, headerParam] },
        vsettings: [{ rs: { values: {} }, args: [] }],
        children: [],
      };
      const source = mkTag({
        uuid: "source-1",
        name: "Source",
        children: [movable],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, compNode],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await moveChild(api, "comp-1", "Movable", "tpl-comp-1", undefined, "header");

      expect(result.movedName).toBe("Movable");
      expect(result.slotName).toBe("header");
      expect(source.children.length).toBe(0);

      // Verify Arg+RenderExpr was created in the slot
      const vs = compNode.vsettings[0];
      const headerArg = vs.args.find(
        (a: any) => a.param?.variable?.name === "header"
      );
      expect(headerArg).toBeDefined();
      expect(headerArg.expr._type).toBe("RenderExpr");
      expect(headerArg.expr.tpl).toContain(movable);
      expect(movable.parent).toBe(compNode);
    });

    it("moves node into existing slot RenderExpr", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const existingSlotChild = mkTag({ uuid: "slot-child-1" });
      const childrenParam = { variable: { name: "children" }, tplSlot: { _type: "TplSlot" } };
      const compNode: any = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "CardTarget",
        component: { name: "Card", params: [childrenParam] },
        vsettings: [{
          rs: { values: {} },
          args: [{
            _type: "Arg",
            param: childrenParam,
            expr: { _type: "RenderExpr", tpl: [existingSlotChild] },
          }],
        }],
        children: [],
      };
      const source = mkTag({
        uuid: "source-1",
        name: "Source",
        children: [movable],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, compNode],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await moveChild(api, "comp-1", "Movable", "tpl-comp-1");

      // Default slot is "children", and it appends to existing tpl array
      const vs = compNode.vsettings[0];
      const childrenArg = vs.args[0];
      expect(childrenArg.expr.tpl).toEqual([existingSlotChild, movable]);
    });

    it("defaults to 'children' slot when slot omitted on TplComponent", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const childrenParam = { variable: { name: "children" }, tplSlot: { _type: "TplSlot" } };
      const compNode: any = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "CardTarget",
        component: { name: "Card", params: [childrenParam] },
        vsettings: [{ rs: { values: {} }, args: [] }],
        children: [],
      };
      const source = mkTag({
        uuid: "source-1",
        children: [movable],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, compNode],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await moveChild(api, "comp-1", "Movable", "tpl-comp-1");

      expect(result.slotName).toBe("children");
      const childrenArg = compNode.vsettings[0].args.find(
        (a: any) => a.param?.variable?.name === "children"
      );
      expect(childrenArg).toBeDefined();
      expect(childrenArg.expr.tpl).toContain(movable);
    });

    it("rejects slot targeting on TplTag parent", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const source = mkTag({
        uuid: "source-1",
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

      await expect(
        moveChild(api, "comp-1", "Movable", "Target", undefined, "header")
      ).rejects.toThrow("Slot targeting only applies to component instances");
    });

    it("rejects nonexistent slot name on TplComponent", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const childrenParam = { variable: { name: "children" }, tplSlot: { _type: "TplSlot" } };
      const compNode: any = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "CardTarget",
        component: { name: "Card", params: [childrenParam] },
        vsettings: [{ rs: { values: {} }, args: [] }],
        children: [],
      };
      const source = mkTag({
        uuid: "source-1",
        children: [movable],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, compNode],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        moveChild(api, "comp-1", "Movable", "tpl-comp-1", undefined, "sidebar")
      ).rejects.toThrow('Slot "sidebar" not found on component "Card". Available slots: children');
    });

    it("detects cycles through TplComponent slot overrides", async () => {
      // Outer contains a TplComponent with a slot override containing Inner
      const innerChild = mkTag({ uuid: "inner-1", name: "Inner" });
      const tplComp = {
        _type: "TplComponent",
        uuid: "tc-1",
        name: "Wrapper",
        children: [],
        vsettings: [
          {
            variants: [],
            args: [
              {
                param: { paramName: "children", uuid: "p1" },
                expr: {
                  _type: "RenderExpr",
                  tpl: [innerChild],
                },
              },
            ],
            rs: { values: {} },
          },
        ],
        component: { name: "Card", uuid: "card-1", params: [{ paramName: "children", uuid: "p1", tplSlot: {} }] },
      };
      const outerParent = mkTag({
        uuid: "outer-1",
        name: "Outer",
        children: [tplComp],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [outerParent],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      // Try to move Outer into its descendant Inner (hidden inside a slot override)
      await expect(
        moveChild(api, "comp-1", "Outer", "Inner")
      ).rejects.toThrow('Cannot move "Outer" into its own descendant "Inner"');
    });
  });

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

    it("targets a code component variant by key name (synced via devhost-sync)", async () => {
      // This tests the full updateStyles → resolveVariant → CC variant path.
      // In production, devhost-sync populates codeComponentMeta.variants on the
      // code component and creates Variant objects on wrapper components. This test
      // verifies that updateStyles correctly resolves a CC variant key and applies
      // styles to the corresponding variant setting.

      // 1. Build the code component with synced variant metadata
      const codeComp = {
        name: "EPBundleOptionTrigger",
        codeComponentMeta: {
          variants: {
            selected: { cssSelector: "[data-selected]", displayName: "Selected" },
            disabled: { cssSelector: ":disabled", displayName: "Disabled" },
          },
        },
      };

      // 2. Build the CC variant object (created by ensureVariantObjects in devhost-sync)
      const ccVariant = {
        uuid: "cc-var-selected",
        name: "",
        codeComponentName: "EPBundleOptionTrigger",
        codeComponentVariantKeys: ["selected"],
        selectors: null,
        parent: null,
        mediaQuery: null,
      };

      // 3. Build a child node to style — placed inside a slot override on the
      //    TplComponent root so the node-resolver can traverse it.
      //    The resolver handles TplComponent children via vsettings[0].args[].expr.tpl[].
      const node = mkTag({ uuid: "styled-1", name: "Box", styles: { color: "red" } });

      // 4. Build the wrapper component — tplTree root is TplComponent referencing codeComp.
      //    Child node is inside a slot override (RenderExpr) so the node-resolver finds it.
      const comp = {
        uuid: "comp-1",
        name: "BundleOptionCard",
        tplTree: {
          _type: "TplComponent",
          uuid: "root-tpl",
          component: codeComp,
          vsettings: [{
            rs: { values: {} },
            args: [{
              param: { variable: { name: "children" } },
              expr: { _type: "RenderExpr", tpl: [node] },
            }],
          }],
          children: [],
        },
        variantGroups: [],
        variants: [ccVariant],
        pageMeta: undefined,
      };

      // 5. Set up mock variant setting target
      const ccVs = { rs: { values: {} }, variants: [ccVariant] };
      mockEnsureVariantSetting.mockReturnValue(ccVs);

      const session = makeSession({
        site: { components: [comp], globalVariantGroups: [] },
      });
      setSession(session);
      initChangeTracker(session.site);

      // 6. Call updateStyles with CC variant key "selected"
      await updateStyles(api, "comp-1", "Box", { color: "blue" }, "selected");

      // 7. Verify ensureVariantSetting was called with the CC variant
      expect(mockEnsureVariantSetting).toHaveBeenCalledWith(node, [ccVariant]);
      expect(ccVs.rs.values).toHaveProperty("color", "blue");
    });

    it("targets a code component variant by display name (case-insensitive)", async () => {
      // Tests the CC variant display name resolution path in resolveVariant.
      // Users may reference variants by display name (e.g., "Selected") rather
      // than by internal key (e.g., "selected").

      const codeComp = {
        name: "EPButton$dev",
        codeComponentMeta: {
          variants: {
            isPressed: { cssSelector: ":active", displayName: "Pressed State" },
          },
        },
      };

      const ccVariant = {
        uuid: "cc-var-pressed",
        name: "",
        codeComponentName: "EPButton$dev",
        codeComponentVariantKeys: ["isPressed"],
        selectors: null,
        parent: null,
        mediaQuery: null,
      };

      const node = mkTag({ uuid: "styled-1", name: "Inner" });
      const comp = {
        uuid: "comp-1",
        name: "ButtonWrapper",
        tplTree: {
          _type: "TplComponent",
          uuid: "root-tpl",
          component: codeComp,
          vsettings: [{
            rs: { values: {} },
            args: [{
              param: { variable: { name: "children" } },
              expr: { _type: "RenderExpr", tpl: [node] },
            }],
          }],
          children: [],
        },
        variantGroups: [],
        variants: [ccVariant],
        pageMeta: undefined,
      };

      const ccVs = { rs: { values: {} }, variants: [ccVariant] };
      mockEnsureVariantSetting.mockReturnValue(ccVs);

      const session = makeSession({
        site: { components: [comp], globalVariantGroups: [] },
      });
      setSession(session);
      initChangeTracker(session.site);

      // Resolve by display name — case-insensitive
      await updateStyles(api, "comp-1", "Inner", { opacity: "0.5" }, "pressed state");

      expect(mockEnsureVariantSetting).toHaveBeenCalledWith(node, [ccVariant]);
      expect(ccVs.rs.values).toHaveProperty("opacity", "0.5");
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

  // --- updateAttrs ---

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

  // --- updateAttrs expression safety ---

  describe("updateAttrs expression safety", () => {
    it("accepts valid dynamic expression with $ prefix", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Input", {
        value: "$state.firstName",
      });

      expect(result.updatedAttributes).toEqual(["value"]);
      expect(result.warnings).toBeUndefined();
      const attrs = node.vsettings[0].attrs;
      expect(attrs.value._type).toBe("CustomCode");
      expect(attrs.value.code).toBe("state.firstName");
    });

    it("rejects invalid JS expression with $ prefix", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await expect(
        updateAttrs(api, "comp-1", "Input", {
          value: "$state.firstName +",
        })
      ).rejects.toThrow(/Invalid JS expression/);
    });

    it("rejects invalid JS expression with {{}} wrapper", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      await expect(
        updateAttrs(api, "comp-1", "Input", {
          value: "{{state.x +}}",
        })
      ).rejects.toThrow(/Invalid JS expression/);
    });

    it("warns when static string looks like a dynamic expression", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Input", {
        value: "state.firstName",
      });

      // Value is stored as a literal string, but with a warning
      expect(result.updatedAttributes).toEqual(["value"]);
      const attrs = node.vsettings[0].attrs;
      expect(attrs.value.code).toBe('"state.firstName"');
      expect(result.warnings).toBeUndefined();
    });

    it("warns for static string containing $state. reference", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      // "Please set $state.name" doesn't start with "$" so it's a static literal,
      // but contains "$state." which triggers the dangling-expression warning.
      const result = await updateAttrs(api, "comp-1", "Input", {
        placeholder: "Please set $state.name",
      });

      expect(result.updatedAttributes).toEqual(["placeholder"]);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0]).toContain("static string literal");
    });

    it("does not warn for plain static strings", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Input", {
        value: "hello",
      });

      expect(result.updatedAttributes).toEqual(["value"]);
      expect(result.warnings).toBeUndefined();
      const attrs = node.vsettings[0].attrs;
      expect(attrs.value.code).toBe('"hello"');
    });

    it("accepts numeric values without warnings", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Input", {
        tabindex: 42,
      });

      expect(result.updatedAttributes).toEqual(["tabindex"]);
      expect(result.warnings).toBeUndefined();
      const attrs = node.vsettings[0].attrs;
      expect(attrs.tabindex.code).toBe("42");
    });

    it("accepts boolean values without warnings", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Input", {
        disabled: true,
      });

      expect(result.updatedAttributes).toEqual(["disabled"]);
      expect(result.warnings).toBeUndefined();
      const attrs = node.vsettings[0].attrs;
      expect(attrs.disabled.code).toBe("true");
    });

    it("removes attribute when value is null", async () => {
      const node = mkTag({ uuid: "node-1", name: "Input" });
      node.vsettings[0].attrs = {
        value: { _type: "CustomCode", code: '"old"', fallback: null },
      };
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Input", {
        value: null,
      });

      expect(result.removedAttributes).toEqual(["value"]);
      expect(result.warnings).toBeUndefined();
    });

    it("warns for string containing dangling $ctx. reference", async () => {
      const node = mkTag({ uuid: "node-1", name: "Link" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings[0].attrs) tpl.vsettings[0].attrs = {};
        return tpl.vsettings[0];
      });
      setupSession(comp);

      const result = await updateAttrs(api, "comp-1", "Link", {
        href: "Navigate to $ctx.url please",
      });

      // Contains $ctx. → warning about storing as literal
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0]).toContain("static string literal");
    });
  });

  // --- resolveTokenReferences ---

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
// addChild — slot content targeting
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
    mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTpl, warnings: [] } } });
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
    mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTpl, warnings: [] } } });
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
    mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTpl, warnings: [] } } });
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
    mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTpl, warnings: [] } } });
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
    mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTpl, warnings: [] } } });
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
    mockElementSchemaToTpl.mockReturnValue({ result: { isError: false, value: { tpl: newTpl, warnings: [] } } });
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
// removeChild — slot override content removal
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
// cloneChild — deep clone of a tree node
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

  it("clones into a TplComponent slot creating new Arg+RenderExpr", async () => {
    const child = mkTag({ uuid: "child-1", name: "Source" });
    const childrenParam = { variable: { name: "children" }, tplSlot: { _type: "TplSlot" } };
    const headerParam = { variable: { name: "header" }, tplSlot: { _type: "TplSlot" } };
    const compNode: any = {
      _type: "TplComponent",
      uuid: "tpl-comp-1",
      name: "CardTarget",
      component: { name: "Card", params: [childrenParam, headerParam] },
      vsettings: [{ rs: { values: {} }, args: [] }],
      children: [],
    };
    const root = mkTag({ uuid: "root-1", children: [child, compNode] });
    child.parent = root;
    compNode.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    const result = await cloneChild(api, "comp-1", "Source", undefined, "tpl-comp-1", undefined, "header");

    expect(result.slotName).toBe("header");
    // Original still in root
    expect(root.children).toHaveLength(2);
    // Clone is in the slot
    const vs = compNode.vsettings[0];
    const headerArg = vs.args.find(
      (a: any) => a.param?.variable?.name === "header"
    );
    expect(headerArg).toBeDefined();
    expect(headerArg.expr._type).toBe("RenderExpr");
    expect(headerArg.expr.tpl).toHaveLength(1);
    expect(headerArg.expr.tpl[0].uuid).not.toBe("child-1"); // New UUID
    expect(headerArg.expr.tpl[0].name).toBe("Source (copy)");
  });

  it("clones into existing slot RenderExpr on TplComponent", async () => {
    const child = mkTag({ uuid: "child-1", name: "Source" });
    const existingSlotChild = mkTag({ uuid: "slot-child-1" });
    const childrenParam = { variable: { name: "children" }, tplSlot: { _type: "TplSlot" } };
    const compNode: any = {
      _type: "TplComponent",
      uuid: "tpl-comp-1",
      name: "CardTarget",
      component: { name: "Card", params: [childrenParam] },
      vsettings: [{
        rs: { values: {} },
        args: [{
          _type: "Arg",
          param: childrenParam,
          expr: { _type: "RenderExpr", tpl: [existingSlotChild] },
        }],
      }],
      children: [],
    };
    const root = mkTag({ uuid: "root-1", children: [child, compNode] });
    child.parent = root;
    compNode.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await cloneChild(api, "comp-1", "Source", undefined, "tpl-comp-1");

    // Default slot "children" — clone appended to existing tpl array
    const childrenArg = compNode.vsettings[0].args[0];
    expect(childrenArg.expr.tpl).toHaveLength(2);
    expect(childrenArg.expr.tpl[0]).toBe(existingSlotChild);
    expect(childrenArg.expr.tpl[1].uuid).not.toBe("child-1");
  });

  it("rejects slot targeting on TplTag parent in cloneChild", async () => {
    const child = mkTag({ uuid: "child-1", name: "Source" });
    const target = mkTag({ uuid: "target-1", name: "Target" });
    const root = mkTag({ uuid: "root-1", children: [child, target] });
    child.parent = root;
    target.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await expect(
      cloneChild(api, "comp-1", "Source", undefined, "Target", undefined, "header")
    ).rejects.toThrow("Slot targeting only applies to component instances");
  });

  it("rejects nonexistent slot name in cloneChild", async () => {
    const child = mkTag({ uuid: "child-1", name: "Source" });
    const childrenParam = { variable: { name: "children" }, tplSlot: { _type: "TplSlot" } };
    const compNode: any = {
      _type: "TplComponent",
      uuid: "tpl-comp-1",
      name: "CardTarget",
      component: { name: "Card", params: [childrenParam] },
      vsettings: [{ rs: { values: {} }, args: [] }],
      children: [],
    };
    const root = mkTag({ uuid: "root-1", children: [child, compNode] });
    child.parent = root;
    compNode.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await expect(
      cloneChild(api, "comp-1", "Source", undefined, "tpl-comp-1", undefined, "sidebar")
    ).rejects.toThrow('Slot "sidebar" not found on component "Card". Available slots: children');
  });

  it("rejects slot without parentRef in cloneChild", async () => {
    const child = mkTag({ uuid: "child-1", name: "Source" });
    const root = mkTag({ uuid: "root-1", children: [child] });
    child.parent = root;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });

    setupSession(comp);

    await expect(
      cloneChild(api, "comp-1", "Source", undefined, undefined, undefined, "header")
    ).rejects.toThrow("Slot targeting requires parentRef");
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
// updateRichText — rich text with StyleMarkers and NodeMarkers
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

  it("sets TplTagType.Text when plain text is set on a non-text node", async () => {
    // A node with no text and no children — not a container, not a text node
    const emptyNode = mkTag({ uuid: "empty-1" });
    delete emptyNode.vsettings[0].text;
    emptyNode.type = "other"; // Not text yet
    const comp = mkComponent({ uuid: "comp-1", tplTree: emptyNode });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateRichText(api, "comp-1", "empty-1", "New text", []);
    // After: node.type should be set to TplTagType.Text
    expect(emptyNode.type).toBe(TplTagType.Text);
    expect(emptyNode.vsettings[0].text._type).toBe("RawText");
    expect(emptyNode.vsettings[0].text.text).toBe("New text");
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
// applyMixin / detachMixin — mixin application on elements
// =============================================================================

describe("applyMixin", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    clearNodeCache();
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

// =============================================================================
// addNodeAnimation / removeNodeAnimation — animation application on elements
// =============================================================================

describe("addNodeAnimation", () => {
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

  it("applies an animation to an element", async () => {
    const seq = { uuid: "s1", name: "Bounce", keyframes: [] };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.animations = null;
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], animationSequences: [seq] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    mockAddAnimation.mockReturnValue({
      _type: "Animation", sequence: seq, duration: "1s", delay: "0s",
      timingFunction: "ease", iterationCount: "1", direction: "normal",
      fillMode: "none", playState: "running",
    });

    const result = await addNodeAnimation(api, "comp-1", "Root", "Bounce");
    expect(result.sequenceName).toBe("Bounce");
    expect(result.nodeUuid).toBe("root-1");
    expect(root.vsettings[0].rs.animations).toHaveLength(1);
    expect(mockAddAnimation).toHaveBeenCalled();
  });

  it("passes timing parameters", async () => {
    const seq = { uuid: "s1", name: "Slide", keyframes: [] };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.animations = [];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], animationSequences: [seq] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    mockAddAnimation.mockReturnValue({ _type: "Animation", sequence: seq });

    await addNodeAnimation(
      api, "comp-1", "Root", "Slide",
      "2s", "0.5s", "ease-in-out", "infinite", "alternate", "both", "running"
    );
    expect(mockAddAnimation).toHaveBeenCalledWith(
      seq, "2s", "0.5s", "ease-in-out", "infinite", "alternate", "both", "running"
    );
  });

  it("rejects invalid direction", async () => {
    const seq = { uuid: "s1", name: "Seq", keyframes: [] };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.animations = [];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], animationSequences: [seq] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addNodeAnimation(api, "comp-1", "Root", "Seq", undefined, undefined, undefined, undefined, "invalid-dir")
    ).rejects.toThrow(/Invalid direction/);
  });

  it("throws when sequence not found", async () => {
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.animations = [];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], animationSequences: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addNodeAnimation(api, "comp-1", "Root", "nonexistent")
    ).rejects.toThrow(/not found/);
  });
});

describe("removeNodeAnimation", () => {
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

  it("removes all animations when no filter specified", async () => {
    const seq = { uuid: "s1", name: "Seq", keyframes: [] };
    const anim1 = { _type: "Animation", sequence: seq };
    const anim2 = { _type: "Animation", sequence: seq };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.animations = [anim1, anim2];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], animationSequences: [seq] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    const result = await removeNodeAnimation(api, "comp-1", "Root");
    expect(result.removedCount).toBe(2);
    expect(root.vsettings[0].rs.animations).toHaveLength(0);
  });

  it("removes animation by index", async () => {
    const seq1 = { uuid: "s1", name: "Seq1", keyframes: [] };
    const seq2 = { uuid: "s2", name: "Seq2", keyframes: [] };
    const anim1 = { _type: "Animation", sequence: seq1 };
    const anim2 = { _type: "Animation", sequence: seq2 };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.animations = [anim1, anim2];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], animationSequences: [seq1, seq2] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    const result = await removeNodeAnimation(api, "comp-1", "Root", undefined, 0);
    expect(result.removedCount).toBe(1);
    expect(root.vsettings[0].rs.animations).toHaveLength(1);
    expect(root.vsettings[0].rs.animations[0]).toBe(anim2);
  });

  it("removes animations by sequence reference", async () => {
    const seq1 = { uuid: "s1", name: "Seq1", keyframes: [] };
    const seq2 = { uuid: "s2", name: "Seq2", keyframes: [] };
    const anim1 = { _type: "Animation", sequence: seq1 };
    const anim2 = { _type: "Animation", sequence: seq2 };
    const anim3 = { _type: "Animation", sequence: seq1 };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.animations = [anim1, anim2, anim3];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], animationSequences: [seq1, seq2] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    const result = await removeNodeAnimation(api, "comp-1", "Root", "Seq1");
    expect(result.removedCount).toBe(2);
    expect(root.vsettings[0].rs.animations).toHaveLength(1);
    expect(root.vsettings[0].rs.animations[0]).toBe(anim2);
  });

  it("throws when no animations exist", async () => {
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.animations = [];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], animationSequences: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    await expect(
      removeNodeAnimation(api, "comp-1", "Root")
    ).rejects.toThrow(/No animations/);
  });

  it("throws when animation index out of range", async () => {
    const seq = { uuid: "s1", name: "Seq", keyframes: [] };
    const anim = { _type: "Animation", sequence: seq };
    const root = mkTag({ uuid: "root-1", name: "Root" });
    root.vsettings[0].rs.animations = [anim];
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], animationSequences: [seq] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

    await expect(
      removeNodeAnimation(api, "comp-1", "Root", undefined, 5)
    ).rejects.toThrow(/out of range/);
  });
});

// =============================================================================
// reorderChildren — reorder child nodes within a container
// =============================================================================

describe("reorderChildren", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => { api = mockApiClient(); });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("reorders children of a container", async () => {
    const child1 = mkTag({ uuid: "c1", name: "First" });
    const child2 = mkTag({ uuid: "c2", name: "Second" });
    const child3 = mkTag({ uuid: "c3", name: "Third" });
    const parent = mkTag({ uuid: "p1", name: "Container", children: [child1, child2, child3] });
    const comp = mkComponent({ uuid: "comp1", name: "MyComp", tplTree: parent });
    const site = { components: [comp] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await reorderChildren(api, "comp1", "Container", ["Third", "First", "Second"]);
    expect(result.parentName).toBe("Container");
    expect(mockReorderChildren).toHaveBeenCalled();
  });

  it("throws when parent has no children", async () => {
    const parent = mkTag({ uuid: "p1", name: "Empty", children: [] });
    const comp = mkComponent({ uuid: "comp1", name: "MyComp", tplTree: parent });
    const site = { components: [comp] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(reorderChildren(api, "comp1", "Empty", [])).rejects.toThrow(/no children/);
  });

  it("throws when a childRef is not a direct child", async () => {
    const child = mkTag({ uuid: "c1", name: "Child" });
    const parent = mkTag({ uuid: "p1", name: "Container", children: [child] });
    const comp = mkComponent({ uuid: "comp1", name: "MyComp", tplTree: parent });
    const site = { components: [comp] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(reorderChildren(api, "comp1", "Container", ["Container"])).rejects.toThrow(/not a direct child/);
  });
});

// =============================================================================
// setImage — set image src or background on elements
// =============================================================================

describe("setImage", () => {
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
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); vi.restoreAllMocks(); });

  // Local mkTag override: setImage tests use a minimal fixture without text/styles
  function mkTag(opts: { uuid?: string; name?: string; tag?: string; children?: any[] }): any {
    return {
      _type: "TplTag",
      uuid: opts.uuid ?? `uuid-${Math.random().toString(36).slice(2, 8)}`,
      name: opts.name,
      tag: opts.tag ?? "div",
      vsettings: [{ rs: { values: {} }, attrs: {} }],
      children: opts.children ?? [],
    };
  }

  it("sets image src from asset on img element", async () => {
    const asset = { uuid: "a1", name: "Hero", type: "picture", dataUri: "data:image/png;base64,abc" };
    const imgNode = mkTag({ uuid: "img-1", name: "Hero Image", tag: "img" });
    const root = mkTag({ uuid: "root-1", children: [imgNode] });
    const comp = { uuid: "comp-1", name: "TestComp", tplTree: root };
    const site = { components: [comp], imageAssets: [asset] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await setImage(api, "comp-1", "img-1", { assetRef: "Hero" });

    expect(result.nodeUuid).toBe("img-1");
    expect(result.imageSource).toBe("asset:Hero");
    const vs = imgNode.vsettings[0];
    expect(vs.attrs.src).toBeDefined();
    expect(vs.attrs.src._type).toBe("ImageAssetRef");
    expect(vs.attrs.src.asset).toBe(asset);
  });

  it("sets image src from raw URL on img element", async () => {
    const imgNode = mkTag({ uuid: "img-1", name: "Photo", tag: "img" });
    const root = mkTag({ uuid: "root-1", children: [imgNode] });
    const comp = { uuid: "comp-1", name: "TestComp", tplTree: root };
    const site = { components: [comp], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await setImage(api, "comp-1", "img-1", { src: "https://example.com/photo.jpg" });

    expect(result.imageSource).toBe("https://example.com/photo.jpg");
    const vs = imgNode.vsettings[0];
    expect(vs.attrs.src).toBeDefined();
    expect(vs.attrs.src._type).toBe("CustomCode");
    expect(vs.attrs.src.code).toBe('"https://example.com/photo.jpg"');
  });

  it("sets background on non-img element from asset", async () => {
    const asset = { uuid: "a1", name: "BG", type: "picture", dataUri: "data:image/png;base64,bg" };
    const divNode = mkTag({ uuid: "div-1", name: "Hero Section", tag: "div" });
    const root = mkTag({ uuid: "root-1", children: [divNode] });
    const comp = { uuid: "comp-1", name: "TestComp", tplTree: root };
    const site = { components: [comp], imageAssets: [asset] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await setImage(api, "comp-1", "div-1", { assetRef: "BG" });

    expect(result.imageSource).toBe("asset:BG");
    expect(divNode.vsettings[0].rs.values["background"]).toContain("url(");
  });

  it("sets background on non-img element from raw URL", async () => {
    const divNode = mkTag({ uuid: "div-1", tag: "section" });
    const root = mkTag({ uuid: "root-1", children: [divNode] });
    const comp = { uuid: "comp-1", name: "TestComp", tplTree: root };
    const site = { components: [comp], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await setImage(api, "comp-1", "div-1", { src: "https://example.com/bg.jpg" });

    expect(divNode.vsettings[0].rs.values["background"]).toBe('url("https://example.com/bg.jpg")');
  });

  it("throws when neither assetRef nor src provided", async () => {
    const imgNode = mkTag({ uuid: "img-1", tag: "img" });
    const root = mkTag({ uuid: "root-1", children: [imgNode] });
    const comp = { uuid: "comp-1", name: "TC", tplTree: root };
    const site = { components: [comp], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(setImage(api, "comp-1", "img-1", {})).rejects.toThrow(
      /Either assetRef or src must be provided/
    );
  });

  it("throws when target is TplComponent", async () => {
    const tplComp = {
      _type: "TplComponent",
      uuid: "tc-1",
      vsettings: [{ rs: { values: {} } }],
      children: [],
    };
    const root = mkTag({ uuid: "root-1", children: [tplComp] });
    const comp = { uuid: "comp-1", name: "TC", tplTree: root };
    const site = { components: [comp], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      setImage(api, "comp-1", "tc-1", { src: "https://example.com/img.jpg" })
    ).rejects.toThrow(/TplTag element/);
  });

  it("escapes quotes and backslashes in raw URL for background CSS", async () => {
    const divNode = mkTag({ uuid: "div-1", tag: "div" });
    const root = mkTag({ uuid: "root-1", children: [divNode] });
    const comp = { uuid: "comp-1", name: "TestComp", tplTree: root };
    const site = { components: [comp], imageAssets: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await setImage(api, "comp-1", "div-1", {
      src: 'https://example.com/img"with"quotes.jpg',
    });

    expect(result.imageSource).toBe('https://example.com/img"with"quotes.jpg');
    const bgValue = divNode.vsettings[0].rs.values["background"];
    // Quotes in the URL must be escaped to prevent malformed CSS
    expect(bgValue).toContain('\\"');
    expect(bgValue).not.toContain('""');
  });
});

// ========================================================================
// updateProps — component instance prop mutations
// ========================================================================

describe("updateProps", () => {
  let api: ReturnType<typeof mockApiClient>;

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

  function mkParam(name: string, opts?: { isSlot?: boolean; type?: string }) {
    const variable = { name, uuid: `var-${name}` };
    return {
      _type: opts?.isSlot ? "SlotParam" : "PropParam",
      typeTag: opts?.isSlot ? "SlotParam" : "PropParam",
      uuid: `param-${name}`,
      variable,
      type: { name: opts?.type ?? "text" },
      tplSlot: opts?.isSlot ? { uuid: `slot-${name}` } : undefined,
      required: false,
      exportType: "External",
    };
  }

  function mkTplComponent(name: string, params: any[]): any {
    return {
      _type: "TplComponent",
      uuid: `tpl-${name}`,
      name,
      component: { name: `${name}Component`, params, uuid: `comp-inner-${name}` },
      vsettings: [{ variants: [], args: [], rs: { values: {} } }],
      children: [],
    };
  }

  function setupSession(component: any) {
    const session = makeSession({ site: { components: [component] } } as any);
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
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("sets static string prop via createAttrExpr", async () => {
    const currencyParam = mkParam("currency");
    const tplComp = mkTplComponent("PayButton", [currencyParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      if (!tpl.vsettings[0].args) tpl.vsettings[0].args = [];
      return tpl.vsettings[0];
    });

    const result = await updateProps(api, "comp-1", "PayButton", { currency: "USD" });

    expect(result.updatedProps).toEqual(["currency"]);
    expect(result.removedProps).toEqual([]);
    expect(mockSetTplComponentArg).toHaveBeenCalledOnce();
    // Verify the expression is a CustomCode with JSON-serialized literal
    const callArgs = mockSetTplComponentArg.mock.calls[0];
    expect(callArgs[2]).toBe(currencyParam.variable); // argVar
    expect(callArgs[3]._type).toBe("CustomCode");
    expect(callArgs[3].code).toBe('"USD"');
  });

  it("sets dynamic prop with $ prefix", async () => {
    const orderIdParam = mkParam("orderId");
    const tplComp = mkTplComponent("PayButton", [orderIdParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      if (!tpl.vsettings[0].args) tpl.vsettings[0].args = [];
      return tpl.vsettings[0];
    });

    const result = await updateProps(api, "comp-1", "PayButton", { orderId: "$ctx.params.orderId" });

    expect(result.updatedProps).toEqual(["orderId"]);
    const callArgs = mockSetTplComponentArg.mock.calls[0];
    expect(callArgs[3]._type).toBe("CustomCode");
    expect(callArgs[3].code).toBe("ctx.params.orderId"); // $ stripped
  });

  it("sets dynamic prop with {{expr}} syntax", async () => {
    const amountParam = mkParam("amount");
    const tplComp = mkTplComponent("PayButton", [amountParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      if (!tpl.vsettings[0].args) tpl.vsettings[0].args = [];
      return tpl.vsettings[0];
    });

    const result = await updateProps(api, "comp-1", "PayButton", { amount: "{{$queries.cart.data.total}}" });

    expect(result.updatedProps).toEqual(["amount"]);
    const callArgs = mockSetTplComponentArg.mock.calls[0];
    expect(callArgs[3].code).toBe("$queries.cart.data.total");
  });

  it("sets boolean and number props", async () => {
    const testModeParam = mkParam("testMode", { type: "boolean" });
    const countParam = mkParam("count", { type: "number" });
    const tplComp = mkTplComponent("PayButton", [testModeParam, countParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      if (!tpl.vsettings[0].args) tpl.vsettings[0].args = [];
      return tpl.vsettings[0];
    });

    const result = await updateProps(api, "comp-1", "PayButton", { testMode: true, count: 42 });

    expect(result.updatedProps).toEqual(["testMode", "count"]);
    expect(mockSetTplComponentArg).toHaveBeenCalledTimes(2);
    // boolean
    expect(mockSetTplComponentArg.mock.calls[0][3].code).toBe("true");
    // number
    expect(mockSetTplComponentArg.mock.calls[1][3].code).toBe("42");
  });

  it("removes prop when value is null", async () => {
    const currencyParam = mkParam("currency");
    const tplComp = mkTplComponent("PayButton", [currencyParam]);
    // Pre-populate an existing arg
    tplComp.vsettings[0].args = [{ param: currencyParam, expr: { _type: "CustomCode", code: '"USD"' } }];
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      return tpl.vsettings[0];
    });

    const result = await updateProps(api, "comp-1", "PayButton", { currency: null });

    expect(result.removedProps).toEqual(["currency"]);
    expect(result.updatedProps).toEqual([]);
    // The arg should have been spliced out
    // (mockSetTplComponentArg is NOT called for removal — splice is done directly)
    expect(mockSetTplComponentArg).not.toHaveBeenCalled();
  });

  it("throws when prop name does not exist on component", async () => {
    const currencyParam = mkParam("currency");
    const tplComp = mkTplComponent("PayButton", [currencyParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    await expect(
      updateProps(api, "comp-1", "PayButton", { nonExistent: "value" })
    ).rejects.toThrow('Prop "nonExistent" does not exist on component "PayButtonComponent". Available props: currency');
  });

  it("throws when nodeRef resolves to TplTag instead of TplComponent", async () => {
    const divNode = {
      _type: "TplTag",
      uuid: "div-1",
      name: "Container",
      tag: "div",
      vsettings: [{ variants: [], rs: { values: {} } }],
      children: [],
    };
    const comp = { uuid: "comp-1", name: "Page", tplTree: divNode };
    setupSession(comp);

    await expect(
      updateProps(api, "comp-1", "Container", { foo: "bar" })
    ).rejects.toThrow('Node "Container" is a TplTag, not a TplComponent. Use update-attrs for HTML elements.');
  });

  it("handles empty props object as no-op", async () => {
    const currencyParam = mkParam("currency");
    const tplComp = mkTplComponent("PayButton", [currencyParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    const result = await updateProps(api, "comp-1", "PayButton", {});

    expect(result.updatedProps).toEqual([]);
    expect(result.removedProps).toEqual([]);
    expect(mockSetTplComponentArg).not.toHaveBeenCalled();
  });

  it("rejects scalar value for slot param", async () => {
    const slotParam = mkParam("children", { isSlot: true });
    const tplComp = mkTplComponent("Card", [slotParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    await expect(
      updateProps(api, "comp-1", "Card", { children: "some string" })
    ).rejects.toThrow('Prop "children" is a slot param. Pass a PlasmicElement object or array instead.');
  });

  it("rejects PlasmicElement for non-slot param", async () => {
    const currencyParam = mkParam("currency");
    const tplComp = mkTplComponent("PayButton", [currencyParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    await expect(
      updateProps(api, "comp-1", "PayButton", { currency: { type: "text", value: "Hello" } })
    ).rejects.toThrow('Prop "currency" is not a slot param. Pass a scalar value or expression instead.');
  });

  it("sets multiple props in a single call (merge semantics)", async () => {
    const currencyParam = mkParam("currency");
    const testModeParam = mkParam("testMode", { type: "boolean" });
    const tplComp = mkTplComponent("PayButton", [currencyParam, testModeParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      if (!tpl.vsettings[0].args) tpl.vsettings[0].args = [];
      return tpl.vsettings[0];
    });

    const result = await updateProps(api, "comp-1", "PayButton", {
      currency: "EUR",
      testMode: false,
    });

    expect(result.updatedProps).toEqual(["currency", "testMode"]);
    expect(mockSetTplComponentArg).toHaveBeenCalledTimes(2);
  });

  it("fails fast on first invalid prop before any mutations", async () => {
    const currencyParam = mkParam("currency");
    const tplComp = mkTplComponent("PayButton", [currencyParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    await expect(
      updateProps(api, "comp-1", "PayButton", { currency: "USD", badProp: "value" })
    ).rejects.toThrow('Prop "badProp" does not exist');

    // setTplComponentArg should NOT have been called (fail-fast before mutation)
    expect(mockSetTplComponentArg).not.toHaveBeenCalled();
  });

  it("supports variant targeting", async () => {
    const currencyParam = mkParam("currency");
    const tplComp = mkTplComponent("PayButton", [currencyParam]);
    const mobileVariant = { uuid: "v-mobile", name: "Mobile", mediaQuery: "(max-width: 768px)" };
    const comp = {
      uuid: "comp-1", name: "Page", tplTree: tplComp,
    };

    const mobileVs = { variants: [mobileVariant], args: [], rs: { values: {} } };
    mockEnsureVariantSetting.mockReturnValue(mobileVs);

    // Variant must be discoverable via site.globalVariantGroups or comp.variantGroups
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
    } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateProps(api, "comp-1", "PayButton", { currency: "GBP" }, "Mobile");

    expect(result.updatedProps).toEqual(["currency"]);
    expect(mockSetTplComponentArg).toHaveBeenCalledOnce();
    // Should have targeted the variant's VS, not the base
    expect(mockSetTplComponentArg.mock.calls[0][1]).toBe(mobileVs);
  });

  // --- updateProps expression safety ---

  it("rejects invalid JS expression with $ prefix on prop", async () => {
    const orderIdParam = mkParam("orderId");
    const tplComp = mkTplComponent("PayButton", [orderIdParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      if (!tpl.vsettings[0].args) tpl.vsettings[0].args = [];
      return tpl.vsettings[0];
    });

    await expect(
      updateProps(api, "comp-1", "PayButton", { orderId: "$ctx.params.orderId +" })
    ).rejects.toThrow(/Invalid JS expression/);
  });

  it("rejects invalid JS expression with {{}} wrapper on prop", async () => {
    const amountParam = mkParam("amount");
    const tplComp = mkTplComponent("PayButton", [amountParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      if (!tpl.vsettings[0].args) tpl.vsettings[0].args = [];
      return tpl.vsettings[0];
    });

    await expect(
      updateProps(api, "comp-1", "PayButton", { amount: "{{queries.cart +}}" })
    ).rejects.toThrow(/Invalid JS expression/);
  });

  it("returns warnings for prop value that looks like a dynamic expression", async () => {
    const labelParam = mkParam("label");
    const tplComp = mkTplComponent("PayButton", [labelParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      if (!tpl.vsettings[0].args) tpl.vsettings[0].args = [];
      return tpl.vsettings[0];
    });

    const result = await updateProps(api, "comp-1", "PayButton", {
      label: "Pay with $props.currency",
    });

    expect(result.updatedProps).toEqual(["label"]);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBe(1);
    expect(result.warnings![0]).toContain("static string literal");
  });

  it("does not warn for plain static prop values", async () => {
    const currencyParam = mkParam("currency");
    const tplComp = mkTplComponent("PayButton", [currencyParam]);
    const comp = { uuid: "comp-1", name: "Page", tplTree: tplComp };
    setupSession(comp);

    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
      if (!tpl.vsettings[0].args) tpl.vsettings[0].args = [];
      return tpl.vsettings[0];
    });

    const result = await updateProps(api, "comp-1", "PayButton", { currency: "USD" });

    expect(result.updatedProps).toEqual(["currency"]);
    expect(result.warnings).toBeUndefined();
  });
});
