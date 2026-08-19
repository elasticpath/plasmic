import React, { useContext } from "react";
import type { ChildProduct } from "../types/product";

export interface VariationPickerContextValue {
  selectedValues: Record<string, string>;
  selectOption: (variationId: string, optionName: string) => void;
  selectedVariant: ChildProduct | undefined;
  claimedVariations: ReadonlySet<string>;
  registerClaim: (variationName: string) => () => void;
}

export const VariationPickerContext =
  React.createContext<VariationPickerContextValue | null>(null);

export function useVariationPicker(): VariationPickerContextValue | null {
  return useContext(VariationPickerContext);
}
