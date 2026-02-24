/**
 * Unit tests for tree-reader.ts
 *
 * The tree reader is the most complex read path in the MCP server. It walks
 * the in-memory Tpl model to produce JSON that Claude uses to understand
 * page structure. Incorrect output here means Claude builds broken pages
 * or misunderstands existing layouts, so these tests cover every node type,
 * expression variant, and layout derivation path.
 */

import { readComponentTree } from "../tree-reader";

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
});
