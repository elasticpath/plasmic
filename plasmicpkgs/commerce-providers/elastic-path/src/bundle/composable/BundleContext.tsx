import React, { useContext } from "react";
import { ComponentProduct } from "../types";

// ---------------------------------------------------------------------------
// BundleFormContext — carries imperative actions from EPBundleProvider to all
// composable children. DataProvider/useSelector handles read-only data;
// this context provides callbacks and lookup maps that children need to
// mutate state or enrich option displays.
// ---------------------------------------------------------------------------

export interface BundleFormContextValue {
  handleComponentSelection: (
    componentKey: string,
    optionId: string,
    quantity: number,
    variationId?: string
  ) => void;
  selectedOptions: Record<string, Record<string, number>>;
  components: Record<string, ComponentProduct>;
  parentProducts: Record<string, any>;
  optionProducts: Record<string, any>;
  productsLoading: boolean;
  isFixedPrice: boolean;
}

export const BundleFormContext =
  React.createContext<BundleFormContextValue | null>(null);

export function useBundleFormContext(): BundleFormContextValue | null {
  return useContext(BundleFormContext);
}

// ---------------------------------------------------------------------------
// BundleOptionContext — provided by EPBundleOptionTrigger (or EPBundleOptionList)
// to child quantity controls. Follows the CartItemQuantityContext pattern.
// ---------------------------------------------------------------------------

export interface BundleOptionContextValue {
  componentKey: string;
  optionId: string;
  isSelected: boolean;
  quantity: number;
  toggleOption: () => void;
  setQuantity: (n: number) => void;
}

export const BundleOptionContext =
  React.createContext<BundleOptionContextValue | null>(null);

export function useBundleOption(): BundleOptionContextValue | null {
  return useContext(BundleOptionContext);
}

// ---------------------------------------------------------------------------
// BundleVariationContext — provided by EPBundleVariationPicker to child
// variation option triggers. Follows the VariationPickerContext pattern.
// ---------------------------------------------------------------------------

export interface BundleVariationContextValue {
  selectedValues: Record<string, string>;
  selectVariation: (axisId: string, value: string) => void;
}

export const BundleVariationContext =
  React.createContext<BundleVariationContextValue | null>(null);

export function useBundleVariation(): BundleVariationContextValue | null {
  return useContext(BundleVariationContext);
}
