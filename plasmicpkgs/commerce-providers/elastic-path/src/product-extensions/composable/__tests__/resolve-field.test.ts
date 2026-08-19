/**
 * Unit tests for the field resolvers. Pure functions — given a product (or
 * normalized templates) and an address, they return a ResolvedField. No React
 * or @plasmicapp/host involved.
 */
import { MOCK_PRODUCT } from "../../../utils/extensions-mock";
import { normalizeExtensions } from "../../../utils/field-format";
import {
  resolveExtensionField,
  resolveTopLevelField,
} from "../resolve-field";
import type { Product } from "../../../types/product";
import { mockProduct } from "../../../utils/design-time-data";

const product: Product = mockProduct({
  id: "p1",
  name: "Acme Widget",
  description: "A fine widget.",
  sku: "AW-1",
  slug: "acme-widget",
  amount: 13500,
  currency: "CHF",
  images: [{ url: "https://img/1.jpg", alt: "Widget" }],
});

describe("resolveTopLevelField", () => {
  it("resolves a simple string leaf", () => {
    const r = resolveTopLevelField(product, "name");
    expect(r).toEqual({
      value: "Acme Widget",
      displayValue: "Acme Widget",
      label: "Name",
      key: "name",
      type: "string",
      hasValue: true,
    });
  });

  it("formats price as currency by default using price.currencyCode", () => {
    const r = resolveTopLevelField(product, "price", "auto", "en-US");
    expect(r.value).toBe(135);
    expect(r.type).toBe("number");
    expect(r.hasValue).toBe(true);
    expect(r.displayValue).toBe(
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "CHF",
      }).format(135),
    );
  });

  it("honours an explicit format override over the leaf default", () => {
    const r = resolveTopLevelField(product, "price", "number", "en-US");
    expect(r.displayValue).toBe(new Intl.NumberFormat("en-US").format(135));
  });

  it("walks an array path null-safely for the first image", () => {
    expect(resolveTopLevelField(product, "firstImageUrl").value).toBe(
      "https://img/1.jpg",
    );
  });

  it("reports absence when an array leaf has no element", () => {
    const noImages: Product = { ...product, images: [] };
    const r = resolveTopLevelField(noImages, "firstImageUrl");
    expect(r.hasValue).toBe(false);
    expect(r.displayValue).toBe("");
    expect(r.label).toBe("First image URL");
  });

  it("is fail-soft for a missing product", () => {
    const r = resolveTopLevelField(undefined, "name");
    expect(r.hasValue).toBe(false);
    expect(r.label).toBe("Name");
  });

  it("is fail-soft for an unknown leaf id, humanizing the id as a label", () => {
    const r = resolveTopLevelField(product, "totallyUnknown");
    expect(r).toMatchObject({
      hasValue: false,
      label: "Totally Unknown",
      key: "totallyUnknown",
      type: "null",
    });
  });

  it("resolves against the design-time mock product", () => {
    expect(resolveTopLevelField(MOCK_PRODUCT, "name").value).toBe(
      "Sample Product",
    );
  });
});

describe("resolveExtensionField", () => {
  const templates = normalizeExtensions({
    "products(care-and-materials)": {
      material: "Organic cotton",
      is_fair_trade: true,
      notes: "",
    },
    "products(metrics)": { rating: 4.7 },
  });

  it("resolves a present field with its humanized label", () => {
    const r = resolveExtensionField(
      templates,
      "products(care-and-materials)",
      "material",
    );
    expect(r).toEqual({
      value: "Organic cotton",
      displayValue: "Organic cotton",
      label: "Material",
      key: "material",
      type: "string",
      hasValue: true,
    });
  });

  it("renders a boolean via auto inference", () => {
    const r = resolveExtensionField(
      templates,
      "products(care-and-materials)",
      "is_fair_trade",
    );
    expect(r.displayValue).toBe("Yes");
    expect(r.type).toBe("boolean");
    expect(r.hasValue).toBe(true);
  });

  it("treats a present-but-blank string as absent", () => {
    const r = resolveExtensionField(
      templates,
      "products(care-and-materials)",
      "notes",
    );
    expect(r.hasValue).toBe(false);
    expect(r.displayValue).toBe("");
  });

  it("is fail-soft for an unknown field key, humanizing it as a label", () => {
    const r = resolveExtensionField(
      templates,
      "products(care-and-materials)",
      "missing_key",
    );
    expect(r).toMatchObject({
      hasValue: false,
      label: "Missing Key",
      key: "missing_key",
      type: "null",
    });
  });

  it("is fail-soft for an unknown template slug", () => {
    expect(
      resolveExtensionField(templates, "products(nope)", "material").hasValue,
    ).toBe(false);
  });

  it("is fail-soft for undefined templates", () => {
    expect(
      resolveExtensionField(undefined, "products(x)", "y").hasValue,
    ).toBe(false);
  });
});
