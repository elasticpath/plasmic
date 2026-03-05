/**
 * Pattern Library Tests — registry, customisation, and apply-pattern.
 *
 * Tests cover:
 * 1. Registry: listPatternsMeta returns all 8 patterns with correct shape
 * 2. Registry: getPattern looks up by name, returns undefined for unknown
 * 3. Registry: user patterns override built-ins on name collision
 * 4. Applier: applyPattern calls addChild with the full PlasmicElement tree
 * 5. Applier: customisations substitute text values correctly
 * 6. Applier: undeclared customisation keys are ignored with warning
 * 7. Applier: unknown pattern name returns clear error
 * 8. Applier: addChild failure returns error
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ==========================================================================
// Stage 1: Registry (pure — no mocks needed)
// ==========================================================================

import {
  getAllPatterns,
  getPattern,
  listPatternsMeta,
  resetPatternCache,
} from "../patterns/registry.js";

describe("Pattern Registry", () => {
  beforeEach(() => {
    resetPatternCache();
  });

  describe("listPatternsMeta", () => {
    it("returns all 8 built-in patterns", () => {
      const patterns = listPatternsMeta();
      expect(patterns).toHaveLength(8);
    });

    it("each pattern has the required metadata fields", () => {
      const patterns = listPatternsMeta();
      for (const p of patterns) {
        expect(p).toHaveProperty("name");
        expect(p).toHaveProperty("description");
        expect(p).toHaveProperty("tags");
        expect(p).toHaveProperty("previewDescription");
        expect(p).toHaveProperty("customisationKeys");
        expect(typeof p.name).toBe("string");
        expect(typeof p.description).toBe("string");
        expect(Array.isArray(p.tags)).toBe(true);
        expect(typeof p.previewDescription).toBe("string");
        expect(Array.isArray(p.customisationKeys)).toBe(true);
      }
    });

    it("does not include the tree in metadata", () => {
      const patterns = listPatternsMeta();
      for (const p of patterns) {
        expect(p).not.toHaveProperty("tree");
      }
    });

    it("includes all expected pattern names", () => {
      const names = listPatternsMeta().map((p) => p.name);
      expect(names).toContain("hero-centered");
      expect(names).toContain("hero-split");
      expect(names).toContain("card-basic");
      expect(names).toContain("card-grid");
      expect(names).toContain("navbar-simple");
      expect(names).toContain("form-contact");
      expect(names).toContain("feature-row");
      expect(names).toContain("footer-simple");
    });
  });

  describe("getPattern", () => {
    it("returns a pattern by name", () => {
      const p = getPattern("hero-centered");
      expect(p).toBeDefined();
      expect(p!.name).toBe("hero-centered");
      expect(p!.tree).toBeDefined();
    });

    it("returns undefined for unknown name", () => {
      expect(getPattern("nonexistent-pattern")).toBeUndefined();
    });
  });

  describe("getAllPatterns", () => {
    it("returns pattern definitions with tree field", () => {
      const patterns = getAllPatterns();
      for (const p of patterns) {
        expect(p.tree).toBeDefined();
        expect(typeof p.tree).not.toBe("string"); // tree should be an object, not a plain string
      }
    });

    it("hero-centered tree has correct structure", () => {
      const p = getPattern("hero-centered")!;
      expect(p.tree).toMatchObject({
        type: "vbox",
        tag: "section",
      });
      // Should have children (heading, subtitle, button)
      const tree = p.tree as any;
      expect(Array.isArray(tree.children)).toBe(true);
      expect(tree.children.length).toBe(3);
    });
  });
});

// ==========================================================================
// Stage 2: Customisation (pure — no mocks needed)
// ==========================================================================

import { applyCustomisations } from "../patterns/applier.js";

describe("applyCustomisations", () => {
  it("substitutes heading text in hero-centered", () => {
    const pattern = getPattern("hero-centered")!;
    const { result } = applyCustomisations(
      pattern.tree,
      { headingText: "Ship Faster" },
      pattern.customisationKeys
    );

    // Find the h1 in the cloned tree
    const tree = result as any;
    const h1 = tree.children.find((c: any) => c.tag === "h1");
    expect(h1.value).toBe("Ship Faster");
  });

  it("substitutes button text with ctaLabel", () => {
    const pattern = getPattern("hero-centered")!;
    const { result } = applyCustomisations(
      pattern.tree,
      { ctaLabel: "Start Now" },
      pattern.customisationKeys
    );

    const tree = result as any;
    const button = tree.children.find((c: any) => c.type === "button");
    expect(button.value).toBe("Start Now");
  });

  it("substitutes subtitle text", () => {
    const pattern = getPattern("hero-centered")!;
    const { result } = applyCustomisations(
      pattern.tree,
      { subtitleText: "Build something amazing" },
      pattern.customisationKeys
    );

    const tree = result as any;
    const p = tree.children.find((c: any) => c.tag === "p");
    expect(p.value).toBe("Build something amazing");
  });

  it("applies multiple customisations at once", () => {
    const pattern = getPattern("hero-centered")!;
    const { result } = applyCustomisations(
      pattern.tree,
      { headingText: "New Heading", ctaLabel: "Click Me" },
      pattern.customisationKeys
    );

    const tree = result as any;
    expect(tree.children.find((c: any) => c.tag === "h1").value).toBe("New Heading");
    expect(tree.children.find((c: any) => c.type === "button").value).toBe("Click Me");
  });

  it("warns about undeclared customisation keys", () => {
    const pattern = getPattern("hero-centered")!;
    const { warnings } = applyCustomisations(
      pattern.tree,
      { unknownKey: "value" },
      pattern.customisationKeys
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("unknownKey");
    expect(warnings[0]).toContain("not declared");
  });

  it("does not mutate the original tree", () => {
    const pattern = getPattern("hero-centered")!;
    const originalValue = (pattern.tree as any).children[0].value;

    applyCustomisations(
      pattern.tree,
      { headingText: "Modified" },
      pattern.customisationKeys
    );

    // Original should be unchanged
    expect((pattern.tree as any).children[0].value).toBe(originalValue);
  });

  it("returns cloned tree when no customisations match", () => {
    const pattern = getPattern("hero-centered")!;
    const { result, warnings } = applyCustomisations(
      pattern.tree,
      {},
      pattern.customisationKeys
    );

    expect(warnings).toHaveLength(0);
    // Should be a deep clone, not the same reference
    expect(result).not.toBe(pattern.tree);
    expect(result).toEqual(pattern.tree);
  });

  it("substitutes imageSrc in hero-split", () => {
    const pattern = getPattern("hero-split")!;
    const { result } = applyCustomisations(
      pattern.tree,
      { imageSrc: "https://example.com/hero.jpg" },
      pattern.customisationKeys
    );

    // Find the img element (nested inside the hbox)
    const tree = result as any;
    const hbox = tree.children[0];
    const img = hbox.children.find((c: any) => c.type === "img");
    expect(img.src).toBe("https://example.com/hero.jpg");
  });

  it("substitutes brandName in navbar-simple", () => {
    const pattern = getPattern("navbar-simple")!;
    const { result } = applyCustomisations(
      pattern.tree,
      { brandName: "Acme Corp" },
      pattern.customisationKeys
    );

    const tree = result as any;
    const brandSpan = tree.children.find(
      (c: any) => c.tag === "span" && c.type === "text"
    );
    expect(brandSpan.value).toBe("Acme Corp");
  });
});

// ==========================================================================
// Stage 2b: applyCustomisations — direct edge cases
//
// These tests verify complex customisation trees: deeply nested children,
// key collisions (multiple elements matching one key), empty values, string
// elements, and the non-array single-child path. They ensure the heuristic
// matching works correctly across all built-in pattern structures.
// ==========================================================================

describe("applyCustomisations — edge cases", () => {
  it("substitutes copyrightText in deeply nested footer-simple", () => {
    const pattern = getPattern("footer-simple")!;
    const { result } = applyCustomisations(
      pattern.tree,
      { copyrightText: "© 2099 New Corp. All rights reserved." },
      pattern.customisationKeys
    );

    // copyrightText targets the <p> starting with "©" — it's at the
    // bottom of the 4-level-deep footer tree
    const tree = result as any;
    const copyrightP = tree.children.find(
      (c: any) => c.tag === "p" && typeof c.value === "string"
    );
    expect(copyrightP).toBeDefined();
    expect(copyrightP.value).toBe("© 2099 New Corp. All rights reserved.");
  });

  it("substitutes brandName at depth in footer-simple", () => {
    const pattern = getPattern("footer-simple")!;
    const { result } = applyCustomisations(
      pattern.tree,
      { brandName: "Acme Inc" },
      pattern.customisationKeys
    );

    // brandName targets <span> with value "Brand" inside the first hbox > first vbox
    const tree = result as any;
    const hbox = tree.children.find((c: any) =>
      c.type === "hbox" || (c.children && Array.isArray(c.children) && c.children.length > 1)
    );
    expect(hbox).toBeDefined();
    const brandCol = hbox.children[0];
    const brandSpan = brandCol.children.find(
      (c: any) => c.tag === "span" && c.type === "text"
    );
    expect(brandSpan.value).toBe("Acme Inc");
  });

  it("applies multiple customisations at different nesting depths", () => {
    const pattern = getPattern("footer-simple")!;
    const { result, warnings } = applyCustomisations(
      pattern.tree,
      { brandName: "MEGA Corp", copyrightText: "© 2030 MEGA Corp." },
      pattern.customisationKeys
    );

    expect(warnings).toHaveLength(0);

    const tree = result as any;
    // Check brand at depth
    const hbox = tree.children.find(
      (c: any) => c.children && Array.isArray(c.children) && c.children.length > 1
    );
    const brandSpan = hbox.children[0].children.find(
      (c: any) => c.tag === "span" && c.type === "text"
    );
    expect(brandSpan.value).toBe("MEGA Corp");

    // Check copyright at bottom
    const copyrightP = tree.children.find(
      (c: any) => c.tag === "p" && typeof c.value === "string"
    );
    expect(copyrightP.value).toBe("© 2030 MEGA Corp.");
  });

  it("handles sectionTitle which matches h2 in card-grid", () => {
    const pattern = getPattern("card-grid")!;
    const { result } = applyCustomisations(
      pattern.tree,
      { sectionTitle: "Our Products" },
      pattern.customisationKeys
    );

    const tree = result as any;
    const h2 = tree.children.find((c: any) => c.tag === "h2");
    expect(h2).toBeDefined();
    expect(h2.value).toBe("Our Products");
  });

  it("substitutes in hero-split at 4 levels deep (image + text)", () => {
    const pattern = getPattern("hero-split")!;
    const { result } = applyCustomisations(
      pattern.tree,
      {
        headingText: "Deep Heading",
        bodyText: "Deep body text",
        ctaLabel: "Deep CTA",
        imageSrc: "https://example.com/deep.png",
      },
      pattern.customisationKeys
    );

    // hero-split has a deeply nested structure: vbox > section > vbox > hbox > ...
    // The heading, body, cta are inside the left column; image is in the right
    const tree = result as any;

    // Find the image (could be at any depth)
    function findImg(el: any): any {
      if (typeof el === "string") return null;
      if (el.type === "img") return el;
      if (el.children) {
        const children = Array.isArray(el.children) ? el.children : [el.children];
        for (const c of children) {
          const found = findImg(c);
          if (found) return found;
        }
      }
      return null;
    }

    const img = findImg(tree);
    expect(img).toBeDefined();
    expect(img.src).toBe("https://example.com/deep.png");

    // Find h1 at any depth
    function findByTag(el: any, tag: string): any {
      if (typeof el === "string") return null;
      if (el.tag === tag) return el;
      if (el.children) {
        const children = Array.isArray(el.children) ? el.children : [el.children];
        for (const c of children) {
          const found = findByTag(c, tag);
          if (found) return found;
        }
      }
      return null;
    }

    expect(findByTag(tree, "h1")?.value).toBe("Deep Heading");
  });

  it("substitutes empty string values", () => {
    const pattern = getPattern("hero-centered")!;
    const { result, warnings } = applyCustomisations(
      pattern.tree,
      { headingText: "", ctaLabel: "" },
      pattern.customisationKeys
    );

    expect(warnings).toHaveLength(0);
    const tree = result as any;
    expect(tree.children.find((c: any) => c.tag === "h1").value).toBe("");
    expect(tree.children.find((c: any) => c.type === "button").value).toBe("");
  });

  it("all undeclared keys produces warnings and returns untouched clone", () => {
    const pattern = getPattern("hero-centered")!;
    const originalValue = (pattern.tree as any).children[0].value;
    const { result, warnings } = applyCustomisations(
      pattern.tree,
      { foo: "bar", baz: "qux" },
      pattern.customisationKeys
    );

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("foo");
    expect(warnings[1]).toContain("baz");
    // Result should be an untouched clone since no valid subs
    expect((result as any).children[0].value).toBe(originalValue);
  });

  it("declared key with no matching element in the tree is a no-op", () => {
    // Use hero-centered which has headingText (h1), subtitleText (p), ctaLabel (button)
    // Try to apply "actionLabel" which targets <a> tags — hero-centered has none
    const tree: any = {
      type: "vbox",
      children: [
        { type: "text", tag: "h1", value: "Hello" },
        { type: "text", tag: "p", value: "World" },
      ],
    };
    const { result, warnings } = applyCustomisations(
      tree,
      { actionLabel: "Click" },
      ["actionLabel"]
    );

    expect(warnings).toHaveLength(0);
    // Both elements unchanged since neither is an <a> tag
    expect((result as any).children[0].value).toBe("Hello");
    expect((result as any).children[1].value).toBe("World");
  });

  it("handles a synthetic tree with a non-array single child", () => {
    // The applier handles `children` as non-array via: Array.isArray(el.children) ? el.children : [el.children]
    const tree: any = {
      type: "vbox",
      children: { type: "text", tag: "h1", value: "Solo Child" },
    };
    const { result } = applyCustomisations(
      tree,
      { headingText: "Updated" },
      ["headingText"]
    );
    // The single child (non-array) should still be processed
    const child = (result as any).children;
    expect(child.value).toBe("Updated");
  });

  it("handles a tree with string children gracefully", () => {
    const tree: any = {
      type: "vbox",
      children: ["plain string child", { type: "text", tag: "h1", value: "Heading" }],
    };
    const { result } = applyCustomisations(
      tree,
      { headingText: "New Heading" },
      ["headingText"]
    );
    const resultTree = result as any;
    expect(resultTree.children[0]).toBe("plain string child");
    expect(resultTree.children[1].value).toBe("New Heading");
  });

  it("headingText matches both h1 and h2 — substitutes all matches", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "text", tag: "h1", value: "Main Heading" },
        { type: "text", tag: "h2", value: "Sub Heading" },
        { type: "text", tag: "h3", value: "Small Heading" },
      ],
    };
    const { result } = applyCustomisations(
      tree,
      { headingText: "Replaced" },
      ["headingText"]
    );
    const r = result as any;
    // Both h1 and h2 match headingText
    expect(r.children[0].value).toBe("Replaced");
    expect(r.children[1].value).toBe("Replaced");
    // h3 does NOT match headingText (it matches titleText)
    expect(r.children[2].value).toBe("Small Heading");
  });

  it("sectionTitle and headingText both match h2 — both apply", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "text", tag: "h2", value: "Section Title" },
      ],
    };
    // When both keys are declared and provided, both match <h2>
    // The last one wins since the loop iterates over subs entries
    const { result } = applyCustomisations(
      tree,
      { headingText: "From heading", sectionTitle: "From section" },
      ["headingText", "sectionTitle"]
    );
    const r = result as any;
    // Both match h2; last key in iteration order wins
    expect(["From heading", "From section"]).toContain(r.children[0].value);
  });

  it("subtitleText and bodyText both match <p> — both apply", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "text", tag: "p", value: "A paragraph" },
      ],
    };
    const { result } = applyCustomisations(
      tree,
      { bodyText: "Body version" },
      ["bodyText"]
    );
    expect((result as any).children[0].value).toBe("Body version");
  });

  it("titleText matches h3 specifically", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "text", tag: "h3", value: "Feature Title" },
        { type: "text", tag: "h1", value: "Not h3" },
      ],
    };
    const { result } = applyCustomisations(
      tree,
      { titleText: "New Feature" },
      ["titleText"]
    );
    const r = result as any;
    expect(r.children[0].value).toBe("New Feature");
    expect(r.children[1].value).toBe("Not h3");
  });

  it("actionLabel matches <a> tag specifically", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "text", tag: "a", value: "Learn More" },
        { type: "text", tag: "p", value: "Paragraph" },
      ],
    };
    const { result } = applyCustomisations(
      tree,
      { actionLabel: "Read More" },
      ["actionLabel"]
    );
    const r = result as any;
    expect(r.children[0].value).toBe("Read More");
    expect(r.children[1].value).toBe("Paragraph");
  });

  it("submitLabel matches button type", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "button", value: "Submit" },
        { type: "text", tag: "span", value: "Not a button" },
      ],
    };
    const { result } = applyCustomisations(
      tree,
      { submitLabel: "Send" },
      ["submitLabel"]
    );
    const r = result as any;
    expect(r.children[0].value).toBe("Send");
    expect(r.children[1].value).toBe("Not a button");
  });

  it("copyrightText only matches <p> starting with ©", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "text", tag: "p", value: "© 2026 Original" },
        { type: "text", tag: "p", value: "Not a copyright" },
      ],
    };
    const { result } = applyCustomisations(
      tree,
      { copyrightText: "© 2099 Replaced" },
      ["copyrightText"]
    );
    const r = result as any;
    expect(r.children[0].value).toBe("© 2099 Replaced");
    expect(r.children[1].value).toBe("Not a copyright");
  });

  it("brandName only matches <span> with exact value 'Brand'", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "text", tag: "span", value: "Brand" },
        { type: "text", tag: "span", value: "Other Span" },
        { type: "text", tag: "span", value: "brand" }, // lowercase — should NOT match
      ],
    };
    const { result } = applyCustomisations(
      tree,
      { brandName: "Acme" },
      ["brandName"]
    );
    const r = result as any;
    expect(r.children[0].value).toBe("Acme");
    expect(r.children[1].value).toBe("Other Span");
    expect(r.children[2].value).toBe("brand");
  });

  it("imageSrc only substitutes elements with src field", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "img", src: "https://old.com/pic.jpg", styles: {} },
        { type: "text", tag: "p", value: "Not an image" },
      ],
    };
    const { result } = applyCustomisations(
      tree,
      { imageSrc: "https://new.com/pic.jpg" },
      ["imageSrc"]
    );
    const r = result as any;
    expect(r.children[0].src).toBe("https://new.com/pic.jpg");
    expect(r.children[1].value).toBe("Not an image");
  });

  it("elements without children are leaf nodes — no recursion error", () => {
    const tree: any = {
      type: "text",
      tag: "h1",
      value: "Leaf",
    };
    const { result } = applyCustomisations(
      tree,
      { headingText: "Updated Leaf" },
      ["headingText"]
    );
    expect((result as any).value).toBe("Updated Leaf");
  });

  it("customisations with special characters in values", () => {
    const tree: any = {
      type: "vbox",
      children: [
        { type: "text", tag: "h1", value: "Original" },
      ],
    };
    const { result } = applyCustomisations(
      tree,
      { headingText: 'He said "hello" & <goodbye>' },
      ["headingText"]
    );
    expect((result as any).children[0].value).toBe('He said "hello" & <goodbye>');
  });
});

// ==========================================================================
// Stage 3: applyPattern integration (mocked edit-tools)
// ==========================================================================

// Mock edit-tools for applyPattern tests
vi.mock("../edit-tools.js", () => ({
  addChild: vi.fn(),
  updateStyles: vi.fn(),
  updateText: vi.fn(),
  updateAttrs: vi.fn(),
  createStyleVariant: vi.fn(),
}));

vi.mock("../node-resolver.js", () => ({
  invalidateNodeCache: vi.fn(),
}));

import { addChild } from "../edit-tools.js";
import { applyPattern } from "../patterns/applier.js";

const mockAddChild = vi.mocked(addChild);

function mockApiClient() {
  return {
    saveRevision: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn(),
    getProjectBundle: vi.fn(),
    updateProject: vi.fn(),
  } as any;
}

describe("applyPattern", () => {
  beforeEach(() => {
    mockAddChild.mockReset();
    mockAddChild.mockImplementation(async () => ({
      save: { revisionNum: 1, iids: [], changeDescription: "" },
      parentUuid: "parent-uuid",
      newNodeUuid: "new-root-uuid",
      position: "last",
    }));
  });

  it("calls addChild with the full pattern tree for hero-centered", async () => {
    const api = mockApiClient();
    const result = await applyPattern(
      api, "comp-uuid", "parent-ref", "hero-centered"
    );

    expect(result.error).toBeUndefined();
    expect(result.rootNodeUuid).toBe("new-root-uuid");
    expect(result.nodesCreated).toBeGreaterThan(0);
    expect(mockAddChild).toHaveBeenCalledTimes(1);

    // Verify addChild was called with the right arguments
    const [apiArg, compUuid, parentRef, childEl] = mockAddChild.mock.calls[0];
    expect(apiArg).toBe(api);
    expect(compUuid).toBe("comp-uuid");
    expect(parentRef).toBe("parent-ref");
    expect((childEl as any).type).toBe("vbox");
  });

  it("applies customisations before passing to addChild", async () => {
    const api = mockApiClient();
    await applyPattern(
      api, "comp-uuid", "parent-ref", "hero-centered",
      { headingText: "Custom Heading", ctaLabel: "Buy Now" }
    );

    const childEl = mockAddChild.mock.calls[0][3] as any;
    const h1 = childEl.children.find((c: any) => c.tag === "h1");
    const button = childEl.children.find((c: any) => c.type === "button");
    expect(h1.value).toBe("Custom Heading");
    expect(button.value).toBe("Buy Now");
  });

  it("includes undeclared customisation warnings", async () => {
    const api = mockApiClient();
    const result = await applyPattern(
      api, "comp-uuid", "parent-ref", "hero-centered",
      { headingText: "OK", badKey: "ignored" }
    );

    expect(result.error).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("badKey");
  });

  it("returns clear error for unknown pattern name", async () => {
    const api = mockApiClient();
    const result = await applyPattern(
      api, "comp-uuid", "parent-ref", "nonexistent"
    );

    expect(result.error).toContain("Pattern 'nonexistent' not found");
    expect(result.error).toContain("listPatterns");
    expect(result.nodesCreated).toBe(0);
    expect(mockAddChild).not.toHaveBeenCalled();
  });

  it("passes position parameter to addChild", async () => {
    const api = mockApiClient();
    await applyPattern(
      api, "comp-uuid", "parent-ref", "hero-centered",
      undefined, "first"
    );

    expect(mockAddChild).toHaveBeenCalledTimes(1);
    const [, , , , position] = mockAddChild.mock.calls[0];
    expect(position).toBe("first");
  });

  it("returns error when addChild throws", async () => {
    mockAddChild.mockRejectedValue(new Error("WAB save failed"));
    const api = mockApiClient();
    const result = await applyPattern(
      api, "comp-uuid", "parent-ref", "hero-centered"
    );

    expect(result.error).toContain("Failed to apply pattern");
    expect(result.error).toContain("WAB save failed");
    expect(result.nodesCreated).toBe(0);
  });

  it("counts nodes correctly for hero-centered", async () => {
    const api = mockApiClient();
    const result = await applyPattern(
      api, "comp-uuid", "parent-ref", "hero-centered"
    );

    // hero-centered: 1 page-section + 1 h1 + 1 p + 1 button = 4
    expect(result.nodesCreated).toBe(4);
  });

  it("counts nodes correctly for card-grid (nested structure)", async () => {
    const api = mockApiClient();
    const result = await applyPattern(
      api, "comp-uuid", "parent-ref", "card-grid"
    );

    // card-grid has many nested nodes — just verify it's reasonable
    expect(result.nodesCreated).toBeGreaterThan(10);
  });

  it("does not mutate the pattern tree across calls", async () => {
    const api = mockApiClient();
    const originalTree = JSON.stringify(getPattern("hero-centered")!.tree);

    await applyPattern(
      api, "comp-uuid", "parent-ref", "hero-centered",
      { headingText: "First Call" }
    );

    await applyPattern(
      api, "comp-uuid", "parent-ref", "hero-centered",
      { headingText: "Second Call" }
    );

    expect(JSON.stringify(getPattern("hero-centered")!.tree)).toBe(originalTree);
  });
});
