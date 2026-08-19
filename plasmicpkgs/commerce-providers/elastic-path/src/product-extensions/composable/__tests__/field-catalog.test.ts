/**
 * Unit tests for the address catalog and the dropdown option-builders. Pure
 * data helpers — no React or @plasmicapp/host involved.
 */
import {
  PRODUCT_FIELD_LEAVES,
  buildFieldOptions,
  buildLeafOptions,
  buildTemplateOptions,
  getProductFieldLeaf,
} from "../field-catalog";
import { normalizeExtensions } from "../../../utils/field-format";

describe("PRODUCT_FIELD_LEAVES", () => {
  it("has unique leaf ids", () => {
    const ids = PRODUCT_FIELD_LEAVES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps the price leaf to a currency-formatted scalar with a currency path", () => {
    expect(getProductFieldLeaf("price")).toMatchObject({
      path: ["meta", "display_price", "without_tax", "float_price"],
      defaultFormat: "currency",
      currencyPath: ["meta", "display_price", "without_tax", "currency"],
    });
  });

  it("never points a money leaf at Elastic Path's minor-unit amount", () => {
    // `amount` is 4999 where `float_price` is 49.99 — a leaf pointing at the
    // former renders every price 100x too large, and canvas looks fine.
    for (const leaf of PRODUCT_FIELD_LEAVES) {
      if (leaf.defaultFormat === "currency" || leaf.defaultFormat === "number") {
        expect(leaf.path).not.toContain("amount");
      }
    }
  });

  it("exposes the first image as a flattened array-path leaf", () => {
    expect(getProductFieldLeaf("firstImageUrl")?.path).toEqual([
      "images",
      0,
      "url",
    ]);
  });

  it("returns undefined for an unknown id", () => {
    expect(getProductFieldLeaf("nope")).toBeUndefined();
  });
});

describe("buildLeafOptions", () => {
  it("returns a { label, value } option per leaf, preserving order", () => {
    const options = buildLeafOptions();
    expect(options).toHaveLength(PRODUCT_FIELD_LEAVES.length);
    expect(options[0]).toEqual({ label: "Name", value: "name" });
    expect(options).toContainEqual({
      label: "Price (formatted)",
      value: "price",
    });
  });
});

describe("extension dropdown builders", () => {
  const templates = normalizeExtensions({
    "products(care-and-materials)": { material: "Cotton", care: "Wash cold" },
    "products(metrics)": { rating: 4.7 },
  });

  it("builds template options as { humanized label, raw slug value }", () => {
    expect(buildTemplateOptions(templates)).toEqual([
      { label: "Care And Materials", value: "products(care-and-materials)" },
      { label: "Metrics", value: "products(metrics)" },
    ]);
  });

  it("returns an empty list for undefined templates", () => {
    expect(buildTemplateOptions(undefined)).toEqual([]);
  });

  it("builds field options for the selected template", () => {
    expect(
      buildFieldOptions(templates, "products(care-and-materials)"),
    ).toEqual([
      { label: "Material", value: "material" },
      { label: "Care", value: "care" },
    ]);
  });

  it("returns an empty list for an unknown or unselected template", () => {
    expect(buildFieldOptions(templates, "products(nope)")).toEqual([]);
    expect(buildFieldOptions(templates, undefined)).toEqual([]);
  });
});
