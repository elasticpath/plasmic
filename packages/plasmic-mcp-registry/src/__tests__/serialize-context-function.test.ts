/**
 * Tests for serializeContextMeta() and serializeFunctionMeta().
 *
 * Why: These serializers strip non-serializable fields (function callbacks,
 * fnContext) from context and function metadata before HTTP transport. If
 * they fail, the MCP server receives malformed metadata or crashes on
 * JSON.stringify of functions.
 */
import { describe, it, expect } from "vitest";
import { serializeContextMeta, serializeFunctionMeta } from "../serialize";

describe("serializeContextMeta", () => {
  it("preserves JSON-serializable fields", () => {
    const meta = {
      name: "MyProvider",
      displayName: "My Provider",
      description: "Provides data",
      importName: "MyProvider",
      importPath: "@pkg/my-provider",
      isDefaultExport: false,
      refProp: "ref",
      providesData: true,
      props: {
        apiKey: { type: "string", defaultValue: "xxx" },
      },
      globalActions: {
        addItem: {
          displayName: "Add Item",
          parameters: [
            { name: "item", type: "object" },
          ],
        },
      },
    };

    const result = serializeContextMeta(meta);

    expect(result.name).toBe("MyProvider");
    expect(result.displayName).toBe("My Provider");
    expect(result.description).toBe("Provides data");
    expect(result.importPath).toBe("@pkg/my-provider");
    expect(result.isDefaultExport).toBe(false);
    expect(result.refProp).toBe("ref");
    expect(result.providesData).toBe(true);
    expect(result.props).toEqual({
      apiKey: { type: "string", defaultValue: "xxx" },
    });
    expect(result.globalActions).toEqual({
      addItem: {
        displayName: "Add Item",
        parameters: [{ name: "item", type: "object" }],
      },
    });
  });

  it("strips function callbacks in props", () => {
    const meta = {
      name: "CtxWithFuncProps",
      props: {
        apiKey: {
          type: "string",
          displayName: "API Key",
          hidden: () => false,
          validator: (val: unknown) => true,
          control: () => "textarea",
          defaultValueHint: () => "default",
          readOnly: () => true,
          onSearch: () => {},
        },
        count: {
          type: "number",
          min: 0,
          // options as a function (instead of array) should be stripped
          options: () => [1, 2, 3],
        },
      },
    };

    const result = serializeContextMeta(meta);
    const props = result.props as Record<string, Record<string, unknown>>;

    // Declarative parts preserved
    expect(props.apiKey.type).toBe("string");
    expect(props.apiKey.displayName).toBe("API Key");
    expect(props.count.type).toBe("number");
    expect(props.count.min).toBe(0);

    // Functions stripped
    expect(props.apiKey).not.toHaveProperty("hidden");
    expect(props.apiKey).not.toHaveProperty("validator");
    expect(props.apiKey).not.toHaveProperty("control");
    expect(props.apiKey).not.toHaveProperty("defaultValueHint");
    expect(props.apiKey).not.toHaveProperty("readOnly");
    expect(props.apiKey).not.toHaveProperty("onSearch");
    expect(props.count).not.toHaveProperty("options");
  });

  it("strips function-bearing fields in globalActions parameters", () => {
    const meta = {
      name: "ActionsCtx",
      globalActions: {
        doThing: {
          displayName: "Do Thing",
          parameters: [
            {
              name: "input",
              type: {
                type: "string",
                hidden: () => false,
              },
            },
          ],
        },
      },
    };

    const result = serializeContextMeta(meta);
    const actions = result.globalActions as Record<string, any>;
    const param = actions.doThing.parameters[0];

    expect(param.name).toBe("input");
    expect(param.type.type).toBe("string");
    // Function inside parameter type stripped by JSON roundtrip
    expect(param.type).not.toHaveProperty("hidden");
  });

  it("returns minimal object for null/undefined input", () => {
    expect(serializeContextMeta(null)).toEqual({ name: "" });
    expect(serializeContextMeta(undefined)).toEqual({ name: "" });
  });

  it("returns minimal object for non-object input", () => {
    expect(serializeContextMeta("string")).toEqual({ name: "" });
    expect(serializeContextMeta(42)).toEqual({ name: "" });
    expect(serializeContextMeta(true)).toEqual({ name: "" });
  });

  it("handles missing name field", () => {
    const meta = { props: { x: { type: "string" } } };
    const result = serializeContextMeta(meta);
    expect(result.name).toBe("");
  });

  it("handles empty meta object", () => {
    const result = serializeContextMeta({});
    expect(result.name).toBe("");
  });

  it("falls back on circular reference", () => {
    const meta: any = { name: "Circular" };
    meta.self = meta;
    const result = serializeContextMeta(meta);
    expect(result.name).toBe("Circular");
  });

  it("strips top-level function fields", () => {
    const meta = {
      name: "FuncCtx",
      someCallback: () => "hello",
      normalField: "preserved",
    };
    const result = serializeContextMeta(meta);
    expect(result).not.toHaveProperty("someCallback");
    expect(result.normalField).toBe("preserved");
  });
});

