import type { Product } from "../../types/product";
import { getProductFieldLeaf } from "./field-catalog";
import {
  formatValue,
  humanizeFieldKey,
  inferType,
  isPresent,
} from "./format";
import type { FormatSpec } from "./format";
import type { ExtensionFieldType, ExtensionTemplate } from "./types";

/** The normalized view of one product field — the only shape the UI depends on. */
export interface ResolvedField {
  value: unknown;
  displayValue: string;
  label: string;
  key: string;
  type: ExtensionFieldType;
  hasValue: boolean;
}

function walkPath(obj: unknown, path: (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const segment of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string | number, unknown>)[segment];
  }
  return cur;
}

/** Resolve a curated top-level leaf; fail-soft. `auto` uses the leaf's default format. */
export function resolveTopLevelField(
  product: Product | undefined | null,
  leafId: string,
  format: FormatSpec = "auto",
  locale?: string,
): ResolvedField {
  const leaf = getProductFieldLeaf(leafId);
  if (!leaf) {
    return {
      value: undefined,
      displayValue: "",
      label: humanizeFieldKey(leafId),
      key: leafId,
      type: "null",
      hasValue: false,
    };
  }
  const value = product ? walkPath(product, leaf.path) : undefined;
  const currency = leaf.currencyPath
    ? (walkPath(product, leaf.currencyPath) as string | undefined)
    : undefined;
  const effectiveFormat = format === "auto" ? leaf.defaultFormat : format;
  const hasValue = isPresent(value);
  return {
    value,
    displayValue: hasValue
      ? formatValue(value, effectiveFormat, locale, currency)
      : "",
    label: leaf.label,
    key: leaf.id,
    type: inferType(value),
    hasValue,
  };
}

/** Resolve one extension field by (templateSlug, fieldKey); fail-soft. */
export function resolveExtensionField(
  templates: ExtensionTemplate[] | undefined,
  templateSlug: string,
  fieldKey: string,
  format: FormatSpec = "auto",
  locale?: string,
): ResolvedField {
  const template = (templates ?? []).find((t) => t.slug === templateSlug);
  const field = template?.fields.find((f) => f.key === fieldKey);
  if (!field) {
    return {
      value: undefined,
      displayValue: "",
      label: humanizeFieldKey(fieldKey ?? ""),
      key: fieldKey ?? "",
      type: "null",
      hasValue: false,
    };
  }
  const hasValue = isPresent(field.value);
  return {
    value: field.value,
    displayValue: hasValue ? formatValue(field.value, format, locale) : "",
    label: field.label,
    key: field.key,
    type: field.type,
    hasValue,
  };
}
