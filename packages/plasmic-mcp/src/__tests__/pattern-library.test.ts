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