describe("serializeFunctionMeta", () => {
  it("preserves JSON-serializable fields", () => {
    const meta = {
      name: "fetchProducts",
      namespace: "commerce",
      displayName: "Fetch Products",
      description: "Fetches products from the store",
      typescriptDeclaration: "function fetchProducts(): Product[]",
      isQuery: true,
      importPath: "@pkg/commerce",
      isDefaultExport: false,
      params: [
        { name: "category", type: "string", displayName: "Category" },
        { name: "limit", type: "number", defaultValue: 10 },
      ],
      returnValue: { type: "array", itemType: "object" },
    };

    const result = serializeFunctionMeta(meta);

    expect(result.name).toBe("fetchProducts");
    expect(result.namespace).toBe("commerce");
    expect(result.displayName).toBe("Fetch Products");
    expect(result.description).toBe("Fetches products from the store");
    expect(result.typescriptDeclaration).toBe(
      "function fetchProducts(): Product[]"
    );
    expect(result.isQuery).toBe(true);
    expect(result.importPath).toBe("@pkg/commerce");
    expect(result.isDefaultExport).toBe(false);
    expect(result.params).toEqual([
      { name: "category", type: "string", displayName: "Category" },
      { name: "limit", type: "number", defaultValue: 10 },
    ]);
    expect(result.returnValue).toEqual({ type: "array", itemType: "object" });
  });

  it("strips fnContext callback", () => {
    const meta = {
      name: "fetchData",
      importPath: "@pkg/data",
      fnContext: () => ({
        dataKey: "products",
        fetcher: async () => [],
      }),
    };

    const result = serializeFunctionMeta(meta);
    expect(result.name).toBe("fetchData");
    expect(result.importPath).toBe("@pkg/data");
    expect(result).not.toHaveProperty("fnContext");
  });

  it("strips function fields in params", () => {
    const meta = {
      name: "myFunc",
      params: [
        {
          name: "input",
          type: "string",
          displayName: "Input",
          control: () => "textarea",
          hidden: () => false,
        },
      ],
    };

    const result = serializeFunctionMeta(meta);
    const param = (result.params as any[])[0];

    expect(param.name).toBe("input");
    expect(param.type).toBe("string");
    expect(param.displayName).toBe("Input");
    expect(param).not.toHaveProperty("control");
    expect(param).not.toHaveProperty("hidden");
  });

  it("returns minimal object for null/undefined input", () => {
    expect(serializeFunctionMeta(null)).toEqual({ name: "" });
    expect(serializeFunctionMeta(undefined)).toEqual({ name: "" });
  });

  it("returns minimal object for non-object input", () => {
    expect(serializeFunctionMeta("string")).toEqual({ name: "" });
    expect(serializeFunctionMeta(42)).toEqual({ name: "" });
    expect(serializeFunctionMeta(true)).toEqual({ name: "" });
  });

  it("handles missing name field", () => {
    const meta = { importPath: "@pkg/something" };
    const result = serializeFunctionMeta(meta);
    expect(result.name).toBe("");
  });

  it("handles empty meta object", () => {
    const result = serializeFunctionMeta({});
    expect(result.name).toBe("");
  });

  it("falls back on circular reference", () => {
    const meta: any = { name: "Circular" };
    meta.self = meta;
    const result = serializeFunctionMeta(meta);
    expect(result.name).toBe("Circular");
  });

  it("strips top-level function fields", () => {
    const meta = {
      name: "funcTest",
      someCallback: () => "hello",
      normalField: "preserved",
    };
    const result = serializeFunctionMeta(meta);
    expect(result).not.toHaveProperty("someCallback");
    expect(result.normalField).toBe("preserved");
  });
});
