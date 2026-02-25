/**
 * Unit tests for tree-reader.ts
 *
 * The tree reader is the most complex read path in the MCP server. It walks
 * the in-memory Tpl model to produce JSON that Claude uses to understand
 * page structure. Incorrect output here means Claude builds broken pages
 * or misunderstands existing layouts, so these tests cover every node type,
 * expression variant, and layout derivation path.
 */

import {
  readComponentTree,
  readComponentSummary,
  readNodeDetails,
  countTreeNodes,
} from "../tree-reader";

describe("readComponentTree", () => {
  it("returns null when component has no tplTree", () => {
    expect(readComponentTree({ tplTree: null })).toBeNull();
    expect(readComponentTree({ tplTree: undefined })).toBeNull();
  });

  describe("TplTag reading", () => {
    it("reads a simple div with styles", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "uuid-1",
          name: "Container",
          type: "other",
          vsettings: [
            { rs: { values: { display: "flex" } }, attrs: {} },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);

      expect(result).toMatchObject({
        type: "tag",
        tag: "div",
        uuid: "uuid-1",
        name: "Container",
        styles: { display: "flex" },
        layoutType: "hbox",
      });
    });

    it("defaults tag to div when unset", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: undefined,
          uuid: "uuid-default",
          vsettings: [{ rs: { values: {} }, attrs: {} }],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.tag).toBe("div");
    });

    it("includes nodeType when not 'other'", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "nt1",
          type: "text",
          vsettings: [{ rs: { values: {} }, attrs: {} }],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.nodeType).toBe("text");
    });

    it("omits nodeType when 'other'", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "nt2",
          type: "other",
          vsettings: [{ rs: { values: {} }, attrs: {} }],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.nodeType).toBeUndefined();
    });

    it("omits styles when RuleSet values are empty", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "no-styles",
          vsettings: [{ rs: { values: {} }, attrs: {} }],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.styles).toBeUndefined();
    });
  });

  describe("text content", () => {
    it("reads RawText content", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "span",
          uuid: "raw-text",
          vsettings: [
            {
              rs: { values: {} },
              text: { _type: "RawText", text: "Hello World" },
              attrs: {},
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.text).toBe("Hello World");
    });

    it("reads ExprText html content", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "span",
          uuid: "expr-text",
          vsettings: [
            {
              rs: { values: {} },
              text: { _type: "ExprText", html: "<p>Dynamic</p>" },
              attrs: {},
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.text).toBe("<p>Dynamic</p>");
    });

    it("falls back to [dynamic text] for ExprText without html", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "span",
          uuid: "expr-no-html",
          vsettings: [
            {
              rs: { values: {} },
              text: { _type: "ExprText", html: undefined },
              attrs: {},
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.text).toBe("[dynamic text]");
    });
  });

  describe("HTML attributes", () => {
    it("extracts CustomCode attributes (JSON-parseable)", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "a",
          uuid: "attrs-1",
          vsettings: [
            {
              rs: { values: {} },
              attrs: {
                href: {
                  _type: "CustomCode",
                  code: '"https://example.com"',
                },
              },
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.attrs?.href).toBe("https://example.com");
    });

    it("returns raw code when CustomCode is not valid JSON", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "attrs-raw",
          vsettings: [
            {
              rs: { values: {} },
              attrs: {
                onClick: {
                  _type: "CustomCode",
                  code: "() => alert('hi')",
                },
              },
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.attrs?.onClick).toBe("() => alert('hi')");
    });

    it("extracts RawText attributes", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "a",
          uuid: "attrs-raw-text",
          vsettings: [
            {
              rs: { values: {} },
              attrs: {
                target: { _type: "RawText", text: "_blank" },
              },
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.attrs?.target).toBe("_blank");
    });

    it("extracts ImageAssetRef with dataUri", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "img",
          uuid: "img-data",
          vsettings: [
            {
              rs: { values: {} },
              attrs: {
                src: {
                  _type: "ImageAssetRef",
                  asset: { dataUri: "data:image/png;base64,abc" },
                },
              },
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.attrs?.src).toBe("data:image/png;base64,abc");
    });

    it("extracts ImageAssetRef with url fallback", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "img",
          uuid: "img-url",
          vsettings: [
            {
              rs: { values: {} },
              attrs: {
                src: {
                  _type: "ImageAssetRef",
                  asset: { url: "https://cdn.example.com/img.png" },
                },
              },
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.attrs?.src).toBe("https://cdn.example.com/img.png");
    });

    it("extracts StyleTokenRef value", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "token-ref",
          vsettings: [
            {
              rs: { values: {} },
              attrs: {
                color: {
                  _type: "StyleTokenRef",
                  token: { value: "#ff0000" },
                },
              },
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.attrs?.color).toBe("#ff0000");
    });

    it("extracts VarRef as $variableName", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "span",
          uuid: "var-ref",
          vsettings: [
            {
              rs: { values: {} },
              attrs: {
                className: {
                  _type: "VarRef",
                  variable: { name: "myClass" },
                },
              },
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.attrs?.className).toBe("$myClass");
    });

    it("omits attrs when all expression values are undefined", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "no-attrs",
          vsettings: [
            {
              rs: { values: {} },
              attrs: {
                someAttr: null, // extractExprValue returns undefined for null
              },
            },
          ],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.attrs).toBeUndefined();
    });
  });

  describe("nested children", () => {
    it("reads nested tag children", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "parent",
          vsettings: [{ rs: { values: {} }, attrs: {} }],
          children: [
            {
              _type: "TplTag",
              tag: "h1",
              uuid: "child1",
              vsettings: [
                {
                  rs: { values: {} },
                  text: { _type: "RawText", text: "Title" },
                  attrs: {},
                },
              ],
              children: [],
            },
            {
              _type: "TplTag",
              tag: "p",
              uuid: "child2",
              vsettings: [
                {
                  rs: { values: {} },
                  text: { _type: "RawText", text: "Paragraph" },
                  attrs: {},
                },
              ],
              children: [],
            },
          ],
        },
      };

      const result = readComponentTree(component);

      expect(result?.children).toHaveLength(2);
      expect(result?.children?.[0].tag).toBe("h1");
      expect(result?.children?.[0].text).toBe("Title");
      expect(result?.children?.[1].tag).toBe("p");
      expect(result?.children?.[1].text).toBe("Paragraph");
    });

    it("omits children array when empty", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "no-children",
          vsettings: [{ rs: { values: {} }, attrs: {} }],
          children: [],
        },
      };

      const result = readComponentTree(component);
      expect(result?.children).toBeUndefined();
    });
  });

  describe("TplComponent reading", () => {
    it("reads component reference with name and uuid", () => {
      const component = {
        tplTree: {
          _type: "TplComponent",
          uuid: "comp-1",
          name: "MyButton",
          component: {
            name: "Button",
            uuid: "comp-def-uuid",
          },
          vsettings: [{ args: [] }],
        },
      };

      const result = readComponentTree(component);

      expect(result).toMatchObject({
        type: "component",
        uuid: "comp-1",
        name: "MyButton",
        componentName: "Button",
        componentUuid: "comp-def-uuid",
      });
    });

    it("extracts component props from args", () => {
      const component = {
        tplTree: {
          _type: "TplComponent",
          uuid: "comp-2",
          component: { name: "Button", uuid: "b1" },
          vsettings: [
            {
              args: [
                {
                  param: { variable: { name: "label" } },
                  expr: { _type: "CustomCode", code: '"Click me"' },
                },
                {
                  param: { variable: { name: "disabled" } },
                  expr: { _type: "CustomCode", code: "true" },
                },
              ],
            },
          ],
        },
      };

      const result = readComponentTree(component);
      expect(result?.attrs).toEqual({
        label: "Click me",
        disabled: true,
      });
    });

    it("handles RenderExpr args with tpl children", () => {
      const component = {
        tplTree: {
          _type: "TplComponent",
          uuid: "render-expr",
          component: { name: "Wrapper", uuid: "w1" },
          vsettings: [
            {
              args: [
                {
                  param: { variable: { name: "content" } },
                  expr: {
                    _type: "RenderExpr",
                    tpl: [
                      {
                        _type: "TplTag",
                        tag: "div",
                        uuid: "inner1",
                        vsettings: [{ rs: { values: {} }, attrs: {} }],
                        children: [],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };

      const result = readComponentTree(component);

      expect(result?.attrs?.content).toEqual([
        expect.objectContaining({ type: "tag", tag: "div" }),
      ]);
    });
  });

  describe("TplSlot reading", () => {
    it("reads slot with name and default contents", () => {
      const component = {
        tplTree: {
          _type: "TplSlot",
          uuid: "slot-1",
          param: { variable: { name: "children" } },
          defaultContents: [
            {
              _type: "TplTag",
              tag: "span",
              uuid: "default-1",
              vsettings: [
                {
                  rs: { values: {} },
                  text: { _type: "RawText", text: "Default content" },
                  attrs: {},
                },
              ],
              children: [],
            },
          ],
        },
      };

      const result = readComponentTree(component);

      expect(result).toMatchObject({
        type: "slot",
        slotName: "children",
        children: [
          expect.objectContaining({
            type: "tag",
            tag: "span",
            text: "Default content",
          }),
        ],
      });
    });

    it("reads slot without default contents", () => {
      const component = {
        tplTree: {
          _type: "TplSlot",
          uuid: "slot-empty",
          param: { variable: { name: "header" } },
          defaultContents: [],
        },
      };

      const result = readComponentTree(component);

      expect(result).toMatchObject({
        type: "slot",
        slotName: "header",
      });
      expect(result?.children).toBeUndefined();
    });
  });

  describe("layout type derivation", () => {
    it("derives vbox from flexDirection: column", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "vbox",
          vsettings: [
            {
              rs: {
                values: { display: "flex", flexDirection: "column" },
              },
              attrs: {},
            },
          ],
          children: [],
        },
      };

      expect(readComponentTree(component)?.layoutType).toBe("vbox");
    });

    it("derives hbox from flexDirection: row", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "hbox",
          vsettings: [
            {
              rs: {
                values: { display: "flex", flexDirection: "row" },
              },
              attrs: {},
            },
          ],
          children: [],
        },
      };

      expect(readComponentTree(component)?.layoutType).toBe("hbox");
    });

    it("derives hbox from display: flex without explicit direction", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "flex-default",
          vsettings: [
            { rs: { values: { display: "flex" } }, attrs: {} },
          ],
          children: [],
        },
      };

      expect(readComponentTree(component)?.layoutType).toBe("hbox");
    });

    it("derives box from non-flex display", () => {
      const component = {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "block",
          vsettings: [
            { rs: { values: { display: "block" } }, attrs: {} },
          ],
          children: [],
        },
      };

      expect(readComponentTree(component)?.layoutType).toBe("box");
    });
  });

  describe("unknown node types", () => {
    it("returns a fallback node for unrecognized types", () => {
      const component = {
        tplTree: {
          _type: "SomeUnknownType",
          constructor: { name: "SomeUnknownType" },
        },
      };

      const result = readComponentTree(component);

      expect(result).toMatchObject({
        type: "tag",
        tag: "div",
      });
      expect(result?.name).toContain("Unknown");
    });
  });

  // ===========================================================================
  // M3: TreeReadOptions — summaryOnly, maxDepth, excludeStyles
  // ===========================================================================

  describe("TreeReadOptions", () => {
    /** A reusable 3-level component tree for options tests */
    function deepComponent() {
      return {
        tplTree: {
          _type: "TplTag",
          tag: "div",
          uuid: "root",
          name: "Root",
          vsettings: [
            {
              rs: { values: { display: "flex", flexDirection: "column" } },
              text: undefined,
              attrs: {},
            },
          ],
          children: [
            {
              _type: "TplTag",
              tag: "section",
              uuid: "hero",
              name: "Hero",
              vsettings: [
                {
                  rs: { values: { padding: "32px" } },
                  attrs: {},
                },
              ],
              children: [
                {
                  _type: "TplTag",
                  tag: "h1",
                  uuid: "title",
                  name: "Hero Title",
                  vsettings: [
                    {
                      rs: { values: { fontSize: "48px", fontWeight: "700" } },
                      text: { _type: "RawText", text: "Welcome" },
                      attrs: {},
                    },
                  ],
                  children: [],
                },
                {
                  _type: "TplTag",
                  tag: "p",
                  uuid: "subtitle",
                  name: "Hero Subtitle",
                  vsettings: [
                    {
                      rs: { values: { fontSize: "18px" } },
                      text: { _type: "RawText", text: "Build fast" },
                      attrs: {},
                    },
                  ],
                  children: [],
                },
              ],
            },
            {
              _type: "TplComponent",
              uuid: "grid",
              name: "ProductGrid",
              component: { name: "ProductGrid", uuid: "grid-def" },
              vsettings: [{ args: [] }],
            },
            {
              _type: "TplTag",
              tag: "footer",
              uuid: "footer",
              name: "Footer",
              vsettings: [
                {
                  rs: { values: { padding: "16px" } },
                  attrs: {},
                },
              ],
              children: [
                {
                  _type: "TplTag",
                  tag: "span",
                  uuid: "copyright",
                  vsettings: [
                    {
                      rs: { values: {} },
                      text: { _type: "RawText", text: "© 2024" },
                      attrs: {},
                    },
                  ],
                  children: [],
                },
              ],
            },
          ],
        },
      };
    }

    describe("summaryOnly", () => {
      it("strips styles, text, and attrs from all nodes", () => {
        const result = readComponentTree(deepComponent(), { summaryOnly: true });

        expect(result?.styles).toBeUndefined();
        expect(result?.text).toBeUndefined();
        expect(result?.attrs).toBeUndefined();
        expect(result?.layoutType).toBeUndefined();

        // Hero child
        const hero = result?.children?.[0];
        expect(hero?.styles).toBeUndefined();
        expect(hero?.text).toBeUndefined();

        // Deep title node
        const title = hero?.children?.[0];
        expect(title?.styles).toBeUndefined();
        expect(title?.text).toBeUndefined();
      });

      it("includes childCount on every node", () => {
        const result = readComponentTree(deepComponent(), { summaryOnly: true });

        expect(result?.childCount).toBe(3); // Root has 3 children
        expect(result?.children?.[0].childCount).toBe(2); // Hero has 2
        expect(result?.children?.[0].children?.[0].childCount).toBe(0); // Title has 0
        expect(result?.children?.[1].childCount).toBe(0); // Component has 0
        expect(result?.children?.[2].childCount).toBe(1); // Footer has 1
      });

      it("preserves type, tag, name, uuid for all nodes", () => {
        const result = readComponentTree(deepComponent(), { summaryOnly: true });

        expect(result).toMatchObject({
          type: "tag",
          tag: "div",
          uuid: "root",
          name: "Root",
        });

        expect(result?.children?.[1]).toMatchObject({
          type: "component",
          uuid: "grid",
          componentName: "ProductGrid",
        });
      });
    });

    describe("maxDepth", () => {
      it("maxDepth: 0 returns only root with childCount", () => {
        const result = readComponentTree(deepComponent(), { maxDepth: 0 });

        expect(result?.children).toBeUndefined();
        expect(result?.childCount).toBe(3);
        // Root still has full details (styles, etc.)
        expect(result?.styles).toBeDefined();
      });

      it("maxDepth: 1 returns root + direct children with childCount", () => {
        const result = readComponentTree(deepComponent(), { maxDepth: 1 });

        expect(result?.children).toHaveLength(3);
        // Direct children have their data but their own children are truncated
        const hero = result?.children?.[0];
        expect(hero?.styles).toBeDefined(); // full detail at depth 1
        expect(hero?.children).toBeUndefined(); // no recursion beyond depth 1
        expect(hero?.childCount).toBe(2); // but shows how many children exist
      });

      it("maxDepth: undefined returns full tree (backward compat)", () => {
        const result = readComponentTree(deepComponent());

        // Full recursion — title is at depth 2
        const title = result?.children?.[0].children?.[0];
        expect(title?.text).toBe("Welcome");
        expect(title?.childCount).toBeUndefined(); // no childCount in full mode
      });
    });

    describe("excludeStyles", () => {
      it("strips styles but keeps text and attrs", () => {
        const result = readComponentTree(deepComponent(), { excludeStyles: true });

        expect(result?.styles).toBeUndefined();
        expect(result?.layoutType).toBeUndefined();

        // Text is still present
        const title = result?.children?.[0].children?.[0];
        expect(title?.text).toBe("Welcome");
        expect(title?.styles).toBeUndefined();
      });
    });

    describe("combined options", () => {
      it("summaryOnly + maxDepth: 1 truncates and strips", () => {
        const result = readComponentTree(deepComponent(), {
          summaryOnly: true,
          maxDepth: 1,
        });

        expect(result?.styles).toBeUndefined();
        expect(result?.childCount).toBe(3);
        expect(result?.children).toHaveLength(3);

        const hero = result?.children?.[0];
        expect(hero?.styles).toBeUndefined();
        expect(hero?.childCount).toBe(2);
        expect(hero?.children).toBeUndefined();
      });
    });
  });
});

