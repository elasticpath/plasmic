import type { ExtensionTemplate } from "../types/extensions";

/** One template's fields flattened to `{ fieldKey: rawValue }`. */
export type ExtensionFieldMap = Record<string, unknown>;
/** Map of raw template slug (e.g. `products(iso-standard)`) -> field map. */
export type ProductExtensionsMap = Record<string, ExtensionFieldMap>;

const EMPTY_FIELDS: ExtensionFieldMap = Object.freeze({});

/**
 * Flatten normalized templates into `{ slug: { key: value } }`, keyed by the
 * **raw template slug** (the same value the field components' `template` prop
 * uses — `products(iso-standard)`, never a stripped `iso-standard`), exposing
 * the **raw** field values (a number stays a number for typed props).
 *
 * The result is wrapped in a Proxy so that accessing an **absent slug** returns
 * a frozen `{}` instead of `undefined` — a binding like
 * `$ctx.productExtensions['nope'].field` can never throw.
 *
 * Why a Proxy and not optional chaining at the call site: Plasmic's
 * `set-data-cond` (visibility) expression parser rejects `?.`, so this is the
 * only way to make missing-slug access safe **inside a visibility condition**.
 * Keep it — do not "simplify" to a plain object. The Proxy survives at runtime
 * because `@plasmicapp/host`'s `DataProvider` keeps `data` by reference (no
 * clone/serialize); `Object.keys`/the Studio data picker see the real slugs
 * (ownKeys passes through), so field discovery still works.
 */
export function buildExtensionsMap(
  templates: ExtensionTemplate[],
): ProductExtensionsMap {
  const bySlug: ProductExtensionsMap = {};
  for (const template of templates) {
    const fields: ExtensionFieldMap = {};
    for (const field of template.fields) {
      fields[field.key] = field.value;
    }
    bySlug[template.slug] = fields;
  }
  return new Proxy(bySlug, {
    // Absent string keys (slugs) → frozen {} so `…['nope'].field` can't throw.
    // Reflect.get handles string|symbol keys without a symbol-index type error.
    get: (target, key) =>
      typeof key === "string" && !(key in target)
        ? EMPTY_FIELDS
        : Reflect.get(target, key),
  });
}
