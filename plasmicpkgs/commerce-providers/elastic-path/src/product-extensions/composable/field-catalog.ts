import type { FormatSpec } from "../../utils/field-format";
import type { ChoiceObject, ExtensionTemplate } from "../../types/extensions";

/** A curated, addressable leaf of the normalized product (path is walked null-safely). */
export interface ProductFieldLeaf {
  id: string;
  label: string;
  path: (string | number)[];
  defaultFormat: FormatSpec;
  /** Where to read the currency code for `currency` formatting; price leaves only. */
  currencyPath?: (string | number)[];
}

/** The curated top-level leaf set; add a leaf here to surface a new field in the dropdown. */
export const PRODUCT_FIELD_LEAVES: ProductFieldLeaf[] = [
  {
    id: "name",
    label: "Name",
    path: ["attributes", "name"],
    defaultFormat: "text",
  },
  {
    id: "description",
    label: "Description",
    path: ["attributes", "description"],
    defaultFormat: "text",
  },
  { id: "sku", label: "SKU", path: ["attributes", "sku"], defaultFormat: "text" },
  {
    id: "slug",
    label: "Slug",
    path: ["attributes", "slug"],
    defaultFormat: "text",
  },
  {
    id: "price",
    label: "Price (formatted)",
    // float_price, never amount — amount is 4999 where float_price is 49.99.
    path: ["meta", "display_price", "without_tax", "float_price"],
    defaultFormat: "currency",
    currencyPath: ["meta", "display_price", "without_tax", "currency"],
  },
  {
    id: "priceWithTax",
    label: "Price incl. tax (formatted)",
    path: ["meta", "display_price", "with_tax", "float_price"],
    defaultFormat: "currency",
    currencyPath: ["meta", "display_price", "with_tax", "currency"],
  },
  {
    id: "priceFormatted",
    label: "Price (Elastic Path formatted)",
    path: ["meta", "display_price", "without_tax", "formatted"],
    defaultFormat: "raw",
  },
  {
    id: "priceFrom",
    label: "Price from (lowest child)",
    path: ["priceFrom", "float_price"],
    defaultFormat: "currency",
    currencyPath: ["priceFrom", "currency"],
  },
  {
    id: "priceValue",
    label: "Price (raw number)",
    path: ["meta", "display_price", "without_tax", "float_price"],
    defaultFormat: "number",
  },
  {
    id: "currencyCode",
    label: "Currency code",
    path: ["meta", "display_price", "without_tax", "currency"],
    defaultFormat: "text",
  },
  {
    id: "firstImageUrl",
    label: "First image URL",
    path: ["images", 0, "url"],
    defaultFormat: "raw",
  },
  {
    id: "firstImageAlt",
    label: "First image alt",
    path: ["images", 0, "alt"],
    defaultFormat: "text",
  },
];

export function getProductFieldLeaf(id: string): ProductFieldLeaf | undefined {
  return PRODUCT_FIELD_LEAVES.find((leaf) => leaf.id === id);
}

/** Shared `format` choice options for both field components — one source of truth. */
export const FORMAT_CHOICE_OPTIONS: ChoiceObject[] = [
  { label: "Auto", value: "auto" },
  { label: "Text", value: "text" },
  { label: "Currency", value: "currency" },
  { label: "Date", value: "date" },
  { label: "Number", value: "number" },
  { label: "Raw (unformatted)", value: "raw" },
];

/** Shared `show` choice options for both field components. */
export const SHOW_CHOICE_OPTIONS: ChoiceObject[] = [
  { label: "Value", value: "value" },
  { label: "Label (humanized)", value: "label" },
];

export function buildLeafOptions(): ChoiceObject[] {
  return PRODUCT_FIELD_LEAVES.map((leaf) => ({
    label: leaf.label,
    value: leaf.id,
  }));
}

export function buildTemplateOptions(
  templates: ExtensionTemplate[] | undefined,
): ChoiceObject[] {
  return (templates ?? []).map((template) => ({
    label: template.label,
    value: template.slug,
  }));
}

export function buildFieldOptions(
  templates: ExtensionTemplate[] | undefined,
  templateSlug: string | undefined,
): ChoiceObject[] {
  const template = (templates ?? []).find((t) => t.slug === templateSlug);
  if (!template) return [];
  return template.fields.map((field) => ({
    label: field.label,
    value: field.key,
  }));
}
