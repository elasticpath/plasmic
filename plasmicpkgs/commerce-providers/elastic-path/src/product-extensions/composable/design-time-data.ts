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
