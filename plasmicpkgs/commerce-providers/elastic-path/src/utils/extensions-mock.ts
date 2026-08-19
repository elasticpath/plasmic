import type { Product } from "../types/product";
import { mockProduct } from "./design-time-data";
import type { ExtensionTemplate, ExtensionsData } from "../types/extensions";
import { normalizeExtensions } from "./field-format";

/**
 * Mock extensions payload used in Studio / MCP preview when no live product
 * is bound, or when previewState is "withData". Mirrors the shape of EP's
 * `attributes.extensions` object.
 */
export const MOCK_EXTENSIONS_RAW: Record<string, Record<string, unknown>> = {
  "products(care-and-materials)": {
    care_instructions: "Machine wash cold, tumble dry low.",
    material: "Organic cotton",
    country_of_origin: "Portugal",
  },
  "products(certifications)": {
    is_fair_trade: true,
    rating: 4.7,
  },
};

export const MOCK_EXTENSION_TEMPLATES: ExtensionTemplate[] =
  normalizeExtensions(MOCK_EXTENSIONS_RAW);

export const MOCK_EXTENSIONS_DATA: ExtensionsData = {
  templateCount: MOCK_EXTENSION_TEMPLATES.length,
  isEmpty: MOCK_EXTENSION_TEMPLATES.length === 0,
};

/** Mock product for the field components at design time; carries the extensions the dropdowns read. */
export const MOCK_PRODUCT: Product = mockProduct({
  id: "mock-product",
  name: "Sample Product",
  description:
    "This is a placeholder product shown only at design time. Bind a real product (or productId) to fetch live data.",
  slug: "sample-product",
  sku: "MOCK-SKU",
  amount: 13500,
  currency: "CHF",
  formatted: "CHF 135.00",
  images: [
    {
      url: "https://picsum.photos/seed/ep-product-field/800/800",
      alt: "Sample product",
    },
  ],
});
MOCK_PRODUCT.attributes = {
  ...MOCK_PRODUCT.attributes,
  extensions: MOCK_EXTENSIONS_RAW as NonNullable<
    Product["attributes"]
  >["extensions"],
};

