import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect, useRef, useState } from "react";
import { Registerable } from "../registerable";
import {
  getDropdownOptions,
  getQuantityMode,
  parseQuantityInput,
} from "../utils/quantity-select";
import { useCartItemQuantity } from "./CartDrawerContext";

type Variant = "dropdown" | "input";
type PreviewState = "auto" | "low" | "high";

interface EPCartItemQuantitySelectProps {
  className?: string;
  /**
   * `dropdown` (mini-cart): a `<select>` for low quantities that hands off to a
   * number input once the threshold is reached. `input` (cart page): always a
   * plain number input. Mirrors iso.org's two cart surfaces.
   */
  variant?: Variant;
  /** Dropdown lists 1..threshold-1, then a terminal "{threshold}+" option. */
  threshold?: number;
  previewState?: PreviewState;
}

const DEFAULT_THRESHOLD = 5;
const FALLBACK_MIN = 1;
const FALLBACK_MAX = 99;

export const epCartItemQuantitySelectMeta: CodeComponentMeta<EPCartItemQuantitySelectProps> =
  {
    name: "plasmic-commerce-ep-cart-item-quantity-select",
    displayName: "EP Cart Item Quantity Select",
    description:
      "Editable quantity control for a cart item. As a dropdown (mini-cart) it offers low quantities and switches to a typeable input past the threshold; as an input it is always a plain number field. Must be inside an EP Cart Item Quantity Control.",
    props: {
      variant: {
        type: "choice",
        options: [
          { label: "Dropdown (with input overflow)", value: "dropdown" },
          { label: "Number input", value: "input" },
        ],
        defaultValue: "dropdown",
        displayName: "Variant",
      },
      threshold: {
        type: "number",
        defaultValue: DEFAULT_THRESHOLD,
        displayName: "Dropdown threshold",
        description:
          'Dropdown lists 1..(threshold-1) then a terminal "{threshold}+" option that switches to a number input. Only applies to the dropdown variant.',
        hidden: (props) => props.variant === "input",
      },
      previewState: {
        type: "choice",
        options: ["auto", "low", "high"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state for design-time editing (low = dropdown, high = input).",
        advanced: true,
      },
    },
    defaultStyles: {
      minWidth: "56px",
      height: "32px",
      padding: "4px 8px",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "#cccccc",
      borderRadius: "4px",
      backgroundColor: "#ffffff",
      fontSize: "15px",
      color: "#333333",
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCartItemQuantitySelect",
  };

export function EPCartItemQuantitySelect(
  props: EPCartItemQuantitySelectProps
) {
  const {
    className,
    variant = "dropdown",
    threshold = DEFAULT_THRESHOLD,
    previewState = "auto",
  } = props;

  const ctx = useCartItemQuantity();
  const inEditor = !!usePlasmicCanvasContext();

  const useMock = previewState !== "auto" || (!ctx && inEditor);
  const mockQuantity = previewState === "high" ? 8 : 2;

  const min = ctx?.minQuantity ?? FALLBACK_MIN;
  const max = ctx?.maxQuantity ?? FALLBACK_MAX;
  const quantity = useMock ? mockQuantity : ctx?.quantity ?? min;
  const isLoading = useMock ? false : ctx?.isLoading ?? false;
  const commit = (next: number) => {
    if (useMock) return;
    ctx?.setQuantity(next);
  };

  // Local editable string for the input, kept in sync with the resolved
  // quantity so external mutations (server resolve, +/- elsewhere) reflect here.
  const [inputValue, setInputValue] = useState(String(quantity));
  const prevQuantity = useRef(quantity);
  useEffect(() => {
    if (prevQuantity.current !== quantity) {
      setInputValue(String(quantity));
      prevQuantity.current = quantity;
    }
  }, [quantity]);

  const mode =
    variant === "input" ? "input" : getQuantityMode(quantity, threshold);

  if (mode === "input") {
    const commitInput = () => {
      const parsed = parseQuantityInput(inputValue, min, max);
      setInputValue(String(parsed));
      commit(parsed);
    };
    return (
      <input
        className={className}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={inputValue}
        disabled={isLoading}
        aria-label="Quantity"
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commitInput}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitInput();
          }
        }}
      />
    );
  }

  const options = getDropdownOptions(threshold, min);
  return (
    <select
      className={className}
      value={String(quantity)}
      disabled={isLoading}
      aria-label="Quantity"
      onChange={(e) => commit(Number(e.target.value))}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function registerEPCartItemQuantitySelect(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartItemQuantitySelectProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCartItemQuantitySelect,
    customMeta ?? epCartItemQuantitySelectMeta
  );
}
