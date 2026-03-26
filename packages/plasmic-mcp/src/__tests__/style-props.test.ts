/**
 * Characterization tests for CSS style property validation and sanitization.
 *
 * These tests pin the current behavior of:
 *   - getValidStylePropertyNames() — the full set of accepted properties
 *   - isValidStyleProp() — property validation including custom/vendor props
 *   - sanitizeStyles() — shorthand expansion
 *   - validateStyleProperties() — error messages with suggestions
 *
 * Written BEFORE the shared style-props refactor so regressions are caught.
 */

import { describe, it, expect } from "vitest";
import {
  isValidStyleProp,
  sanitizeStyles,
  validateStyleProperties,
  getValidStylePropertyNames,
} from "../edit-tools";

// ---------------------------------------------------------------------------
// getValidStylePropertyNames — snapshot the full valid set
// ---------------------------------------------------------------------------
describe("getValidStylePropertyNames", () => {
  it("returns a sorted array of kebab-case property names", () => {
    const props = getValidStylePropertyNames();
    expect(props.length).toBeGreaterThan(100);
    // Sorted
    const sorted = [...props].sort();
    expect(props).toEqual(sorted);
    // All kebab-case (no camelCase except single-word)
    for (const p of props) {
      expect(p).not.toMatch(/[A-Z]/);
    }
  });

  it("includes core CSS properties from css-initials", () => {
    const props = new Set(getValidStylePropertyNames());
    // Box model
    expect(props.has("width")).toBe(true);
    expect(props.has("height")).toBe(true);
    expect(props.has("padding-top")).toBe(true);
    expect(props.has("margin-left")).toBe(true);
    // Typography
    expect(props.has("font-size")).toBe(true);
    expect(props.has("font-weight")).toBe(true);
    expect(props.has("color")).toBe(true);
    expect(props.has("line-height")).toBe(true);
    // Flex
    expect(props.has("display")).toBe(true);
    expect(props.has("flex-direction")).toBe(true);
    expect(props.has("align-items")).toBe(true);
    // Border
    expect(props.has("border-top-width")).toBe(true);
    expect(props.has("border-top-left-radius")).toBe(true);
    // Position
    expect(props.has("position")).toBe(true);
    expect(props.has("top")).toBe(true);
    expect(props.has("z-index")).toBe(true);
  });

  it("includes ADDITIONAL_VALID_PROPERTIES (not in css-initials)", () => {
    const props = new Set(getValidStylePropertyNames());
    // Gap
    expect(props.has("row-gap")).toBe(true);
    expect(props.has("column-gap")).toBe(true);
    // Grid
    expect(props.has("grid-template-columns")).toBe(true);
    expect(props.has("grid-template-rows")).toBe(true);
    expect(props.has("grid-template-areas")).toBe(true);
    expect(props.has("grid-column")).toBe(true);
    expect(props.has("grid-row")).toBe(true);
    expect(props.has("grid-area")).toBe(true);
    expect(props.has("grid-auto-flow")).toBe(true);
    // Modern CSS
    expect(props.has("aspect-ratio")).toBe(true);
    expect(props.has("object-fit")).toBe(true);
    expect(props.has("object-position")).toBe(true);
    expect(props.has("backdrop-filter")).toBe(true);
    expect(props.has("clip-path")).toBe(true);
    expect(props.has("filter")).toBe(true);
    expect(props.has("isolation")).toBe(true);
    expect(props.has("mix-blend-mode")).toBe(true);
    // Scroll
    expect(props.has("scroll-snap-type")).toBe(true);
    expect(props.has("scroll-snap-align")).toBe(true);
    // Text decoration
    expect(props.has("text-decoration-line")).toBe(true);
    expect(props.has("text-decoration-style")).toBe(true);
    expect(props.has("text-decoration-color")).toBe(true);
    // Transition longhands
    expect(props.has("transition-property")).toBe(true);
    expect(props.has("transition-duration")).toBe(true);
    expect(props.has("transition-timing-function")).toBe(true);
    expect(props.has("transition-delay")).toBe(true);
    // Outline longhands
    expect(props.has("outline-width")).toBe(true);
    expect(props.has("outline-style")).toBe(true);
    expect(props.has("outline-color")).toBe(true);
    expect(props.has("outline-offset")).toBe(true);
    // Shorthands (present for "did you mean?" suggestions)
    expect(props.has("padding")).toBe(true);
    expect(props.has("margin")).toBe(true);
    expect(props.has("border")).toBe(true);
    expect(props.has("border-radius")).toBe(true);
    expect(props.has("gap")).toBe(true);
    expect(props.has("inset")).toBe(true);
    expect(props.has("flex")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidStyleProp
// ---------------------------------------------------------------------------
describe("isValidStyleProp", () => {
  it("accepts kebab-case properties", () => {
    expect(isValidStyleProp("font-size")).toBe(true);
    expect(isValidStyleProp("padding-top")).toBe(true);
    expect(isValidStyleProp("row-gap")).toBe(true);
  });

  it("accepts camelCase properties by converting to kebab", () => {
    expect(isValidStyleProp("fontSize")).toBe(true);
    expect(isValidStyleProp("paddingTop")).toBe(true);
    expect(isValidStyleProp("borderTopLeftRadius")).toBe(true);
  });

  it("accepts CSS custom properties (--*)", () => {
    expect(isValidStyleProp("--my-color")).toBe(true);
    expect(isValidStyleProp("--theme-spacing-lg")).toBe(true);
  });

  it("accepts vendor-prefixed properties", () => {
    expect(isValidStyleProp("-webkit-transform")).toBe(true);
    expect(isValidStyleProp("-moz-appearance")).toBe(true);
    expect(isValidStyleProp("-ms-overflow-style")).toBe(true);
    expect(isValidStyleProp("-o-transition")).toBe(true);
  });

  it("rejects unknown properties", () => {
    expect(isValidStyleProp("not-a-real-prop")).toBe(false);
    expect(isValidStyleProp("fooBar")).toBe(false);
    expect(isValidStyleProp("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeStyles — shorthand expansion
// ---------------------------------------------------------------------------
describe("sanitizeStyles", () => {
  describe("padding shorthand", () => {
    it("expands single value", () => {
      expect(sanitizeStyles({ padding: "10px" })).toEqual({
        paddingTop: "10px",
        paddingRight: "10px",
        paddingBottom: "10px",
        paddingLeft: "10px",
      });
    });

    it("expands two values (vertical horizontal)", () => {
      expect(sanitizeStyles({ padding: "10px 20px" })).toEqual({
        paddingTop: "10px",
        paddingRight: "20px",
        paddingBottom: "10px",
        paddingLeft: "20px",
      });
    });

    it("expands three values (top horizontal bottom)", () => {
      expect(sanitizeStyles({ padding: "10px 20px 30px" })).toEqual({
        paddingTop: "10px",
        paddingRight: "20px",
        paddingBottom: "30px",
        paddingLeft: "20px",
      });
    });

    it("expands four values", () => {
      expect(sanitizeStyles({ padding: "10px 20px 30px 40px" })).toEqual({
        paddingTop: "10px",
        paddingRight: "20px",
        paddingBottom: "30px",
        paddingLeft: "40px",
      });
    });
  });

  describe("margin shorthand", () => {
    it("expands single value", () => {
      expect(sanitizeStyles({ margin: "8px" })).toEqual({
        marginTop: "8px",
        marginRight: "8px",
        marginBottom: "8px",
        marginLeft: "8px",
      });
    });
  });

  describe("gap shorthand", () => {
    it("expands single value to row-gap and column-gap", () => {
      expect(sanitizeStyles({ gap: "16px" })).toEqual({
        "row-gap": "16px",
        "column-gap": "16px",
      });
    });

    it("expands two values", () => {
      expect(sanitizeStyles({ gap: "16px 24px" })).toEqual({
        "row-gap": "16px",
        "column-gap": "24px",
      });
    });
  });

  describe("border-radius shorthand", () => {
    it("expands single value to four corners", () => {
      expect(sanitizeStyles({ borderRadius: "8px" })).toEqual({
        "border-top-left-radius": "8px",
        "border-top-right-radius": "8px",
        "border-bottom-right-radius": "8px",
        "border-bottom-left-radius": "8px",
      });
    });

    it("expands kebab-case input", () => {
      expect(sanitizeStyles({ "border-radius": "4px" })).toEqual({
        "border-top-left-radius": "4px",
        "border-top-right-radius": "4px",
        "border-bottom-right-radius": "4px",
        "border-bottom-left-radius": "4px",
      });
    });
  });

  describe("border-width shorthand", () => {
    it("expands to side longhands", () => {
      expect(sanitizeStyles({ borderWidth: "1px" })).toEqual({
        "border-top-width": "1px",
        "border-right-width": "1px",
        "border-bottom-width": "1px",
        "border-left-width": "1px",
      });
    });
  });

  describe("border-style shorthand", () => {
    it("expands to side longhands", () => {
      expect(sanitizeStyles({ borderStyle: "solid" })).toEqual({
        "border-top-style": "solid",
        "border-right-style": "solid",
        "border-bottom-style": "solid",
        "border-left-style": "solid",
      });
    });
  });

  describe("border-color shorthand", () => {
    it("expands to side longhands", () => {
      expect(sanitizeStyles({ borderColor: "red" })).toEqual({
        "border-top-color": "red",
        "border-right-color": "red",
        "border-bottom-color": "red",
        "border-left-color": "red",
      });
    });
  });

  describe("border combined shorthand", () => {
    it("parses width style color", () => {
      expect(sanitizeStyles({ border: "1px solid red" })).toEqual({
        "border-top-width": "1px",
        "border-top-style": "solid",
        "border-top-color": "red",
        "border-right-width": "1px",
        "border-right-style": "solid",
        "border-right-color": "red",
        "border-bottom-width": "1px",
        "border-bottom-style": "solid",
        "border-bottom-color": "red",
        "border-left-width": "1px",
        "border-left-style": "solid",
        "border-left-color": "red",
      });
    });
  });

  describe("border-top shorthand", () => {
    it("parses to top longhands only", () => {
      expect(sanitizeStyles({ borderTop: "2px dashed blue" })).toEqual({
        "border-top-width": "2px",
        "border-top-style": "dashed",
        "border-top-color": "blue",
      });
    });
  });

  describe("outline shorthand", () => {
    it("parses to outline longhands", () => {
      expect(sanitizeStyles({ outline: "2px solid green" })).toEqual({
        "outline-width": "2px",
        "outline-style": "solid",
        "outline-color": "green",
      });
    });
  });

  describe("transition shorthand", () => {
    it("parses to 4 longhands", () => {
      expect(sanitizeStyles({ transition: "all 200ms ease 0s" })).toEqual({
        "transition-property": "all",
        "transition-duration": "200ms",
        "transition-timing-function": "ease",
        "transition-delay": "0s",
      });
    });

    it("fills defaults for missing parts", () => {
      expect(sanitizeStyles({ transition: "opacity" })).toEqual({
        "transition-property": "opacity",
        "transition-duration": "0s",
        "transition-timing-function": "ease",
        "transition-delay": "0s",
      });
    });
  });

  describe("inset shorthand", () => {
    it("expands to top/right/bottom/left", () => {
      expect(sanitizeStyles({ inset: "0" })).toEqual({
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
      });
    });
  });

  describe("background properties", () => {
    it("converts backgroundColor to background shorthand", () => {
      const result = sanitizeStyles({ backgroundColor: "red" });
      expect(result).toHaveProperty("background");
      expect(result.background).toContain("red");
    });

    it("preserves explicit background shorthand", () => {
      expect(sanitizeStyles({ background: "blue" })).toEqual({
        background: "blue",
      });
    });

    it("does not override explicit background with bg longhands", () => {
      const result = sanitizeStyles({
        background: "blue",
        backgroundColor: "red",
      });
      expect(result.background).toBe("blue");
    });
  });

  describe("passthrough", () => {
    it("passes through non-shorthand properties unchanged", () => {
      expect(sanitizeStyles({ fontSize: "16px", color: "red" })).toEqual({
        fontSize: "16px",
        color: "red",
      });
    });

    it("handles empty input", () => {
      expect(sanitizeStyles({})).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------
// validateStyleProperties — error messages and suggestions
// ---------------------------------------------------------------------------
describe("validateStyleProperties", () => {
  it("accepts valid properties without throwing", () => {
    expect(() =>
      validateStyleProperties({ "font-size": "16px", color: "red" })
    ).not.toThrow();
  });

  it("throws for unknown properties with 'Unknown CSS property' message", () => {
    expect(() =>
      validateStyleProperties({ "not-a-prop": "value" })
    ).toThrow(/Unknown CSS property "not-a-prop"/);
  });

  it("includes 'Did you mean' suggestions for typos", () => {
    // "fonr-size" is close to "font-size"
    expect(() =>
      validateStyleProperties({ "fonr-size": "16px" })
    ).toThrow(/Did you mean/);
  });

  it("accepts custom properties", () => {
    expect(() =>
      validateStyleProperties({ "--custom-color": "#fff" })
    ).not.toThrow();
  });

  it("accepts vendor-prefixed properties", () => {
    expect(() =>
      validateStyleProperties({ "-webkit-transform": "none" })
    ).not.toThrow();
  });
});
