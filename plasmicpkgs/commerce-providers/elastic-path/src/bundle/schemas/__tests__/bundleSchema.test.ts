/**
 * @jest-environment jsdom
 */

// Mock the logger
jest.mock("../../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const {
  createBundleSchema,
  createOptionQuantitySchema,
  createBundleDefaultValues,
} = require("../bundleSchema");

describe("createBundleSchema", () => {
  it("creates a schema for simple components", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [{ id: "opt-1", quantity: 1 }],
      },
    };

    const schema = createBundleSchema(components);
    expect(schema).toBeDefined();
    expect(schema.parse).toBeDefined();
  });

  it("validates that required components have minimum selections", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [{ id: "opt-1", quantity: 1 }],
      },
    };

    const schema = createBundleSchema(components);

    // Empty selections should fail for required component
    const result = schema.safeParse({ processor: {} });
    expect(result.success).toBe(false);
  });

  it("accepts valid selections for required component", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [{ id: "opt-1", quantity: 1 }],
      },
    };

    const schema = createBundleSchema(components);

    const result = schema.safeParse({ processor: { "opt-1": 1 } });
    expect(result.success).toBe(true);
  });

  it("rejects selections exceeding max", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [
          { id: "opt-1", quantity: 1 },
          { id: "opt-2", quantity: 1 },
        ],
      },
    };

    const schema = createBundleSchema(components);

    // Two selections in max=1 component
    const result = schema.safeParse({
      processor: { "opt-1": 1, "opt-2": 1 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional components with no selections", () => {
    const components = {
      extras: {
        name: "Extras",
        min: 0,
        max: 3,
        options: [{ id: "ext-1", quantity: 1 }],
      },
    };

    const schema = createBundleSchema(components);

    const result = schema.safeParse({ extras: {} });
    expect(result.success).toBe(true);
  });

  it("validates option-level quantity constraints", () => {
    const components = {
      memory: {
        name: "Memory",
        min: 1,
        max: 4,
        options: [
          { id: "mem-1", quantity: 1, min: 1, max: 4 },
          { id: "mem-2", quantity: 1, min: 1, max: 2 },
        ],
      },
    };

    const schema = createBundleSchema(components);

    // Exceeding option-level max
    const result = schema.safeParse({
      memory: { "mem-2": 5 }, // max for mem-2 is 2
    });
    expect(result.success).toBe(false);
  });

  it("handles components with null min/max", () => {
    const components = {
      processor: {
        name: "Processor",
        min: null,
        max: null,
        options: [{ id: "opt-1", quantity: 1 }],
      },
    };

    const schema = createBundleSchema(components);
    // null min/max should default to 0/MAX_SAFE_INTEGER
    const result = schema.safeParse({ processor: {} });
    expect(result.success).toBe(true);
  });

  it("uses component key as name when name is not provided", () => {
    const components = {
      processor: {
        min: 1,
        max: 1,
        options: [{ id: "opt-1", quantity: 1 }],
      },
    };

    const schema = createBundleSchema(components);
    const result = schema.safeParse({ processor: {} });
    expect(result.success).toBe(false);
    // Error message should contain the component key
    const errors = result.error?.issues || [];
    const hasKeyInMessage = errors.some(
      (e: any) => e.message?.includes("processor") || e.path?.includes("processor")
    );
    expect(hasKeyInMessage).toBe(true);
  });

  it("handles parent:child option IDs in validation", () => {
    const components = {
      storage: {
        name: "Storage",
        min: 1,
        max: 2,
        options: [
          { id: "parent-1", quantity: 1, min: 1, max: 1 },
        ],
      },
    };

    const schema = createBundleSchema(components);
    // parent:child key — the base option ID (parent-1) should be used for constraint check
    const result = schema.safeParse({
      storage: { "parent-1:child-1": 1 },
    });
    expect(result.success).toBe(true);
  });
});

