/**
 * Unit tests for the pure formatting/normalization helpers backing the
 * EPProductExtensions composable. No React or @plasmicapp/host involved.
 */
import {
  humanizeTemplateSlug,
  humanizeFieldKey,
  inferType,
  formatDisplayValue,
  normalizeExtensions,
} from "../format";

describe("humanizeTemplateSlug", () => {
  it("strips the entity prefix and parens, title-cases the inner name", () => {
    expect(humanizeTemplateSlug("products(example-template-2)")).toBe(
      "Example Template 2",
    );
  });

  it("handles underscores as word separators", () => {
    expect(humanizeTemplateSlug("products(care_and_materials)")).toBe(
      "Care And Materials",
    );
  });

  it("falls back to the raw slug when there are no parens", () => {
    expect(humanizeTemplateSlug("care-and-materials")).toBe(
      "Care And Materials",
    );
  });

  it("returns empty string for empty input", () => {
    expect(humanizeTemplateSlug("")).toBe("");
  });
});

describe("humanizeFieldKey", () => {
  it("capitalizes a single lowercase word", () => {
    expect(humanizeFieldKey("name")).toBe("Name");
  });

  it("splits camelCase into words", () => {
    expect(humanizeFieldKey("productCare")).toBe("Product Care");
  });

  it("splits snake_case and kebab-case", () => {
    expect(humanizeFieldKey("eco_rating")).toBe("Eco Rating");
    expect(humanizeFieldKey("dimensions-cm")).toBe("Dimensions Cm");
  });

  it("handles letter/number boundaries from camelCase", () => {
    expect(humanizeFieldKey("co2Footprint")).toBe("Co2 Footprint");
  });

  it("returns empty string for empty input", () => {
    expect(humanizeFieldKey("")).toBe("");
  });
});

describe("inferType", () => {
  it.each([
    ["string", "hello", "string"],
    ["number", 42, "number"],
    ["boolean", true, "boolean"],
    ["null", null, "null"],
    ["undefined -> null", undefined, "null"],
    ["array", [1, 2], "array"],
    ["object", { a: 1 }, "object"],
  ])("classifies %s", (_label, value, expected) => {
    expect(inferType(value)).toBe(expected);
  });
});

describe("formatDisplayValue", () => {
  it("passes strings through unchanged", () => {
    expect(formatDisplayValue("Organic cotton")).toBe("Organic cotton");
  });

  it("renders booleans as Yes/No", () => {
    expect(formatDisplayValue(true)).toBe("Yes");
    expect(formatDisplayValue(false)).toBe("No");
  });

  it("renders null/undefined as empty string", () => {
    expect(formatDisplayValue(null)).toBe("");
    expect(formatDisplayValue(undefined)).toBe("");
  });

  it("formats numbers via toLocaleString", () => {
    expect(formatDisplayValue(1299)).toBe((1299).toLocaleString());
  });

  it("joins primitive arrays with commas, skipping empties", () => {
    expect(formatDisplayValue(["red", "green", "blue"])).toBe(
      "red, green, blue",
    );
    expect(formatDisplayValue([1, 2, 3])).toBe("1, 2, 3");
  });

  it("renders a shallow object as humanized key: value pairs", () => {
    expect(formatDisplayValue({ width_cm: 30, in_stock: true })).toBe(
      "Width Cm: 30, In Stock: Yes",
    );
  });

  it("falls back to JSON for deeply nested objects", () => {
    const nested = { spec: { cpu: "x" } };
    expect(formatDisplayValue(nested)).toBe(JSON.stringify(nested));
  });

  it("renders an empty object as empty string", () => {
    expect(formatDisplayValue({})).toBe("");
  });
});

describe("normalizeExtensions", () => {
  it("returns an empty array for null/undefined", () => {
    expect(normalizeExtensions(null)).toEqual([]);
    expect(normalizeExtensions(undefined)).toEqual([]);
  });

  it("normalizes the canonical EP shape into templates + fields", () => {
    const result = normalizeExtensions({
      "products(example-template-2)": { name: "my name" },
    });

    expect(result).toHaveLength(1);
    const [template] = result;
    expect(template.slug).toBe("products(example-template-2)");
    expect(template.label).toBe("Example Template 2");
    expect(template.fieldCount).toBe(1);
    expect(template.fields).toEqual([
      {
        key: "name",
        label: "Name",
        value: "my name",
        type: "string",
        displayValue: "my name",
      },
    ]);
  });

  it("normalizes multiple templates with mixed value types", () => {
    const result = normalizeExtensions({
      "products(care)": { material: "Organic cotton", is_fair_trade: true },
      "products(metrics)": { rating: 4.7 },
    });

    expect(result.map((t) => t.label)).toEqual(["Care", "Metrics"]);
    const care = result[0];
    expect(care.fields.map((f) => f.type)).toEqual(["string", "boolean"]);
    expect(
      care.fields.find((f) => f.key === "is_fair_trade")?.displayValue,
    ).toBe("Yes");
    expect(result[1].fields[0]).toMatchObject({
      key: "rating",
      type: "number",
      displayValue: (4.7).toLocaleString(),
    });
  });

  it("treats a non-object template group as having zero fields", () => {
    const result = normalizeExtensions({
      "products(weird)": "not-an-object" as unknown as Record<string, unknown>,
    });
    expect(result).toHaveLength(1);
    expect(result[0].fieldCount).toBe(0);
    expect(result[0].fields).toEqual([]);
  });
});
