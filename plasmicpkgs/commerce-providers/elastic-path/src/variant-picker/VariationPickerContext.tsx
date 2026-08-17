import React, { useContext } from "react";
import type { ProductVariant } from "../types/product";

export interface VariationPickerContextValue {
  selectedValues: Record<string, string>;
  selectOption: (variationId: string, optionLabel: string) => void;
  selectedVariant: ProductVariant | undefined;
  claimedVariations: ReadonlySet<string>;
  registerClaim: (variationName: string) => () => void;
}

export const VariationPickerContext =
  React.createContext<VariationPickerContextValue | null>(null);

export function useVariationPicker(): VariationPickerContextValue | null {
  return useContext(VariationPickerContext);
}