// =============================================================================
// M3: readComponentSummary
// =============================================================================

describe("readComponentSummary", () => {
  it("returns a summary tree (same as summaryOnly: true)", () => {
    const component = {
      tplTree: {
        _type: "TplTag",
        tag: "div",
        uuid: "root",
        name: "Root",
        vsettings: [
          {
            rs: { values: { color: "red" } },
            text: { _type: "RawText", text: "Hello" },
            attrs: {},
          },
        ],
        children: [
          {
            _type: "TplTag",
            tag: "h1",
            uuid: "h1",
            vsettings: [{ rs: { values: {} }, attrs: {} }],
            children: [],
          },
        ],
      },
    };

    const result = readComponentSummary(component);

    // No styles, text, or attrs
    expect(result?.styles).toBeUndefined();
    expect(result?.text).toBeUndefined();
    // Has childCount
    expect(result?.childCount).toBe(1);
    expect(result?.children?.[0].childCount).toBe(0);
  });

  it("returns null for component without tplTree", () => {
    expect(readComponentSummary({ tplTree: null })).toBeNull();
  });

  it("respects maxDepth parameter", () => {
    const component = {
      tplTree: {
        _type: "TplTag",
        tag: "div",
        uuid: "root",
        vsettings: [{ rs: { values: {} }, attrs: {} }],
        children: [
          {
            _type: "TplTag",
            tag: "h1",
            uuid: "h1",
            vsettings: [{ rs: { values: {} }, attrs: {} }],
            children: [],
          },
        ],
      },
    };

    const result = readComponentSummary(component, 0);

    expect(result?.children).toBeUndefined();
    expect(result?.childCount).toBe(1);
  });
});

