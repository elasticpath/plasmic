import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getComponentRegistry } from "../read-registry";

describe("getComponentRegistry", () => {
  const root = globalThis as Record<string, unknown>;

  beforeEach(() => {
    // Clean slate for each test
    delete root.__PlasmicComponentRegistry;
  });

  afterEach(() => {
    delete root.__PlasmicComponentRegistry;
  });

  it("returns empty array when no registrations exist", () => {
    expect(getComponentRegistry()).toEqual([]);
  });

  it("returns empty array when registry is not an array", () => {
    root.__PlasmicComponentRegistry = "invalid";
    expect(getComponentRegistry()).toEqual([]);

    root.__PlasmicComponentRegistry = {};
    expect(getComponentRegistry()).toEqual([]);

    root.__PlasmicComponentRegistry = null;
    expect(getComponentRegistry()).toEqual([]);
  });

  it("reads from globalThis.__PlasmicComponentRegistry and returns correct shape", () => {
    root.__PlasmicComponentRegistry = [
      {
        component: function MyButton() {},
        meta: {
          name: "MyButton",
          displayName: "My Button",
          importPath: "@pkg/button",
          props: { label: { type: "string" } },
        },
      },
    ];

    const result = getComponentRegistry();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("MyButton");
    expect(result[0].displayName).toBe("My Button");
    expect(result[0].importPath).toBe("@pkg/button");
    expect(result[0].props).toEqual({ label: { type: "string" } });
  });

  it("strips component reference (React component function)", () => {
    root.__PlasmicComponentRegistry = [
      {
        component: function MyComp() {},
        meta: { name: "MyComp", importPath: "@pkg/comp" },
      },
    ];

    const result = getComponentRegistry();
    // The component function is not part of the meta and should not appear
    expect(result[0]).not.toHaveProperty("component");
  });

  it("preserves variants field correctly", () => {
    root.__PlasmicComponentRegistry = [
      {
        component: function OptionCard() {},
        meta: {
          name: "EPBundleOptionTrigger$dev",
          importPath: "@pkg/ep",
          props: {},
          variants: {
            selected: {
              cssSelector: "[data-selected]",
              displayName: "Selected",
            },
            disabled: { cssSelector: ":disabled", displayName: "Disabled" },
          },
        },
      },
    ];

    const result = getComponentRegistry();
    expect(result[0].variants).toEqual({
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
      disabled: { cssSelector: ":disabled", displayName: "Disabled" },
    });
  });

  it("handles entry without variants field", () => {
    root.__PlasmicComponentRegistry = [
      {
        component: function Plain() {},
        meta: { name: "Plain", importPath: "@pkg/plain", props: {} },
      },
    ];

    const result = getComponentRegistry();
    expect(result[0].variants).toBeUndefined();
  });

  it("handles duplicate component names (all entries returned)", () => {
    root.__PlasmicComponentRegistry = [
      {
        component: function V1() {},
        meta: { name: "Button", importPath: "@pkg/v1", props: {} },
      },
      {
        component: function V2() {},
        meta: { name: "Button", importPath: "@pkg/v2", props: {} },
      },
    ];

    const result = getComponentRegistry();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Button");
    expect(result[1].name).toBe("Button");
    expect(result[0].importPath).toBe("@pkg/v1");
    expect(result[1].importPath).toBe("@pkg/v2");
  });

  it("handles malformed entries gracefully", () => {
    root.__PlasmicComponentRegistry = [
      null,
      undefined,
      "invalid",
      { component: function A() {} }, // no meta
      { component: function B() {}, meta: null },
      { component: function C() {}, meta: { name: "Valid", importPath: "@pkg/valid" } },
    ];

    const result = getComponentRegistry();
    expect(result).toHaveLength(6);
    // Malformed entries get minimal shape
    expect(result[0].name).toBe("");
    expect(result[1].name).toBe("");
    expect(result[2].name).toBe("");
    expect(result[3].name).toBe("");
    expect(result[4].name).toBe("");
    // Valid entry
    expect(result[5].name).toBe("Valid");
  });

  it("strips non-serializable fields from meta", () => {
    root.__PlasmicComponentRegistry = [
      {
        component: function Comp() {},
        meta: {
          name: "Comp",
          importPath: "@pkg/comp",
          props: {
            label: { type: "string", hidden: () => false },
          },
          figmaPropsTransform: () => ({}),
          componentHelpers: { initFunc: () => {} },
          templates: { child: {} },
        },
      },
    ];

    const result = getComponentRegistry();
    expect(result[0]).not.toHaveProperty("figmaPropsTransform");
    expect(result[0]).not.toHaveProperty("componentHelpers");
    expect(result[0]).not.toHaveProperty("templates");
    // Nested function in props stripped
    const props = result[0].props as Record<string, Record<string, unknown>>;
    expect(props.label).not.toHaveProperty("hidden");
    expect(props.label.type).toBe("string");
  });
});
