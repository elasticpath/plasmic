import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect, useMemo } from "react";
import { useFormContext } from "react-hook-form";
import debounce from "debounce";
import { Registerable } from "./registerable";
import { useBundleConfiguration } from "./bundle/use-bundle-configuration";
import { useBundleValidation } from "./bundle/use-bundle-validation";
import { useBundleOptionProducts } from "./bundle/use-bundle-option-products";
import { useParentProducts } from "./bundle/use-parent-products";
import { useBundleState } from "./bundle/hooks/useBundleState";
import { useBundleFormSync } from "./bundle/hooks/useBundleFormSync";
import { BundlePrice } from "./bundle/components/BundlePrice";
import { ValidationErrors } from "./bundle/components/ValidationErrors";
import { ComponentSelector } from "./bundle/components/ComponentSelector";
import { 
  ElasticPathBundleProduct 
} from "./bundle/types";
import { convertSelectionsForAPI, sortByOrder } from "./bundle/utils/bundleSelectionUtils";
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
  const form = useFormContext();

  // Get the raw EP product data
  const rawProduct = normalizedProduct?.rawData?.data;

  // Check if this is a bundle product
  const isBundle = rawProduct?.meta?.product_types?.[0] === "bundle";
  const bundleProduct = rawProduct as ElasticPathBundleProduct;
  const components = bundleProduct?.attributes?.components || {};

  // Bundle state management
  const {
    selectedOptions,
    isInitialized,
    handleComponentSelection,
  } = useBundleState({
    components,
    bundleProduct,
    defaultConfiguration,
  });

  // Bundle configuration hook
  const {
    configureBundleSelection,
    isConfiguring,
    configuredBundle,
  } = useBundleConfiguration({
    bundleId: bundleProduct?.id || "",
    onSuccess: () => {
      // This is handled by useBundleFormSync now
    },
  });

  // Form and URL synchronization
  useBundleFormSync({
    selectedOptions,
    updateUrlOnChange,
    isInitialized,
    form,
    configuredBundle,
  });

  // Validation hook
  const validation = useBundleValidation(components, selectedOptions);

  // Fetch parent product information and child variations
  const { parentProducts } = useParentProducts({
    components,
    enabled: isBundle && isInitialized,
  });

  // Fetch product details for options (including child products)
  const { products: optionProducts, loading: productsLoading } = useBundleOptionProducts({
    components,
    parentProducts,
    enabled: isBundle && isInitialized,
  });

  // Track last configured state to avoid duplicate API calls
  const [lastConfigured, setLastConfigured] = React.useState<string>("");

  // Debounced configuration function
  const debouncedConfigure = useMemo(
    () =>
      debounce(async (options: Record<string, Record<string, number>>) => {
        try {
          const optionsString = JSON.stringify(options);
          if (optionsString !== lastConfigured && Object.keys(options).length > 0) {
            await configureBundleSelection(options);
            setLastConfigured(optionsString);
          }
        } catch (error) {
          console.error("Failed to process bundle configuration:", error);
        }
      }, debounceMs),
    [configureBundleSelection, debounceMs, lastConfigured]
  );

  // Configure bundle when selections change (but not during initialization)
  useEffect(() => {
    // Skip configuration if not initialized, not valid, or no selections
    if (!isInitialized || !validation.isValid || Object.keys(selectedOptions).length === 0) {
      return;
    }
    
    // Convert selections to API format for comparison
    const apiFormattedSelections = convertSelectionsForAPI(selectedOptions);
    
    // Skip if this looks like the initial default configuration
    const isDefaultConfig = bundleProduct?.meta?.bundle_configuration?.selected_options && 
      (() => {
        const apiSelections = bundleProduct.meta.bundle_configuration.selected_options;
        
        // Check if the keys match
        const apiKeys = Object.keys(apiSelections);
        const selectedKeys = Object.keys(apiFormattedSelections);
        if (apiKeys.length !== selectedKeys.length) return false;
        
        // Check each component and option
        for (const componentKey of apiKeys) {
          if (!apiFormattedSelections[componentKey]) return false;
          
          const apiOptions = apiSelections[componentKey];
          const selectedOptionsForComponent = apiFormattedSelections[componentKey];
          
          const apiOptionKeys = Object.keys(apiOptions);
          const selectedOptionKeys = Object.keys(selectedOptionsForComponent);
          
          if (apiOptionKeys.length !== selectedOptionKeys.length) return false;
          
          for (const optionId of apiOptionKeys) {
            const apiQty = Number(apiOptions[optionId]); // Convert BigInt to number
            const selectedQty = selectedOptionsForComponent[optionId];
            
            if (apiQty !== selectedQty) return false;
          }
        }
        
        return true;
      })();
    
    if (isDefaultConfig) {
      return;
    }
    
    debouncedConfigure(apiFormattedSelections);
  }, [selectedOptions, validation.isValid, debouncedConfigure, isInitialized, bundleProduct?.meta?.bundle_configuration]);

  // Calculate current price and use configured bundle data when available
  const currentPrice = configuredBundle?.data?.meta?.display_price?.without_tax?.formatted
    || bundleProduct?.meta?.display_price?.without_tax?.formatted;
  
  // Detect bundle pricing type (fixed price has SKU, cumulative doesn't)
  const isFixedPrice = bundleProduct?.attributes?.sku !== undefined;
  
  // Use configured bundle product data when available
  const displayProduct = configuredBundle?.data || bundleProduct;
  const displayComponents = displayProduct?.attributes?.components || components;

  if (!normalizedProduct) {
    return <div className={className}>No product selected</div>;
  }

  if (!rawProduct) {
    return <div className={className}>Product data not available</div>;
  }

  if (!isBundle) {
    return <div className={className}>This product is not a bundle</div>;
  }

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
        <ValidationErrors errors={validation.errors} />
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