// =============================================================================
// M3: readNodeDetails
// =============================================================================

describe("readNodeDetails", () => {
  it("returns full details for a TplTag with children as summaries", () => {
    const child1 = {
      _type: "TplTag",
      tag: "h1",
      uuid: "c1",
      name: "Title",
      vsettings: [
        {
          rs: { values: { fontSize: "48px" } },
          text: { _type: "RawText", text: "Hello" },
          attrs: {},
        },
      ],
      children: [],
    };
    const child2 = {
      _type: "TplTag",
      tag: "p",
      uuid: "c2",
      name: "Subtitle",
      vsettings: [
        {
          rs: { values: { fontSize: "16px" } },
          text: { _type: "RawText", text: "World" },
          attrs: {},
        },
      ],
      children: [],
    };
    const parentNode = {
      _type: "TplTag",
      tag: "section",
      uuid: "parent",
      name: "Hero",
      vsettings: [
        {
          rs: { values: { padding: "32px", display: "flex", flexDirection: "column" } },
          attrs: {},
        },
      ],
      children: [child1, child2],
    };

    const result = readNodeDetails(parentNode);

    // Parent has full details
    expect(result.type).toBe("tag");
    expect(result.tag).toBe("section");
    expect(result.styles).toEqual({
      padding: "32px",
      display: "flex",
      flexDirection: "column",
    });
    expect(result.layoutType).toBe("vbox");
    expect(result.childCount).toBe(2);

    // Children are summaries (no styles, no text)
    expect(result.children).toHaveLength(2);
    expect(result.children?.[0].name).toBe("Title");
    expect(result.children?.[0].styles).toBeUndefined();
    expect(result.children?.[0].text).toBeUndefined();
    expect(result.children?.[0].childCount).toBe(0);
    expect(result.children?.[1].name).toBe("Subtitle");
    expect(result.children?.[1].styles).toBeUndefined();
  });

  it("returns full details for a leaf node", () => {
    const leaf = {
      _type: "TplTag",
      tag: "h1",
      uuid: "leaf",
      name: "Heading",
      vsettings: [
        {
          rs: { values: { fontSize: "32px" } },
          text: { _type: "RawText", text: "Big Title" },
          attrs: {},
        },
      ],
      children: [],
    };

    const result = readNodeDetails(leaf);

    expect(result.styles).toEqual({ fontSize: "32px" });
    expect(result.text).toBe("Big Title");
    expect(result.childCount).toBe(0);
    expect(result.children).toBeUndefined();
  });

  it("returns details for a TplComponent node", () => {
    const compNode = {
      _type: "TplComponent",
      uuid: "comp-inst",
      name: "MyButton",
      component: { name: "Button", uuid: "btn-def" },
      vsettings: [
        {
          args: [
            {
              param: { variable: { name: "label" } },
              expr: { _type: "CustomCode", code: '"Click me"' },
            },
          ],
        },
      ],
    };

    const result = readNodeDetails(compNode);

    expect(result.type).toBe("component");
    expect(result.componentName).toBe("Button");
    expect(result.childCount).toBe(0);
  });

  it("returns details for a TplSlot with default contents", () => {
    const slotChild = {
      _type: "TplTag",
      tag: "span",
      uuid: "sc1",
      name: "Default",
      vsettings: [
        {
          rs: { values: { color: "gray" } },
          text: { _type: "RawText", text: "Placeholder" },
          attrs: {},
        },
      ],
      children: [],
    };
    const slotNode = {
      _type: "TplSlot",
      uuid: "slot1",
      param: { variable: { name: "children" } },
      defaultContents: [slotChild],
    };

    const result = readNodeDetails(slotNode);

    expect(result.type).toBe("slot");
    expect(result.slotName).toBe("children");
    expect(result.childCount).toBe(1);
    expect(result.children).toHaveLength(1);
    // Child is a summary — no styles or text
    expect(result.children?.[0].name).toBe("Default");
    expect(result.children?.[0].styles).toBeUndefined();
    expect(result.children?.[0].text).toBeUndefined();
  });
});

// =============================================================================
// M3: countTreeNodes
// =============================================================================

describe("countTreeNodes", () => {
  it("counts all nodes in a tree", () => {
    const tree = {
      type: "tag" as const,
      tag: "div",
      children: [
        { type: "tag" as const, tag: "h1" },
        {
          type: "tag" as const,
          tag: "section",
          children: [
            { type: "tag" as const, tag: "p" },
            { type: "tag" as const, tag: "span" },
          ],
        },
        { type: "component" as const, componentName: "Button" },
      ],
    };

    expect(countTreeNodes(tree)).toBe(6);
  });

  it("returns 0 for null", () => {
    expect(countTreeNodes(null)).toBe(0);
  });

  it("returns 1 for a leaf node", () => {
    expect(countTreeNodes({ type: "tag", tag: "div" })).toBe(1);
  });
});
