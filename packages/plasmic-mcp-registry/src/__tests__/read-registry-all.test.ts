/**
 * Tests for new registry readers: getContextRegistry, getFunctionRegistry,
 * getTokenRegistry, getTraitRegistry, and getFullRegistry.
 *
 * Why: Each reader accesses a different globalThis registry array populated
 * by @plasmicapp/host's registration functions. If these readers fail, the
 * MCP server cannot discover contexts, functions, tokens, or traits from
 * the dev host — limiting its understanding of the registered code components.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getContextRegistry,
  getFunctionRegistry,
  getTokenRegistry,
  getTraitRegistry,
  getFullRegistry,
} from "../read-registry";

const root = globalThis as Record<string, unknown>;

/** Clean up all registry globals between tests. */
function cleanRegistries() {
  delete root.__PlasmicComponentRegistry;
  delete root.__PlasmicContextRegistry;
  delete root.__PlasmicFunctionsRegistry;
  delete root.__PlasmicTokenRegistry;
  delete root.__PlasmicTraitRegistry;
}

describe("getContextRegistry", () => {
  beforeEach(cleanRegistries);
  afterEach(cleanRegistries);

  it("returns empty array when no registrations exist", () => {
    expect(getContextRegistry()).toEqual([]);
  });

  it("returns empty array when registry is not an array", () => {
    root.__PlasmicContextRegistry = "invalid";
    expect(getContextRegistry()).toEqual([]);

    root.__PlasmicContextRegistry = {};
    expect(getContextRegistry()).toEqual([]);

    root.__PlasmicContextRegistry = null;
    expect(getContextRegistry()).toEqual([]);
  });

  it("reads from globalThis and returns correct shape", () => {
    root.__PlasmicContextRegistry = [
      {
        component: function MyProvider() {},
        meta: {
          name: "MyProvider",
          displayName: "My Provider",
          importPath: "@pkg/provider",
          providesData: true,
          props: {
            apiKey: { type: "string", defaultValue: "xxx" },
          },
        },
      },
    ];

    const result = getContextRegistry();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("MyProvider");
    expect(result[0].displayName).toBe("My Provider");
    expect(result[0].importPath).toBe("@pkg/provider");
    expect(result[0].providesData).toBe(true);
    expect(result[0].props).toEqual({
      apiKey: { type: "string", defaultValue: "xxx" },
    });
  });

  it("strips component reference", () => {
    root.__PlasmicContextRegistry = [
      {
        component: function Provider() {},
        meta: { name: "Provider", importPath: "@pkg/ctx" },
      },
    ];

    const result = getContextRegistry();
    expect(result[0]).not.toHaveProperty("component");
  });

  it("strips non-serializable fields from meta", () => {
    root.__PlasmicContextRegistry = [
      {
        component: function Ctx() {},
        meta: {
          name: "Ctx",
          props: {
            key: { type: "string", hidden: () => false },
          },
        },
      },
    ];

    const result = getContextRegistry();
    const props = result[0].props as Record<string, Record<string, unknown>>;
    expect(props.key.type).toBe("string");
    expect(props.key).not.toHaveProperty("hidden");
  });

  it("handles malformed entries gracefully", () => {
    root.__PlasmicContextRegistry = [
      null,
      undefined,
      "invalid",
      { component: function A() {} }, // no meta
      { component: function B() {}, meta: { name: "Valid" } },
    ];

    const result = getContextRegistry();
    expect(result).toHaveLength(5);
    expect(result[0].name).toBe("");
    expect(result[1].name).toBe("");
    expect(result[2].name).toBe("");
    expect(result[3].name).toBe("");
    expect(result[4].name).toBe("Valid");
  });
});

