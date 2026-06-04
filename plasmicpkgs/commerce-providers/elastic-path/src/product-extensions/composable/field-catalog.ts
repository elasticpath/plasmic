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
  { id: "name", label: "Name", path: ["name"], defaultFormat: "text" },
  {
    id: "description",
    label: "Description",
    path: ["description"],
    defaultFormat: "text",
  },
  { id: "sku", label: "SKU", path: ["sku"], defaultFormat: "text" },
  { id: "slug", label: "Slug", path: ["slug"], defaultFormat: "text" },
  {
    id: "price",
    label: "Price (formatted)",
    path: ["price", "value"],
    defaultFormat: "currency",
    currencyPath: ["price", "currencyCode"],
  },
  {
    id: "priceValue",
    label: "Price (raw number)",
    path: ["price", "value"],
    defaultFormat: "number",
  },
  {
    id: "currencyCode",
    label: "Currency code",
    path: ["price", "currencyCode"],
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
