import React, { useContext } from "react";
import type { ComponentProduct } from "../types";

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

export interface BundleOptionContextValue {
  componentKey: string;
  optionId: string;
  isSelected: boolean;
  quantity: number;
  toggleOption: () => void;
  setQuantity: (n: number) => void;
}

export interface BundleVariationContextValue {
  /** Maps variationId → selected option ID (e.g. "var-color" → "opt-red") */
  selectedValues: Record<string, string>;
  /** Select an option by its ID for the given variation axis */
  selectVariation: (axisId: string, optionId: string) => void;
}

// ---------------------------------------------------------------------------
// Use Symbol.for + globalThis to guarantee singleton contexts even if the
// bundle is loaded multiple times (e.g. CJS + ESM in the same app, or
// webpack/Next.js HMR resolving the package through different paths).
// This matches the pattern used by StockContext.tsx.
// ---------------------------------------------------------------------------

const BUNDLE_FORM_CTX_KEY = Symbol.for("@elasticpath/ep-bundle-form-context");
const BUNDLE_OPTION_CTX_KEY = Symbol.for(
  "@elasticpath/ep-bundle-option-context"
);
const BUNDLE_VARIATION_CTX_KEY = Symbol.for(
  "@elasticpath/ep-bundle-variation-context"
);

function getSingletonContext<T>(key: symbol): React.Context<T | null> {
  const g = globalThis as any;
  if (!g[key]) {
    g[key] = React.createContext<T | null>(null);
  }
  return g[key];
}

// ---------------------------------------------------------------------------
// BundleFormContext
// ---------------------------------------------------------------------------

const BundleFormCtx =
  getSingletonContext<BundleFormContextValue>(BUNDLE_FORM_CTX_KEY);

export const BundleFormContext = BundleFormCtx;

export function useBundleFormContext(): BundleFormContextValue | null {
  return useContext(BundleFormCtx);
}

// ---------------------------------------------------------------------------
// BundleOptionContext — provided by EPBundleOptionTrigger (or EPBundleOptionList)
// to child quantity controls. Follows the CartItemQuantityContext pattern.
// ---------------------------------------------------------------------------

const BundleOptionCtx =
  getSingletonContext<BundleOptionContextValue>(BUNDLE_OPTION_CTX_KEY);

export const BundleOptionContext = BundleOptionCtx;

export function useBundleOption(): BundleOptionContextValue | null {
  return useContext(BundleOptionCtx);
}

// ---------------------------------------------------------------------------
// BundleVariationContext — provided by EPBundleVariationPicker to child
// variation option triggers. Follows the VariationPickerContext pattern.
//
// selectedValues maps variationId → option ID (not display label).
// selectVariation dispatches an option ID for the given axis.
// ---------------------------------------------------------------------------

const BundleVariationCtx =
  getSingletonContext<BundleVariationContextValue>(BUNDLE_VARIATION_CTX_KEY);

export const BundleVariationContext = BundleVariationCtx;

export function useBundleVariation(): BundleVariationContextValue | null {
  return useContext(BundleVariationCtx);
}
