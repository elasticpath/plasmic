import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "./registerable";
import { useBundleConfiguration } from "./bundle/use-bundle-configuration";
import { useBundleOptionProducts } from "./bundle/use-bundle-option-products";
import { useParentProducts } from "./bundle/use-parent-products";
import { useBundleForm, useApiFormattedSelections } from "./bundle/hooks/useBundleForm";
import { useBundleFormSync } from "./bundle/hooks/useBundleFormSync";
import { useBundleConfigurationOrchestration } from "./bundle/hooks/useBundleConfigurationOrchestration";
import { BundlePrice } from "./bundle/components/BundlePrice";
import { ValidationErrors } from "./bundle/components/ValidationErrors";
import { ComponentSelector } from "./bundle/components/ComponentSelector";
import { sortByOrder } from "./bundle/utils/bundleSelectionUtils";
import { validateBundleProduct } from "./bundle/utils/productValidation";
import { calculateBundlePrice } from "./bundle/utils/priceCalculation";
import { Product } from "./types/product";

interface EPBundleConfiguratorProps {
  className?: string;
  defaultConfiguration?: string; // Base64 encoded configuration from URL
  updateUrlOnChange?: boolean;
  showPrice?: boolean;
  showValidationErrors?: boolean;
  debounceMs?: number;
}

export const epBundleConfiguratorMeta: ComponentMeta<EPBundleConfiguratorProps> = {
  name: "plasmic-commerce-ep-bundle-configurator",
  displayName: "EP Bundle Configurator",
  description:
    "Elastic Path bundle configurator for both fixed and dynamic bundles",
  props: {
    defaultConfiguration: {
      type: "string",
      description:
        "Pre-configured bundle selections (base64 encoded JSON)",
    },
    updateUrlOnChange: {
      type: "boolean",
      description:
        "Update the URL query parameter when configuration changes",
      defaultValue: true,
    },
    showPrice: {
      type: "boolean",
      description: "Show the bundle price",
      defaultValue: true,
    },
    showValidationErrors: {
      type: "boolean",
      description: "Show validation error messages",
      defaultValue: true,
    },
    debounceMs: {
      type: "number",
      description: "Debounce time for API calls in milliseconds",
      defaultValue: 500,
    },
  },
  importPath: "@plasmicpkgs/commerce",
  importName: "EPBundleConfigurator",
};

export function EPBundleConfigurator(props: EPBundleConfiguratorProps) {
  const {
    className,
    defaultConfiguration,
    updateUrlOnChange,
    showPrice,
    showValidationErrors,
    debounceMs = 500,
  } = props;

  // Access product from Plasmic's data context
  const normalizedProduct = useSelector("currentProduct") as Product | undefined;

  // Validate and extract bundle product information
  const productValidation = validateBundleProduct(normalizedProduct);
  
  // Early returns for invalid states
  if (!productValidation.isValid) {
    return <div className={className}>{productValidation.errorMessage}</div>;
  }

  const { bundleProduct, components } = productValidation;

  // Bundle form management with Zod validation
  const {
    form,
    selectedOptions,
    isValid,
    errors,
    handleComponentSelection,
  } = useBundleForm({
    components,
    bundleProduct,
    defaultConfiguration,
  });

  // Get API-formatted selections for backend calls
  const apiFormattedSelections = useApiFormattedSelections(selectedOptions);

  // Bundle configuration hook
  const {
    configureBundleSelection,
    configuredBundle,
  } = useBundleConfiguration({
    bundleId: bundleProduct?.id || "",
    onSuccess: () => {
      // This is handled by useBundleFormSync now
    },
  });

  // Bundle configuration orchestration
  const { isConfiguring } = useBundleConfigurationOrchestration({
    selectedOptions: apiFormattedSelections,
    isInitialized: true, // Form is always initialized when mounted
    isValid,
    bundleProduct,
    configureBundleSelection,
    debounceMs,
  });

  // Form and URL synchronization
  useBundleFormSync({
    selectedOptions,
    updateUrlOnChange,
    isInitialized: true,
    form,
    configuredBundle,
  });

  // Fetch parent product information and child variations
  const { parentProducts } = useParentProducts({
    components,
    enabled: productValidation.isBundle,
  });

  // Fetch product details for options (including child products)
  const { products: optionProducts, loading: productsLoading } = useBundleOptionProducts({
    components,
    parentProducts,
    enabled: productValidation.isBundle,
  });

  // Calculate price and display information
  const priceInfo = calculateBundlePrice(
    bundleProduct, 
    configuredBundle ? { data: configuredBundle as any } : undefined
  );
  const { currentPrice, isFixedPrice, displayComponents } = priceInfo;

  // Convert Zod errors to legacy format for ValidationErrors component
  const validationErrors = Object.values(errors);

  return (
    <div className={className}>
      {showPrice && (
        <BundlePrice
          currentPrice={currentPrice}
          isConfiguring={isConfiguring}
          isFixedPrice={isFixedPrice}
        />
      )}

      {showValidationErrors && (
        <ValidationErrors errors={validationErrors} />
      )}

      {sortByOrder(Object.entries(displayComponents).map(([key, component]) => ({ 
        key, 
        component, 
        sort_order: component.sort_order 
      }))).map(({ key: componentKey, component }) => (
        <ComponentSelector
          key={componentKey}
          componentKey={componentKey}
          component={component}
          selectedOptions={selectedOptions[componentKey] || {}}
          onSelectionChange={handleComponentSelection}
          optionProducts={optionProducts}
          productsLoading={productsLoading}
          isFixedPrice={isFixedPrice}
          parentProducts={parentProducts}
        />
      ))}
    </div>
  );
}

export function registerEPBundleConfigurator(
  loader?: Registerable,
  customEPBundleConfiguratorMeta?: ComponentMeta<EPBundleConfiguratorProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleConfigurator,
    customEPBundleConfiguratorMeta ?? epBundleConfiguratorMeta
  );
}