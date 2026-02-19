import React, { useContext } from "react";
import type { ProductVariant } from "@plasmicpkgs/commerce";

export interface VariationPickerContextValue {
  selectedValues: Record<string, string>;
  selectOption: (variationId: string, optionLabel: string) => void;
  selectedVariant: ProductVariant | undefined;
}

export const VariationPickerContext =
  React.createContext<VariationPickerContextValue | null>(null);

export function useVariationPicker(): VariationPickerContextValue | null {
  return useContext(VariationPickerContext);
}
