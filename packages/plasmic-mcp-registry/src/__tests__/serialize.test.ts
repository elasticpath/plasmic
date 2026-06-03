import { describe, it, expect } from "vitest";
import { serializeComponentMeta } from "../serialize";

describe("serializeComponentMeta", () => {
  it("preserves JSON-serializable fields", () => {
    const meta = {
      name: "MyComponent",
      displayName: "My Component",
      description: "A test component",
      importPath: "@pkg/my-component",
      isDefaultExport: true,
      classNameProp: "className",
      defaultStyles: { display: "flex" },
      variants: {
        selected: { cssSelector: "[data-selected]", displayName: "Selected" },
      },
      props: {
        label: { type: "string", defaultValue: "Click me" },
        count: { type: "number", defaultValue: 0 },
      },
    };

    const result = serializeComponentMeta(meta);

    expect(result.name).toBe("MyComponent");
    expect(result.displayName).toBe("My Component");
    expect(result.description).toBe("A test component");
    expect(result.importPath).toBe("@pkg/my-component");
    expect(result.isDefaultExport).toBe(true);
    expect(result.classNameProp).toBe("className");
    expect(result.defaultStyles).toEqual({ display: "flex" });
    expect(result.variants).toEqual({
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    });
    expect(result.props).toEqual({
      label: { type: "string", defaultValue: "Click me" },
      count: { type: "number", defaultValue: 0 },
    });
  });

  it("strips non-serializable top-level fields", () => {
    const meta = {
      name: "TestComp",
      figmaPropsTransform: () => ({}),
      treeLabel: () => "label",
      componentHelpers: { initFunc: () => {} },
      refActions: { focus: { type: "method", argTypes: [] } },
      actions: [{ type: "button-action", label: "Click", onClick: () => {} }],
      templates: { child: { type: "div" } },
    };

    const result = serializeComponentMeta(meta);

    expect(result.name).toBe("TestComp");
    expect(result).not.toHaveProperty("figmaPropsTransform");
    expect(result).not.toHaveProperty("treeLabel");
    expect(result).not.toHaveProperty("componentHelpers");
    expect(result).not.toHaveProperty("refActions");
    expect(result).not.toHaveProperty("actions");
    expect(result).not.toHaveProperty("templates");
  });

  it("strips functions nested inside props definitions", () => {
    const meta = {
      name: "PropsTest",
      props: {
        label: {
          type: "string",
          displayName: "Label",
          defaultValue: "Hello",
          hidden: () => false,
          validator: (value: unknown) => true,
        },
        count: {
          type: "number",
          min: 0,
          max: 100,
          readOnly: () => true,
          defaultValueHint: () => 42,
        },
        options: {
          type: "choice",
          options: ["a", "b", "c"],
          onSearch: () => {},
        },
      },
    };

    const result = serializeComponentMeta(meta);

    // Declarative parts preserved
    expect(result.props).toBeDefined();
    const props = result.props as Record<string, Record<string, unknown>>;
    expect(props.label.type).toBe("string");
    expect(props.label.displayName).toBe("Label");
    expect(props.label.defaultValue).toBe("Hello");
    expect(props.count.type).toBe("number");
    expect(props.count.min).toBe(0);
    expect(props.count.max).toBe(100);
    expect(props.options.type).toBe("choice");
    expect(props.options.options).toEqual(["a", "b", "c"]);

    // Functions stripped
    expect(props.label).not.toHaveProperty("hidden");
    expect(props.label).not.toHaveProperty("validator");
    expect(props.count).not.toHaveProperty("readOnly");
    expect(props.count).not.toHaveProperty("defaultValueHint");
    expect(props.options).not.toHaveProperty("onSearch");
  });

  it("degrades a choice prop with function options to a valid string control", () => {
    const meta = {
      name: "DynamicChoice",
      props: {
        template: {
          type: "choice",
          displayName: "Template",
          description: "Pick a template",
          advanced: false,
          allowSearch: true,
          options: (_props: unknown, _ctx: unknown) => [
            { label: "Iso Standard", value: "products(iso-standard)" },
          ],
        },
        kind: {
          type: "choice",
          options: ["a", "b"],
          defaultValue: "a",
        },
      },
    };

    const result = serializeComponentMeta(meta);
    const props = result.props as Record<string, Record<string, unknown>>;

    // Function-options choice degrades to a string control (no invalid empty choice)
    expect(props.template.type).toBe("string");
    expect(props.template).not.toHaveProperty("options");
    expect(props.template).not.toHaveProperty("allowSearch");
    // Display metadata is preserved so the prop stays usable/labelled
    expect(props.template.displayName).toBe("Template");
    expect(props.template.description).toBe("Pick a template");

    // Static (array) choice is untouched
    expect(props.kind.type).toBe("choice");
    expect(props.kind.options).toEqual(["a", "b"]);
    expect(props.kind.defaultValue).toBe("a");
  });

  it("handles meta with variants field preserved correctly", () => {
    const meta = {
      name: "VariantComp",
      variants: {
        selected: { cssSelector: "[data-selected]", displayName: "Selected" },
        disabled: { cssSelector: ":disabled", displayName: "Disabled" },
        hovered: { cssSelector: ":hover", displayName: "Hovered" },
      },
    };

    const result = serializeComponentMeta(meta);
    expect(result.variants).toEqual(meta.variants);
    expect(Object.keys(result.variants!)).toHaveLength(3);
  });

  it("handles meta without variants field", () => {
    const meta = {
      name: "NoVariantComp",
      props: { label: { type: "string" } },
    };

    const result = serializeComponentMeta(meta);
    expect(result.variants).toBeUndefined();
  });

  it("returns minimal object for null/undefined input", () => {
    expect(serializeComponentMeta(null)).toEqual({ name: "" });
    expect(serializeComponentMeta(undefined)).toEqual({ name: "" });
  });

  it("returns minimal object for non-object input", () => {
    expect(serializeComponentMeta("string")).toEqual({ name: "" });
    expect(serializeComponentMeta(42)).toEqual({ name: "" });
    expect(serializeComponentMeta(true)).toEqual({ name: "" });
  });

  it("handles malformed meta with missing name", () => {
    const meta = { props: { label: { type: "string" } } };
    const result = serializeComponentMeta(meta);
    expect(result.name).toBe("");
  });

  it("preserves boolean and array values in styleSections", () => {
    const meta1 = { name: "A", styleSections: true };
    expect(serializeComponentMeta(meta1).styleSections).toBe(true);

    const meta2 = {
      name: "B",
      styleSections: [{ section: "sizing", expanded: true }],
    };
    expect(serializeComponentMeta(meta2).styleSections).toEqual([
      { section: "sizing", expanded: true },
    ]);
  });

  it("preserves figmaMappings array", () => {
    const meta = {
      name: "FigmaComp",
      figmaMappings: [{ figmaComponentName: "Button" }],
    };
    const result = serializeComponentMeta(meta);
    expect(result.figmaMappings).toEqual([{ figmaComponentName: "Button" }]);
  });

  it("strips top-level function fields not in the explicit list", () => {
    const meta = {
      name: "FuncTest",
      someCustomFunc: () => "hello",
      normalField: "preserved",
    };
    const result = serializeComponentMeta(meta);
    expect(result).not.toHaveProperty("someCustomFunc");
    expect(result.normalField).toBe("preserved");
  });

  it("handles states with function fields stripped", () => {
    const meta = {
      name: "StateComp",
      states: {
        isOpen: {
          type: "writable",
          valueProp: "open",
          onChangeProp: "onOpenChange",
          hidden: () => false,
        },
      },
    };

    const result = serializeComponentMeta(meta);
    const states = result.states as Record<string, Record<string, unknown>>;
    expect(states.isOpen.type).toBe("writable");
    expect(states.isOpen.valueProp).toBe("open");
    expect(states.isOpen.onChangeProp).toBe("onOpenChange");
    expect(states.isOpen).not.toHaveProperty("hidden");
  });
});
