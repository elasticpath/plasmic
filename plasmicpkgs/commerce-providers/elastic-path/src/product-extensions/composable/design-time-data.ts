import type { Product } from "../../types/product";
import type { ExtensionTemplate, ExtensionsData } from "./types";
import { normalizeExtensions } from "./format";

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

/** Mock product for the field components at design time; carries rawData.extensions for the dropdowns. */
export const MOCK_PRODUCT: Product = {
  id: "mock-product",
  name: "Sample Product",
  description:
    "This is a placeholder product shown only at design time. Bind a real product (or productId) to fetch live data.",
  descriptionHtml:
    "<p>This is a placeholder product shown only at design time.</p>",
  slug: "sample-product",
  sku: "MOCK-SKU",
  images: [
    {
      url: "https://picsum.photos/seed/ep-product-field/800/800",
      alt: "Sample product",
    },
  ],
  variants: [],
  price: {
    value: 135,
    currencyCode: "CHF",
  },
  options: [],
  rawData: {
    data: { attributes: { extensions: MOCK_EXTENSIONS_RAW } },
  } as Product["rawData"],
};