describe("getFunctionRegistry", () => {
  beforeEach(cleanRegistries);
  afterEach(cleanRegistries);

  it("returns empty array when no registrations exist", () => {
    expect(getFunctionRegistry()).toEqual([]);
  });

  it("returns empty array when registry is not an array", () => {
    root.__PlasmicFunctionsRegistry = "invalid";
    expect(getFunctionRegistry()).toEqual([]);

    root.__PlasmicFunctionsRegistry = {};
    expect(getFunctionRegistry()).toEqual([]);

    root.__PlasmicFunctionsRegistry = null;
    expect(getFunctionRegistry()).toEqual([]);
  });

  it("reads from globalThis and returns correct shape", () => {
    root.__PlasmicFunctionsRegistry = [
      {
        function: async () => [],
        meta: {
          name: "fetchProducts",
          namespace: "commerce",
          displayName: "Fetch Products",
          description: "Gets products",
          typescriptDeclaration: "function fetchProducts(): Product[]",
          isQuery: true,
          importPath: "@pkg/commerce",
          params: [{ name: "limit", type: "number" }],
          returnValue: { type: "array" },
        },
      },
    ];

    const result = getFunctionRegistry();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("fetchProducts");
    expect(result[0].namespace).toBe("commerce");
    expect(result[0].isQuery).toBe(true);
    expect(result[0].importPath).toBe("@pkg/commerce");
    expect(result[0].params).toEqual([{ name: "limit", type: "number" }]);
  });

  it("strips function reference", () => {
    root.__PlasmicFunctionsRegistry = [
      {
        function: async () => [],
        meta: { name: "myFunc", importPath: "@pkg/func" },
      },
    ];

    const result = getFunctionRegistry();
    expect(result[0]).not.toHaveProperty("function");
  });

  it("strips fnContext from meta", () => {
    root.__PlasmicFunctionsRegistry = [
      {
        function: async () => [],
        meta: {
          name: "dataFunc",
          importPath: "@pkg/data",
          fnContext: () => ({ dataKey: "items", fetcher: async () => [] }),
        },
      },
    ];

    const result = getFunctionRegistry();
    expect(result[0].name).toBe("dataFunc");
    expect(result[0]).not.toHaveProperty("fnContext");
  });

  it("handles malformed entries gracefully", () => {
    root.__PlasmicFunctionsRegistry = [
      null,
      undefined,
      "invalid",
      { function: () => {} }, // no meta
      { function: () => {}, meta: { name: "Valid" } },
    ];

    const result = getFunctionRegistry();
    expect(result).toHaveLength(5);
    expect(result[0].name).toBe("");
    expect(result[4].name).toBe("Valid");
  });
});

describe("getTokenRegistry", () => {
  beforeEach(cleanRegistries);
  afterEach(cleanRegistries);

  it("returns empty array when no registrations exist", () => {
    expect(getTokenRegistry()).toEqual([]);
  });

  it("returns empty array when registry is not an array", () => {
    root.__PlasmicTokenRegistry = "invalid";
    expect(getTokenRegistry()).toEqual([]);

    root.__PlasmicTokenRegistry = {};
    expect(getTokenRegistry()).toEqual([]);

    root.__PlasmicTokenRegistry = null;
    expect(getTokenRegistry()).toEqual([]);
  });

  it("reads from globalThis and preserves all fields", () => {
    root.__PlasmicTokenRegistry = [
      {
        name: "primary-color",
        value: "#3B82F6",
        type: "color",
        displayName: "Primary Color",
        selector: ":root",
      },
      {
        name: "spacing-md",
        value: "16px",
        type: "spacing",
      },
    ];

    const result = getTokenRegistry();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "primary-color",
      value: "#3B82F6",
      type: "color",
      displayName: "Primary Color",
      selector: ":root",
    });
    expect(result[1]).toEqual({
      name: "spacing-md",
      value: "16px",
      type: "spacing",
    });
  });

  it("filters out malformed entries", () => {
    root.__PlasmicTokenRegistry = [
      null,
      undefined,
      "invalid",
      { name: "missing-value" }, // no value field
      { name: "valid", value: "#fff", type: "color" },
    ];

    const result = getTokenRegistry();
    // Only the last entry is valid
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("valid");
  });

  it("preserves all token types", () => {
    const tokenTypes = [
      "color",
      "spacing",
      "font-family",
      "font-size",
      "line-height",
      "opacity",
    ];

    root.__PlasmicTokenRegistry = tokenTypes.map((t) => ({
      name: `token-${t}`,
      value: "test",
      type: t,
    }));

    const result = getTokenRegistry();
    expect(result).toHaveLength(6);
    result.forEach((token, i) => {
      expect(token.type).toBe(tokenTypes[i]);
    });
  });
});