describe("createOptionQuantitySchema", () => {
  it("creates schema with min/max from option", () => {
    const schema = createOptionQuantitySchema({
      id: "opt-1",
      min: 1,
      max: 4,
      quantity: 1,
    });

    expect(schema.safeParse(1).success).toBe(true);
    expect(schema.safeParse(4).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(5).success).toBe(false);
  });

  it("defaults min to 1 when option.min is null", () => {
    const schema = createOptionQuantitySchema({
      id: "opt-1",
      min: null,
      max: 4,
      quantity: 1,
    });

    expect(schema.safeParse(1).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(false);
  });

  it("defaults max to option.quantity when option.max is null", () => {
    const schema = createOptionQuantitySchema({
      id: "opt-1",
      min: 1,
      max: null,
      quantity: 3,
    });

    expect(schema.safeParse(3).success).toBe(true);
    expect(schema.safeParse(4).success).toBe(false);
  });
});

describe("createBundleDefaultValues", () => {
  const baseComponents = {
    processor: {
      name: "Processor",
      min: 1,
      max: 1,
      options: [
        { id: "opt-1", quantity: 1, default: true },
        { id: "opt-2", quantity: 1, default: false },
      ],
    },
    memory: {
      name: "Memory",
      min: 0,
      max: 4,
      options: [
        { id: "mem-1", quantity: 1, default: true },
      ],
    },
  };

  it("auto-selects default options for required components", () => {
    const result = createBundleDefaultValues(baseComponents);

    expect(result.processor).toEqual({ "opt-1": 1 });
  });

  it("does not auto-select for optional components", () => {
    const result = createBundleDefaultValues(baseComponents);

    // memory is optional (min=0), should have empty object
    expect(result.memory).toEqual({});
  });

  it("uses defaultConfiguration (base64 JSON) as highest priority", () => {
    const config = { processor: { "opt-2": 1 } };
    const defaultConfiguration = btoa(JSON.stringify(config));

    const result = createBundleDefaultValues(
      baseComponents,
      undefined,
      defaultConfiguration
    );

    // opt-2 from defaultConfiguration, not opt-1 from default
    expect(result.processor).toEqual({ "opt-2": 1 });
  });

  it("uses API bundle_configuration as second priority", () => {
    const bundleProduct = {
      meta: {
        bundle_configuration: {
          selected_options: {
            processor: { "opt-2": BigInt(1) },
          },
        },
      },
    };

    const result = createBundleDefaultValues(baseComponents, bundleProduct);

    expect(result.processor).toEqual({ "opt-2": 1 });
  });

  it("converts BigInt values from API to numbers", () => {
    const bundleProduct = {
      meta: {
        bundle_configuration: {
          selected_options: {
            processor: { "opt-1": BigInt(3) },
          },
        },
      },
    };

    const result = createBundleDefaultValues(baseComponents, bundleProduct);

    expect(result.processor["opt-1"]).toBe(3);
    expect(typeof result.processor["opt-1"]).toBe("number");
  });

  it("defaultConfiguration overrides API configuration", () => {
    const config = { processor: { "opt-2": 1 } };
    const defaultConfiguration = btoa(JSON.stringify(config));
    const bundleProduct = {
      meta: {
        bundle_configuration: {
          selected_options: {
            processor: { "opt-1": BigInt(1) },
          },
        },
      },
    };

    const result = createBundleDefaultValues(
      baseComponents,
      bundleProduct,
      defaultConfiguration
    );

    // defaultConfiguration wins — processor has opt-2
    // But API also writes opt-1 because it checks !defaults[key] — since
    // defaultConfiguration already set processor, API won't override
    expect(result.processor["opt-2"]).toBe(1);
  });

  it("ensures all components have at least an empty object", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 0,
        max: 1,
        options: [{ id: "opt-1", quantity: 1 }],
      },
      extras: {
        name: "Extras",
        min: 0,
        max: 5,
        options: [],
      },
    };

    const result = createBundleDefaultValues(components);

    expect(result.processor).toBeDefined();
    expect(result.extras).toBeDefined();
    expect(result.extras).toEqual({});
  });

  it("falls back to first option when no option is marked as default", () => {
    const components = {
      processor: {
        name: "Processor",
        min: 1,
        max: 1,
        options: [
          { id: "opt-a", quantity: 1, default: false },
          { id: "opt-b", quantity: 1, default: false },
        ],
      },
    };

    const result = createBundleDefaultValues(components);

    expect(result.processor).toEqual({ "opt-a": 1 });
  });

  it("handles invalid base64 defaultConfiguration gracefully", () => {
    const result = createBundleDefaultValues(
      baseComponents,
      undefined,
      "not-valid-base64!!!"
    );

    // Should fall through to auto-select defaults
    expect(result.processor).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Regression: the issue path, and what reads it
// ---------------------------------------------------------------------------
describe("createBundleSchema — issue paths", () => {
  const components = {
    games: {
      name: "Games",
      min: 2,
      max: 2,
      options: [
        { id: "game-a", quantity: 1 },
        { id: "game-b", quantity: 1 },
        { id: "game-c", quantity: 1 },
      ],
    },
  };

  it("reports a shortfall against the component key, not nested under itself", () => {
    // `refine`'s `path` is relative to the schema being refined, so
    // `path: [componentKey]` produced ["games","games"]. react-hook-form then
    // stored the error where useBundleForm never looked, and every invalid
    // bundle read as valid.
    const result = createBundleSchema(components).safeParse({ games: {} });

    expect(result.success).toBe(false);
    expect(result.error.issues.map((i: any) => i.path)).toEqual([["games"]]);
  });

  it("names the component and the shortfall in the message", () => {
    const result = createBundleSchema(components).safeParse({
      games: { "game-a": 1 },
    });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe(
      "Please select exactly 2 options for Games"
    );
    expect(result.error.issues[0].path).toEqual(["games"]);
  });

  it("reports too many selections against the component key", () => {
    const result = createBundleSchema({
      material: {
        name: "Material",
        min: 1,
        max: 1,
        options: [{ id: "chrome", quantity: 1 }, { id: "plastic", quantity: 1 }],
      },
    }).safeParse({ material: { chrome: 1, plastic: 1 } });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(["material"]);
    expect(result.error.issues[0].message).toBe(
      "Please remove 1 option from Material (maximum: 1)"
    );
  });

  it("counts a remaining shortfall of more than one", () => {
    const result = createBundleSchema({
      picks: {
        name: "Picks",
        min: 3,
        max: 5,
        options: [{ id: "a", quantity: 1 }],
      },
    }).safeParse({ picks: { a: 1 } });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe(
      "Please select 2 more options for Picks (minimum: 3)"
    );
  });

  it("accepts a satisfied component", () => {
    const result = createBundleSchema(components).safeParse({
      games: { "game-a": 1, "game-b": 1 },
    });
    expect(result.success).toBe(true);
  });
});

describe("createBundleDefaultValues — priority chain", () => {
  const components = {
    material: {
      name: "Material",
      min: 1,
      max: 1,
      options: [{ id: "parent-1", quantity: 1 }],
    },
  };

  it("does not let the API configuration reappear beside a higher-priority choice", () => {
    // The catalog's own configuration used to be merged option-by-option, so a
    // chosen variation ("parent:child") kept the bare parent alongside it and
    // Elastic Path rejected the add with "too many selections".
    const chosen = btoa(JSON.stringify({ material: { "parent-1:child-9": 1 } }));
    const bundleProduct = {
      meta: {
        bundle_configuration: {
          selected_options: { material: { "parent-1": 1 } },
        },
      },
    };

    const defaults = createBundleDefaultValues(
      components,
      bundleProduct,
      chosen
    );

    expect(defaults.material).toEqual({ "parent-1:child-9": 1 });
  });

  it("still uses the API configuration for components nobody has spoken for", () => {
    const bundleProduct = {
      meta: {
        bundle_configuration: {
          selected_options: { material: { "parent-1": 1 } },
        },
      },
    };

    const defaults = createBundleDefaultValues(components, bundleProduct);

    expect(defaults.material).toEqual({ "parent-1": 1 });
  });
});
