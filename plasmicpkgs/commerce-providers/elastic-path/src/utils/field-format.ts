import type { ExtensionField, ExtensionFieldType, ExtensionTemplate } from "../types/extensions";

/**
 * Turn an EP extension template slug like `products(example-template-2)` into
 * a human label like "Example Template 2".
 *
 * - Strips the leading entity prefix (e.g. `products`) and the surrounding
 *   parentheses if present.
 * - Replaces dashes/underscores with spaces.
 * - Title-cases each word.
 *
 * Falls back to the original slug if it doesn't match the expected shape.
 */
export function humanizeTemplateSlug(slug: string): string {
  if (!slug) return "";
  const parenMatch = slug.match(/^[a-z0-9_-]+\((.+)\)$/i);
  const inner = parenMatch ? parenMatch[1] : slug;
  return titleCase(inner.replace(/[-_]+/g, " "));
}

/**
 * Turn an extension field key into a human label.
 * - `name` → "Name"
 * - `productCare` → "Product Care"
 * - `eco_rating` → "Eco Rating"
 * - `dimensions-cm` → "Dimensions Cm"
 */
export function humanizeFieldKey(key: string): string {
  if (!key) return "";
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ");
  return titleCase(spaced);
}

function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function inferType(value: unknown): ExtensionFieldType {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

/**
 * Render a primitive-or-complex extension value into a single display string.
 * - boolean → "Yes" / "No"
 * - null/undefined → ""
 * - number → toLocaleString (no Intl options to stay safe in Plasmic ctx)
 * - string → as-is
 * - array → joined with ", " using displayValue recursion (one level deep)
 * - object → "key: value, key: value" for shallow objects, else JSON
 */
export function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    try {
      return value.toLocaleString();
    } catch {
      return String(value);
    }
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => formatDisplayValueShallow(v))
      .filter((s) => s.length > 0)
      .join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "";
    const allShallow = entries.every(
      ([, v]) => v === null || v === undefined || typeof v !== "object",
    );
    if (allShallow) {
      return entries
        .map(([k, v]) => `${humanizeFieldKey(k)}: ${formatDisplayValueShallow(v)}`)
        .join(", ");
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

/** How a resolved value renders to a string; orthogonal to the field's address. */
export type FormatSpec =
  | "auto"
  | "text"
  | "currency"
  | "date"
  | "number"
  | "raw";

/** Fallback locale (hard-coded so SSR and CSR agree on Intl output). */
export const DEFAULT_LOCALE = "en-US";

/** Presence: null/undefined/blank/`[]`/`{}` are absent; `0` and `false` are present. */
export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

/** The single formatting primitive shared by both field components; every Intl path is guarded. */
export function formatValue(
  value: unknown,
  format: FormatSpec = "auto",
  locale: string = DEFAULT_LOCALE,
  currency?: string,
): string {
  if (value === null || value === undefined) return "";
  switch (format) {
    case "raw":
      return rawString(value);
    case "text":
      return formatDisplayValue(value);
    case "number":
      return formatNumber(value, locale);
    case "currency":
      return formatCurrency(value, locale, currency);
    case "date":
      return formatDate(value, locale);
    case "auto":
    default:
      return formatAuto(value, locale);
  }
}

function formatAuto(value: unknown, locale: string): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatNumber(value, locale);
  return formatDisplayValue(value);
}

function rawString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatNumber(value: unknown, locale: string): string {
  const n = toFiniteNumber(value);
  if (n === null) return formatDisplayValue(value);
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}

function formatCurrency(
  value: unknown,
  locale: string,
  currency?: string,
): string {
  const n = toFiniteNumber(value);
  if (n === null) return formatDisplayValue(value);
  if (!currency) return formatNumber(value, locale);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(n);
  } catch {
    return formatNumber(value, locale);
  }
}

function formatDate(value: unknown, locale: string): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return formatDisplayValue(value);
  try {
    return new Intl.DateTimeFormat(locale).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatDisplayValueShallow(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

/** The single place that knows the EP `attributes.extensions` wire path. */
export function extractRawExtensions(
  product: unknown,
): Record<string, unknown> | null {
  const rawData = (product as { rawData?: unknown } | undefined)?.rawData as
    | { data?: { attributes?: { extensions?: Record<string, unknown> | null } } }
    | undefined;
  return rawData?.data?.attributes?.extensions ?? null;
}

/**
 * Walk a raw extensions object into the normalized template/field arrays
 * we expose to designer-driven bindings.
 */
export function normalizeExtensions(
  raw: Record<string, unknown> | null | undefined,
): ExtensionTemplate[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([slug, group]): ExtensionTemplate => {
    const groupObj =
      group && typeof group === "object" && !Array.isArray(group)
        ? (group as Record<string, unknown>)
        : {};
    const fields: ExtensionField[] = Object.entries(groupObj).map(
      ([key, value]): ExtensionField => ({
        key,
        label: humanizeFieldKey(key),
        value,
        type: inferType(value),
        displayValue: formatDisplayValue(value),
      }),
    );
    return {
      slug,
      label: humanizeTemplateSlug(slug),
      fields,
      fieldCount: fields.length,
    };
  });
}
