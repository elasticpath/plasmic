/**
 * Unit tests for html-importer.ts — the HTML Import Bridge.
 *
 * WHY these tests matter:
 * The html-importer translates HTML/CSS (a language LLMs know well) into
 * Plasmic edit-tool calls.  Incorrect parsing or mapping would silently
 * produce broken layouts. These tests verify the full pipeline:
 *   - Stage 1: parseHtmlToTree  (pure DOM/CSS parsing — no mocks)
 *   - Stage 2: wiTreeToEditCalls (edit-tool mapping — mocked edit-tools)
 *   - Stage 3: importHtml       (end-to-end orchestration — mocked edit-tools)
 *
 * Reference: .ralph/specs/design-html-bridge.md
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseHtmlToTree, importHtml, wiTreeToEditCalls } from "../html-importer";
import type { ParsedNode, ImportHtmlResult } from "../html-importer";

// =============================================================================
// Stage 1: parseHtmlToTree — pure parsing, no mocks needed
// =============================================================================

describe("parseHtmlToTree", () => {
  describe("basic element parsing", () => {
    it("parses a simple <div> with inline styles", () => {
      const { nodes, warnings } = parseHtmlToTree(
        `<div style="display: flex; gap: 16px;"></div>`
      );

      expect(nodes).toHaveLength(1);
      const node = nodes[0];
      expect(node.kind).toBe("container");
      if (node.kind === "container") {
        expect(node.tag).toBe("div");
        expect(node.styles).toMatchObject({
          display: "flex",
          gap: "16px",
        });
        expect(node.children).toHaveLength(0);
      }
    });

    it("parses nested containers with styles", () => {
      const { nodes } = parseHtmlToTree(
        `<div style="display:flex"><section style="padding:16px"><article style="color:red">content</article></section></div>`
      );

      expect(nodes).toHaveLength(1);
      const root = nodes[0];
      expect(root.kind).toBe("container");
      if (root.kind === "container") {
        expect(root.tag).toBe("div");
        expect(root.children).toHaveLength(1);
        const section = root.children[0];
        expect(section.kind).toBe("container");
        if (section.kind === "container") {
          expect(section.tag).toBe("section");
          expect(section.children).toHaveLength(1);
          expect(section.children[0].kind).toBe("text");
        }
      }
    });

    it("filters out empty unstyled containers", () => {
      const { nodes } = parseHtmlToTree(
        `<div><section></section></div>`
      );
      // Empty containers with no styles/attrs are filtered out
      expect(nodes).toHaveLength(0);
    });

    it("parses a text element (h1 with text content)", () => {
      const { nodes } = parseHtmlToTree(`<h1>Hello World</h1>`);

      expect(nodes).toHaveLength(1);
      const node = nodes[0];
      expect(node.kind).toBe("text");
      if (node.kind === "text") {
        expect(node.tag).toBe("h1");
        expect(node.value).toBe("Hello World");
      }
    });

    it("parses a container with text child and element children", () => {
      const { nodes } = parseHtmlToTree(
        `<div><h1>Title</h1><p>Body</p></div>`
      );

      expect(nodes).toHaveLength(1);
      const root = nodes[0];
      expect(root.kind).toBe("container");
      if (root.kind === "container") {
        expect(root.children).toHaveLength(2);
        expect(root.children[0].kind).toBe("text");
        expect(root.children[1].kind).toBe("text");
      }
    });

    it("parses <img> as image node", () => {
      const { nodes } = parseHtmlToTree(
        `<img src="https://example.com/img.png" alt="test" />`
      );

      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe("image");
      if (nodes[0].kind === "image") {
        expect(nodes[0].src).toBe("https://example.com/img.png");
        expect(nodes[0].attrs).toHaveProperty("alt", "test");
      }
    });

    it("parses <button> as button node", () => {
      const { nodes } = parseHtmlToTree(`<button>Click Me</button>`);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe("button");
      if (nodes[0].kind === "button") {
        expect(nodes[0].value).toBe("Click Me");
      }
    });

    it("parses <input> as input node", () => {
      const { nodes } = parseHtmlToTree(
        `<input type="text" placeholder="Enter name" />`
      );

      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe("input");
      if (nodes[0].kind === "input") {
        expect(nodes[0].inputType).toBe("input");
        expect(nodes[0].attrs).toHaveProperty("placeholder", "Enter name");
      }
    });

    it("parses <input type='password'> as password input", () => {
      const { nodes } = parseHtmlToTree(`<input type="password" />`);

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "input") {
        expect(nodes[0].inputType).toBe("password");
      }
    });

    it("parses <textarea> as textarea input", () => {
      const { nodes } = parseHtmlToTree(`<textarea></textarea>`);

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "input") {
        expect(nodes[0].inputType).toBe("textarea");
      }
    });

    it("parses <svg> as svg node with outerHTML", () => {
      const { nodes } = parseHtmlToTree(
        `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`
      );

      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe("svg");
      if (nodes[0].kind === "svg") {
        expect(nodes[0].svgHtml).toContain("<svg");
        expect(nodes[0].svgHtml).toContain("circle");
      }
    });
  });

  describe("CSS style extraction", () => {
    it("extracts styles from <style> blocks", () => {
      const { nodes } = parseHtmlToTree(
        `<style>.hero { display: flex; gap: 48px; }</style>
         <div class="hero"></div>`
      );

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "container") {
        expect(nodes[0].styles).toMatchObject({
          display: "flex",
          gap: "48px",
        });
      }
    });

    it("merges inline styles over CSS rule styles", () => {
      const { nodes } = parseHtmlToTree(
        `<style>.box { color: red; font-size: 14px; }</style>
         <div class="box" style="color: blue;"></div>`
      );

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "container") {
        expect(nodes[0].styles.color).toBe("blue"); // inline wins
        expect(nodes[0].styles.fontSize).toBe("14px"); // from CSS rule
      }
    });

    it("converts kebab-case CSS properties to camelCase", () => {
      const { nodes } = parseHtmlToTree(
        `<div style="background-color: red; flex-direction: row; border-radius: 8px;"></div>`
      );

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "container") {
        expect(nodes[0].styles).toHaveProperty("backgroundColor", "red");
        expect(nodes[0].styles).toHaveProperty("flexDirection", "row");
        expect(nodes[0].styles).toHaveProperty("borderRadius", "8px");
      }
    });

    it("extracts pseudo-class styles as pseudoStyles", () => {
      const { nodes } = parseHtmlToTree(
        `<style>.btn { color: blue; } .btn:hover { color: red; }</style>
         <div class="btn"></div>`
      );

      expect(nodes).toHaveLength(1);
      expect(nodes[0].pseudoStyles.size).toBe(1);
      expect(nodes[0].pseudoStyles.has(":hover")).toBe(true);
      expect(nodes[0].pseudoStyles.get(":hover")).toMatchObject({
        color: "red",
      });
    });

    it("extracts multiple pseudo-class variants", () => {
      const { nodes } = parseHtmlToTree(
        `<style>
           .btn { color: blue; }
           .btn:hover { color: red; }
           .btn:focus { outline: none; }
         </style>
         <div class="btn"></div>`
      );

      expect(nodes).toHaveLength(1);
      expect(nodes[0].pseudoStyles.size).toBe(2);
      expect(nodes[0].pseudoStyles.has(":hover")).toBe(true);
      expect(nodes[0].pseudoStyles.has(":focus")).toBe(true);
    });

    it("extracts @media max-width styles as mediaStyles", () => {
      const { nodes } = parseHtmlToTree(
        `<style>
           .box { font-size: 24px; }
           @media (max-width: 768px) { .box { font-size: 16px; } }
         </style>
         <div class="box"></div>`
      );

      expect(nodes).toHaveLength(1);
      expect(nodes[0].styles.fontSize).toBe("24px");
      expect(nodes[0].mediaStyles.size).toBe(1);
      expect(nodes[0].mediaStyles.has(768)).toBe(true);
      expect(nodes[0].mediaStyles.get(768)).toMatchObject({
        fontSize: "16px",
      });
    });
  });

  describe("attribute extraction", () => {
    it("collects href, aria-*, data-* attributes", () => {
      const { nodes } = parseHtmlToTree(
        `<a href="/about" aria-label="About" data-testid="link">About</a>`
      );

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "text") {
        expect(nodes[0].attrs).toMatchObject({
          href: "/about",
          "aria-label": "About",
          "data-testid": "link",
        });
      }
    });

    it("excludes class and style attributes from attrs", () => {
      const { nodes } = parseHtmlToTree(
        `<div class="foo" style="color: red;" id="bar">text</div>`
      );

      expect(nodes).toHaveLength(1);
      expect(nodes[0].attrs).not.toHaveProperty("class");
      expect(nodes[0].attrs).not.toHaveProperty("style");
      // id is included since collectAttrs doesn't filter it
      expect(nodes[0].attrs).toHaveProperty("id", "bar");
    });
  });

  describe("ignored elements", () => {
    it("skips <script> tags", () => {
      const { nodes } = parseHtmlToTree(
        `<div><script>alert("xss")</script><p>Visible</p></div>`
      );

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "container") {
        // script is skipped, only the <p> remains
        expect(nodes[0].children).toHaveLength(1);
        expect(nodes[0].children[0].kind).toBe("text");
      }
    });

    it("skips <iframe> tags", () => {
      const { nodes } = parseHtmlToTree(
        `<div><iframe src="https://evil.com"></iframe><p>Safe</p></div>`
      );

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "container") {
        expect(nodes[0].children).toHaveLength(1);
      }
    });

    it("skips <style> tags as child elements", () => {
      const { nodes } = parseHtmlToTree(
        `<div><style>.x{color:red}</style><span>visible</span></div>`
      );

      // The <style> is extracted for CSS rules but not as a child node
      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "container") {
        expect(nodes[0].children.every((c) => c.kind !== "container" || (c as any).tag !== "style")).toBe(true);
      }
    });
  });

  describe("edge cases", () => {
    it("returns empty nodes for empty HTML", () => {
      const { nodes } = parseHtmlToTree("");
      expect(nodes).toHaveLength(0);
    });

    it("returns empty nodes for whitespace-only HTML", () => {
      const { nodes } = parseHtmlToTree("   \n\t  ");
      expect(nodes).toHaveLength(0);
    });

    it("handles malformed CSS gracefully", () => {
      const { nodes } = parseHtmlToTree(
        `<style>{{{{ invalid css }</style>
         <div style="color: blue;">text</div>`
      );

      // Should still parse the element, even if CSS is broken
      expect(nodes).toHaveLength(1);
      expect(nodes[0].styles).toHaveProperty("color", "blue");
    });

    it("handles multiple root elements", () => {
      const { nodes } = parseHtmlToTree(
        `<div>First</div><div>Second</div><div>Third</div>`
      );

      expect(nodes).toHaveLength(3);
    });

    it("handles deeply nested HTML", () => {
      const html = Array.from({ length: 10 }, (_, i) =>
        `<div class="level-${i}">`
      ).join("") + "deep" + "</div>".repeat(10);

      const { nodes } = parseHtmlToTree(html);
      expect(nodes).toHaveLength(1);

      // Walk to the deepest node
      let current = nodes[0];
      let depth = 0;
      while (current.kind === "container" && current.children.length > 0) {
        current = current.children[0];
        depth++;
      }
      // The innermost node should be a text node with "deep"
      expect(current.kind).toBe("text");
      if (current.kind === "text") {
        expect(current.value).toBe("deep");
      }
    });
  });

  describe("component detection via data-component", () => {
    it("parses element with data-component as component node when name matches", () => {
      const { nodes, warnings } = parseHtmlToTree(
        `<div data-component="HeroSection" style="padding: 32px;"></div>`,
        ["HeroSection", "Card", "Footer"]
      );

      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe("component");
      if (nodes[0].kind === "component") {
        expect(nodes[0].componentName).toBe("HeroSection");
        expect(nodes[0].styles).toMatchObject({ padding: "32px" });
      }
      expect(warnings).toHaveLength(0);
    });

    it("matches component names case-insensitively", () => {
      const { nodes } = parseHtmlToTree(
        `<div data-component="herosection"></div>`,
        ["HeroSection"]
      );

      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe("component");
      if (nodes[0].kind === "component") {
        // Should use the canonical name, not the lowercased input
        expect(nodes[0].componentName).toBe("HeroSection");
      }
    });

    it("falls through to container when component name is not found", () => {
      const { nodes, warnings } = parseHtmlToTree(
        `<div data-component="NonExistent" style="color: red;">text</div>`,
        ["HeroSection", "Card"]
      );

      expect(nodes).toHaveLength(1);
      // Should fall through to text (since "text" is the only content)
      expect(nodes[0].kind).toBe("text");
      expect(warnings.some((w) => w.includes("NonExistent"))).toBe(true);
      expect(warnings.some((w) => w.includes("does not match"))).toBe(true);
    });

    it("removes data-component from attrs on matched component", () => {
      const { nodes } = parseHtmlToTree(
        `<div data-component="Card" id="my-card"></div>`,
        ["Card"]
      );

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "component") {
        expect(nodes[0].attrs).not.toHaveProperty("data-component");
        expect(nodes[0].attrs).toHaveProperty("id", "my-card");
      }
    });

    it("parses children of component elements", () => {
      const { nodes } = parseHtmlToTree(
        `<div data-component="Card"><h1>Title</h1><p>Body</p></div>`,
        ["Card"]
      );

      expect(nodes).toHaveLength(1);
      if (nodes[0].kind === "component") {
        expect(nodes[0].children).toHaveLength(2);
        expect(nodes[0].children[0].kind).toBe("text");
        expect(nodes[0].children[1].kind).toBe("text");
      }
    });

    it("treats element as container when no componentNames provided", () => {
      const { nodes } = parseHtmlToTree(
        `<div data-component="Card" style="padding: 8px;">text</div>`
      );

      // Without componentNames, data-component is just a regular attribute
      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe("text");
    });
  });

  describe("happy path: two-column hero section", () => {
    it("parses the spec example correctly", () => {
      const html = `
        <style>
          .hero { display: flex; gap: 48px; padding: 64px; }
          .hero-text { flex: 1; }
          .hero-text h1 { font-size: 48px; font-weight: 700; color: #1a1a1a; }
          .hero-img { width: 480px; height: 320px; background: #e5e7eb; border-radius: 12px; }
        </style>
        <div class="hero">
          <div class="hero-text"><h1>Ship faster with Plasmic</h1></div>
          <div class="hero-img"></div>
        </div>
      `;

      const { nodes } = parseHtmlToTree(html);
      expect(nodes).toHaveLength(1);

      const hero = nodes[0];
      expect(hero.kind).toBe("container");
      if (hero.kind === "container") {
        expect(hero.styles).toMatchObject({
          display: "flex",
          gap: "48px",
          padding: "64px",
        });
        expect(hero.children).toHaveLength(2);

        // hero-text child
        const heroText = hero.children[0];
        expect(heroText.kind).toBe("container");
        if (heroText.kind === "container") {
          expect(heroText.styles).toHaveProperty("flex", "1");
          expect(heroText.children).toHaveLength(1);

          // h1 inside hero-text
          const h1 = heroText.children[0];
          expect(h1.kind).toBe("text");
          if (h1.kind === "text") {
            expect(h1.value).toBe("Ship faster with Plasmic");
            expect(h1.styles).toMatchObject({
              fontSize: "48px",
              fontWeight: "700",
              color: "#1a1a1a",
            });
          }
        }

        // hero-img child
        const heroImg = hero.children[1];
        expect(heroImg.kind).toBe("container");
        if (heroImg.kind === "container") {
          expect(heroImg.styles).toMatchObject({
            width: "480px",
            height: "320px",
            borderRadius: "12px",
          });
        }
      }
    });
  });
});

// =============================================================================
// Stage 2 & 3: wiTreeToEditCalls + importHtml — mocked edit-tools
// =============================================================================

// Mock the edit-tool functions. These are the MCP primitives that actually
// mutate the Plasmic model — we verify they're called correctly.
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

import {
  addChild,
  updateStyles,
  updateText,
  updateAttrs,
  createStyleVariant,
} from "../edit-tools.js";
import { invalidateNodeCache } from "../node-resolver.js";

const mockAddChild = vi.mocked(addChild);
const mockUpdateStyles = vi.mocked(updateStyles);
const mockUpdateText = vi.mocked(updateText);
const mockUpdateAttrs = vi.mocked(updateAttrs);
const mockCreateStyleVariant = vi.mocked(createStyleVariant);
const mockInvalidateNodeCache = vi.mocked(invalidateNodeCache);

function mockApiClient() {
  return {
    saveRevision: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn(),
    getProjectBundle: vi.fn(),
    updateProject: vi.fn(),
  } as any;
}

let nodeIdCounter = 0;

function setupMocks() {
  nodeIdCounter = 0;
  mockAddChild.mockReset();
  mockUpdateStyles.mockReset();
  mockUpdateText.mockReset();
  mockUpdateAttrs.mockReset();
  mockCreateStyleVariant.mockReset();
  mockInvalidateNodeCache.mockReset();

  mockAddChild.mockImplementation(async () => ({
    save: { revisionNum: 1, iids: [], changeDescription: "" },
    parentUuid: "parent-uuid",
    newNodeUuid: `node-${++nodeIdCounter}`,
    position: "last",
  }));

  mockUpdateStyles.mockImplementation(async () => ({
    save: { revisionNum: 1, iids: [], changeDescription: "" },
    nodeUuid: "node-uuid",
    updatedProperties: [],
  }));

  mockUpdateText.mockImplementation(async () => ({
    save: { revisionNum: 1, iids: [], changeDescription: "" },
    nodeUuid: "node-uuid",
    newText: "",
  }));

  mockUpdateAttrs.mockImplementation(async () => ({
    save: { revisionNum: 1, iids: [], changeDescription: "" },
    nodeUuid: "node-uuid",
    updatedAttributes: [],
    removedAttributes: [],
  }));

  mockCreateStyleVariant.mockImplementation(async () => ({
    save: { revisionNum: 1, iids: [], changeDescription: "" },
    variantUuid: "variant-uuid",
    selector: ":hover",
    scope: "element" as const,
  }));
}

describe("importHtml", () => {
  const api = mockApiClient();
  const compUuid = "comp-123";
  const parentRef = "root";

  beforeEach(() => {
    setupMocks();
  });

  describe("error handling", () => {
    it("returns error for empty HTML", async () => {
      const result = await importHtml(api, compUuid, parentRef, "");
      expect(result.error).toContain("empty");
      expect(result.nodesCreated).toBe(0);
      expect(mockAddChild).not.toHaveBeenCalled();
    });

    it("returns error for whitespace-only HTML", async () => {
      const result = await importHtml(api, compUuid, parentRef, "   \n  ");
      expect(result.error).toContain("empty");
      expect(result.nodesCreated).toBe(0);
    });

    it("returns error when no importable elements found", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        "<script>alert(1)</script>"
      );
      expect(result.error).toContain("No importable elements");
      expect(result.nodesCreated).toBe(0);
    });
  });

  describe("simple element import", () => {
    it("imports a simple <div> with inline styles", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<div style="display: flex; gap: 16px;"></div>`
      );

      expect(result.error).toBeUndefined();
      expect(result.nodesCreated).toBe(1);
      expect(result.rootNodeUuid).toBe("node-1");

      // addChild should have been called with box type
      expect(mockAddChild).toHaveBeenCalledTimes(1);
      expect(mockAddChild).toHaveBeenCalledWith(
        api,
        compUuid,
        parentRef,
        expect.objectContaining({
          type: "box",
          tag: "div",
        }),
        undefined
      );

      // updateStyles should have been called with the inline styles
      expect(mockUpdateStyles).toHaveBeenCalledWith(
        api,
        compUuid,
        "node-1",
        expect.objectContaining({
          display: "flex",
          gap: "16px",
        })
      );
    });

    it("imports nested elements recursively", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<div><h1>Hello</h1></div>`
      );

      expect(result.error).toBeUndefined();
      expect(result.nodesCreated).toBe(2);

      // First addChild = outer div, second = h1 text
      expect(mockAddChild).toHaveBeenCalledTimes(2);

      // The h1 text should be added as a child of the div (node-1)
      expect(mockAddChild).toHaveBeenNthCalledWith(
        2,
        api,
        compUuid,
        "node-1", // parent is the div created in first call
        expect.objectContaining({
          type: "text",
          value: "Hello",
          tag: "h1",
        }),
        undefined
      );
    });

    it("imports an <img> element", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<img src="https://example.com/photo.jpg" alt="Photo" />`
      );

      expect(result.error).toBeUndefined();
      expect(result.nodesCreated).toBe(1);

      expect(mockAddChild).toHaveBeenCalledWith(
        api,
        compUuid,
        parentRef,
        expect.objectContaining({
          type: "img",
          src: "https://example.com/photo.jpg",
        }),
        undefined
      );

      // alt attribute should be set
      expect(mockUpdateAttrs).toHaveBeenCalledWith(
        api,
        compUuid,
        "node-1",
        expect.objectContaining({
          alt: "Photo",
        })
      );
    });
  });

  describe("style variant handling", () => {
    it("creates style variant and applies pseudo-class styles", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<style>.btn { color: blue; } .btn:hover { color: red; }</style>
         <div class="btn"></div>`
      );

      expect(result.error).toBeUndefined();

      // createStyleVariant should be called for :hover
      expect(mockCreateStyleVariant).toHaveBeenCalledWith(
        api,
        compUuid,
        ":hover",
        "node-1"
      );

      // updateStyles should be called with the :hover variant
      expect(mockUpdateStyles).toHaveBeenCalledWith(
        api,
        compUuid,
        "node-1",
        expect.objectContaining({ color: "red" }),
        ":hover"
      );
    });

    it("handles existing style variant gracefully", async () => {
      // Simulate createStyleVariant throwing "already exists"
      mockCreateStyleVariant.mockRejectedValueOnce(
        new Error("Style variant :hover already exists")
      );

      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<style>.x:hover { color: red; }</style><div class="x"></div>`
      );

      // Should still apply styles despite the "already exists" error
      expect(mockUpdateStyles).toHaveBeenCalledWith(
        api,
        compUuid,
        "node-1",
        expect.objectContaining({ color: "red" }),
        ":hover"
      );
    });
  });

  describe("media variant handling", () => {
    it("warns about media variants (not yet matched to breakpoints)", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<style>
           .box { font-size: 24px; }
           @media (max-width: 768px) { .box { font-size: 14px; } }
         </style>
         <div class="box"></div>`
      );

      expect(result.error).toBeUndefined();
      expect(result.warnings.some((w) => w.includes("768px"))).toBe(true);
      expect(result.warnings.some((w) => w.includes("not applied"))).toBe(true);
    });
  });

  describe("SVG handling", () => {
    it("stores SVG as dangerouslySetInnerHTML and warns", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/></svg>`
      );

      expect(result.error).toBeUndefined();
      expect(result.nodesCreated).toBe(1);

      // SVG should create a div wrapper
      expect(mockAddChild).toHaveBeenCalledWith(
        api,
        compUuid,
        parentRef,
        expect.objectContaining({
          type: "box",
          tag: "div",
        }),
        undefined
      );

      // dangerouslySetInnerHTML should be set
      expect(mockUpdateAttrs).toHaveBeenCalledWith(
        api,
        compUuid,
        "node-1",
        expect.objectContaining({
          dangerouslySetInnerHTML: expect.objectContaining({
            __html: expect.stringContaining("svg"),
          }),
        })
      );

      // Should warn about SVG being stored as raw HTML
      expect(result.warnings.some((w) => w.includes("SVG"))).toBe(true);
    });
  });

  describe("component import", () => {
    it("imports element with data-component as component type", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<div data-component="HeroSection" style="padding: 32px;"></div>`,
        undefined,
        ["HeroSection"]
      );

      expect(result.error).toBeUndefined();
      expect(result.nodesCreated).toBe(1);

      // addChild should be called with type: "component"
      expect(mockAddChild).toHaveBeenCalledWith(
        api,
        compUuid,
        parentRef,
        expect.objectContaining({
          type: "component",
          name: "HeroSection",
        }),
        undefined
      );
    });

    it("warns and falls back to container when component not found", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<div data-component="Unknown" style="display: flex;"></div>`,
        undefined,
        ["HeroSection"]
      );

      expect(result.error).toBeUndefined();
      expect(result.nodesCreated).toBe(1);
      expect(result.warnings.some((w) => w.includes("Unknown"))).toBe(true);

      // Should fall back to a box container
      expect(mockAddChild).toHaveBeenCalledWith(
        api,
        compUuid,
        parentRef,
        expect.objectContaining({
          type: "box",
        }),
        undefined
      );
    });

    it("imports component children into default slot", async () => {
      const result = await importHtml(
        api,
        compUuid,
        parentRef,
        `<div data-component="Card"><h1>Title</h1></div>`,
        undefined,
        ["Card"]
      );

      expect(result.error).toBeUndefined();
      expect(result.nodesCreated).toBe(2);

      // First call: component Card, second call: h1 text child
      expect(mockAddChild).toHaveBeenCalledTimes(2);
      expect(mockAddChild).toHaveBeenNthCalledWith(
        1,
        api,
        compUuid,
        parentRef,
        expect.objectContaining({ type: "component", name: "Card" }),
        undefined
      );
      expect(mockAddChild).toHaveBeenNthCalledWith(
        2,
        api,
        compUuid,
        "node-1", // child of the component
        expect.objectContaining({ type: "text", value: "Title" }),
        undefined
      );
    });
  });

  describe("cache invalidation", () => {
    it("invalidates node cache after import", async () => {
      await importHtml(api, compUuid, parentRef, `<div>text</div>`);
      expect(mockInvalidateNodeCache).toHaveBeenCalledWith(compUuid);
    });

    it("does not invalidate cache for empty HTML", async () => {
      await importHtml(api, compUuid, parentRef, "");
      expect(mockInvalidateNodeCache).not.toHaveBeenCalled();
    });
  });

  describe("position parameter", () => {
    it("passes position to addChild", async () => {
      await importHtml(api, compUuid, parentRef, `<div>text</div>`, "first");

      expect(mockAddChild).toHaveBeenCalledWith(
        api,
        compUuid,
        parentRef,
        expect.anything(),
        "first"
      );
    });
  });
});

describe("wiTreeToEditCalls", () => {
  const api = mockApiClient();
  const compUuid = "comp-123";
  const parentRef = "root";

  beforeEach(() => {
    setupMocks();
  });

  it("returns empty results for empty node list", async () => {
    const result = await wiTreeToEditCalls(api, compUuid, parentRef, []);
    expect(result.rootNodeUuids).toHaveLength(0);
    expect(result.nodesCreated).toBe(0);
  });

  it("processes multiple root nodes", async () => {
    const nodes: ParsedNode[] = [
      {
        kind: "container",
        tag: "div",
        children: [],
        styles: {},
        pseudoStyles: new Map(),
        mediaStyles: new Map(),
        attrs: {},
      },
      {
        kind: "text",
        tag: "p",
        value: "Hello",
        styles: {},
        pseudoStyles: new Map(),
        mediaStyles: new Map(),
        attrs: {},
      },
    ];

    const result = await wiTreeToEditCalls(api, compUuid, parentRef, nodes);
    expect(result.rootNodeUuids).toHaveLength(2);
    expect(result.nodesCreated).toBe(2);
    expect(mockAddChild).toHaveBeenCalledTimes(2);
  });

  it("maps component nodes to addChild with type: component", async () => {
    const nodes: ParsedNode[] = [
      {
        kind: "component",
        componentName: "HeroSection",
        children: [],
        styles: { padding: "32px" },
        pseudoStyles: new Map(),
        mediaStyles: new Map(),
        attrs: {},
      },
    ];

    const result = await wiTreeToEditCalls(api, compUuid, parentRef, nodes);
    expect(result.rootNodeUuids).toHaveLength(1);
    expect(result.nodesCreated).toBe(1);

    expect(mockAddChild).toHaveBeenCalledWith(
      api,
      compUuid,
      parentRef,
      expect.objectContaining({
        type: "component",
        name: "HeroSection",
      }),
      undefined
    );

    // Styles should be applied
    expect(mockUpdateStyles).toHaveBeenCalledWith(
      api,
      compUuid,
      "node-1",
      expect.objectContaining({ padding: "32px" })
    );
  });

  it("collects warnings from addChild failures without stopping", async () => {
    mockAddChild
      .mockRejectedValueOnce(new Error("Node limit reached"))
      .mockResolvedValueOnce({
        save: { revisionNum: 1, iids: [], changeDescription: "" },
        parentUuid: "parent-uuid",
        newNodeUuid: "node-ok",
        position: "last",
      } as any);

    const nodes: ParsedNode[] = [
      {
        kind: "container",
        tag: "div",
        children: [],
        styles: {},
        pseudoStyles: new Map(),
        mediaStyles: new Map(),
        attrs: {},
      },
      {
        kind: "text",
        tag: "p",
        value: "Still works",
        styles: {},
        pseudoStyles: new Map(),
        mediaStyles: new Map(),
        attrs: {},
      },
    ];

    const result = await wiTreeToEditCalls(api, compUuid, parentRef, nodes);
    // First node failed, second succeeded
    expect(result.rootNodeUuids).toHaveLength(1);
    expect(result.nodesCreated).toBe(1);
    expect(result.warnings.some((w) => w.includes("Node limit reached"))).toBe(true);
  });
});
