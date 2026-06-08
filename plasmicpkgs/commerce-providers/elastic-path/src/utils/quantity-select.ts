/**
 * Pure logic for the cart-item quantity selector.
 *
 * iso.org's mini-cart renders quantity as a `<select>` for low values
 * (1, 2, 3, 4) plus a terminal "5+" option that switches the control to a
 * typeable number `<input>`. Once the quantity reaches the threshold the
 * dropdown can no longer represent it, so the input takes over.
 *
 * These helpers are framework-free so the dropdown-vs-input decision, the
 * option list, and the parse/clamp of typed values are unit-testable in
 * isolation from the React component.
 */

export type QuantityMode = "dropdown" | "input";

export interface QuantityOption {
  /** The numeric quantity this option commits. */
  value: number;
  /** The visible label ("1".."4", or "5+" for the terminal option). */
  label: string;
  /** True for the terminal "N+" option that hands off to the number input. */
  isOverflow: boolean;
}

/**
 * Which control to show for a given quantity. The dropdown can represent
 * `min .. threshold - 1`; at or above `threshold` only the input can.
 */
export function getQuantityMode(
  quantity: number,
  threshold: number
): QuantityMode {
  return quantity >= threshold ? "input" : "dropdown";
}

/**
 * The dropdown's options: one per concrete value from `min` up to
 * `threshold - 1`, then a terminal `${threshold}+` overflow option that
 * switches the control to the number input.
 *
 * Example (min=1, threshold=5): 1, 2, 3, 4, 5+.
 */
export function getDropdownOptions(
  threshold: number,
  min = 1
): QuantityOption[] {
  const options: QuantityOption[] = [];
  for (let v = min; v < threshold; v++) {
    options.push({ value: v, label: String(v), isOverflow: false });
  }
  options.push({
    value: threshold,
    label: `${threshold}+`,
    isOverflow: true,
  });
  return options;
}

/**
 * Parse and clamp a raw typed value to a valid integer quantity in
 * `[min, max]`. Non-numeric, empty, or fractional input falls back to `min`;
 * out-of-range values are clamped to the nearest bound.
 */
export function parseQuantityInput(
  raw: string | number,
  min: number,
  max: number
): number {
  const n =
    typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return min;
  const floored = Math.trunc(n);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}