describe("getTraitRegistry", () => {
  beforeEach(cleanRegistries);
  afterEach(cleanRegistries);

  it("returns empty array when no registrations exist", () => {
    expect(getTraitRegistry()).toEqual([]);
  });

  it("returns empty array when registry is not an array", () => {
    root.__PlasmicTraitRegistry = "invalid";
    expect(getTraitRegistry()).toEqual([]);

    root.__PlasmicTraitRegistry = {};
    expect(getTraitRegistry()).toEqual([]);

    root.__PlasmicTraitRegistry = null;
    expect(getTraitRegistry()).toEqual([]);
  });

  it("reads BasicTrait entries correctly", () => {
    root.__PlasmicTraitRegistry = [
      {
        trait: "color-scheme",
        meta: { label: "Color Scheme", type: "text" },
      },
      {
        trait: "priority",
        meta: { label: "Priority", type: "number" },
      },
      {
        trait: "featured",
        meta: { type: "boolean" },
      },
    ];

    const result = getTraitRegistry();
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      trait: "color-scheme",
      meta: { label: "Color Scheme", type: "text" },
    });
    expect(result[1]).toEqual({
      trait: "priority",
      meta: { label: "Priority", type: "number" },
    });
    expect(result[2]).toEqual({
      trait: "featured",
      meta: { type: "boolean" },
    });
  });

  it("reads ChoiceTrait entries correctly", () => {
    root.__PlasmicTraitRegistry = [
      {
        trait: "size",
        meta: {
          label: "Size",
          type: "choice",
          options: ["small", "medium", "large"],
        },
      },
    ];

    const result = getTraitRegistry();
    expect(result).toHaveLength(1);
    expect(result[0].trait).toBe("size");
    expect(result[0].meta).toEqual({
      label: "Size",
      type: "choice",
      options: ["small", "medium", "large"],
    });
  });

  it("filters out malformed entries", () => {
    root.__PlasmicTraitRegistry = [
      null,
      undefined,
      "invalid",
      { trait: "no-meta" }, // no meta
      { meta: { type: "text" } }, // no trait string
      { trait: "valid", meta: { type: "boolean" } },
    ];

    const result = getTraitRegistry();
    // Only the last entry is valid
    expect(result).toHaveLength(1);
    expect(result[0].trait).toBe("valid");
  });
});

describe("getFullRegistry", () => {
  beforeEach(cleanRegistries);
  afterEach(cleanRegistries);

  it("returns all five registries in one call", () => {
    root.__PlasmicComponentRegistry = [
      {
        component: function Btn() {},
        meta: { name: "Button", importPath: "@pkg/btn" },
      },
    ];
    root.__PlasmicContextRegistry = [
      {
        component: function Prov() {},
        meta: { name: "Provider", importPath: "@pkg/prov" },
      },
    ];
    root.__PlasmicFunctionsRegistry = [
      {
        function: async () => [],
        meta: { name: "fetchData", importPath: "@pkg/data" },
      },
    ];
    root.__PlasmicTokenRegistry = [
      { name: "primary", value: "#000", type: "color" },
    ];
    root.__PlasmicTraitRegistry = [
      { trait: "size", meta: { type: "text" } },
    ];

    const result = getFullRegistry();

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe("Button");
    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0].name).toBe("Provider");
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("fetchData");
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].name).toBe("primary");
    expect(result.traits).toHaveLength(1);
    expect(result.traits[0].trait).toBe("size");
  });

  it("returns empty arrays when no registrations exist", () => {
    const result = getFullRegistry();

    expect(result.components).toEqual([]);
    expect(result.contexts).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.tokens).toEqual([]);
    expect(result.traits).toEqual([]);
  });

  it("handles mixed populated and empty registries", () => {
    root.__PlasmicComponentRegistry = [
      {
        component: function Comp() {},
        meta: { name: "Comp" },
      },
    ];
    // Others left undefined

    const result = getFullRegistry();

    expect(result.components).toHaveLength(1);
    expect(result.contexts).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.tokens).toEqual([]);
    expect(result.traits).toEqual([]);
  });
});
