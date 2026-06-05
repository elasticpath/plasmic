/** A selected variation option on a cart line item. */
export interface CartItemOption {
  name: string;
  value: string;
}

/** Default separator for the values-only descriptor (e.g. "Blue / Large"). */
export const DEFAULT_OPTION_VALUE_SEPARATOR = " / ";

/**
 * Formats a line item's selected options as a values-only descriptor, joined
 * by `separator`, preserving the product's option order.
 *
 * Unlike the `Name: Value, …` rendering, this drops the labels — `[{Color,
 * Blue}, {Size, Large}]` → `"Blue / Large"`. Empty/absent input → `""` (no
 * stray separators), and options with an empty value are skipped.
 */
export function formatOptionValues(
  options: CartItemOption[] | undefined | null,
  separator: string = DEFAULT_OPTION_VALUE_SEPARATOR
): string {
  if (!options || options.length === 0) return "";
  return options
    .map((o) => o?.value ?? "")
    .filter((v) => v !== "")
    .join(separator);
}
