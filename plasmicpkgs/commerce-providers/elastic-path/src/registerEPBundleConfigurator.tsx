import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Controller, useFormContext } from "react-hook-form";
import debounce from "debounce";
import { Registerable } from "./registerable";
import { useBundleConfiguration } from "./bundle/use-bundle-configuration";
import { useBundleValidation } from "./bundle/use-bundle-validation";
import { 
  BundleConfiguration, 
  ComponentProduct, 
  ElasticPathBundleProduct 
} from "./bundle/types";
import type { Product as ElasticPathProduct } from "@epcc-sdk/sdks-shopper";
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

  // State for bundle configuration - use numbers internally
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Record<string, number>>>({});
  const [lastConfigured, setLastConfigured] = useState<string>("");
  const [isInitialized, setIsInitialized] = useState(false);

  // Check if this is a bundle product
  const isBundle = rawProduct?.meta?.product_types?.[0] === "bundle";
  const bundleProduct = rawProduct as ElasticPathBundleProduct;
  const components = bundleProduct?.attributes?.components || {};

  // Bundle configuration hook
  const {
    configureBundleSelection,
    isConfiguring,
    configuredBundle,
  } = useBundleConfiguration({
    bundleId: bundleProduct?.id || "",
    onSuccess: (response) => {
      if (form && response?.data?.meta?.bundle_configuration) {
        // Convert BigInt to serializable format before storing in form
        const serializableConfig = {
          selected_options: Object.fromEntries(
            Object.entries(response.data.meta.bundle_configuration.selected_options).map(
              ([key, options]) => [
                key,
                Object.fromEntries(
                  Object.entries(options).map(([optionId, qty]) => [optionId, Number(qty)])
                )
              ]
            )
          )
        };
        form.setValue("BundleConfiguration", serializableConfig);
        
        // Also update the configured bundle ID if it's different
        if (response.data.id) {
          form.setValue("ConfiguredBundleId", response.data.id);
        }
      }
    },
  });

  // Validation hook
  const validation = useBundleValidation(components, selectedOptions);

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
    [configureBundleSelection, debounceMs]
  );

  // Initialize from defaultConfiguration prop or bundle's default selections
  useEffect(() => {
    if (!isInitialized && isBundle) {
      // Priority 1: Use the defaultConfiguration prop if provided
      if (defaultConfiguration) {
        try {
          const decoded = JSON.parse(atob(defaultConfiguration));
          
          // Ensure required components have at least one selection even with defaultConfiguration
          Object.entries(components).forEach(([componentKey, component]) => {
            const hasSelection = decoded[componentKey] && 
              Object.keys(decoded[componentKey]).length > 0;
            
            if (!hasSelection && component.min && component.min > 0 && component.options?.length) {
              // Select first option if component is required but has no selection
              const firstOption = component.options[0];
              if (firstOption.id) {
                if (!decoded[componentKey]) {
                  decoded[componentKey] = {};
                }
                decoded[componentKey][firstOption.id] = firstOption.quantity || 1;
              }
            }
          });
          
          setSelectedOptions(decoded);
          setIsInitialized(true);
          return;
        } catch (error) {
          console.error("Failed to parse default configuration:", error);
        }
      }
      
      // Priority 2: Use the bundle's default configuration from the API response
      const defaultSelections: Record<string, Record<string, number>> = {};
      
      if (bundleProduct?.meta?.bundle_configuration?.selected_options) {
        // Convert BigInt values to numbers to avoid serialization issues
        const apiSelections = bundleProduct.meta.bundle_configuration.selected_options;
        
        for (const [componentKey, options] of Object.entries(apiSelections)) {
          defaultSelections[componentKey] = {};
          for (const [optionId, quantity] of Object.entries(options)) {
            defaultSelections[componentKey][optionId] = Number(quantity);
          }
        }
      }
      
      // Ensure required components have at least one selection
      Object.entries(components).forEach(([componentKey, component]) => {
        const hasSelection = defaultSelections[componentKey] && 
          Object.keys(defaultSelections[componentKey]).length > 0;
        
        if (!hasSelection && component.min && component.min > 0 && component.options?.length) {
          // Select first option if component is required but has no selection
          const firstOption = component.options[0];
          if (firstOption.id) {
            if (!defaultSelections[componentKey]) {
              defaultSelections[componentKey] = {};
            }
            defaultSelections[componentKey][firstOption.id] = firstOption.quantity || 1;
          }
        }
      });
      
      setSelectedOptions(defaultSelections);
      
      // Mark as initialized regardless of whether we found defaults
      setIsInitialized(true);
    }
  }, [defaultConfiguration, bundleProduct?.meta?.bundle_configuration, isBundle, isInitialized]);

  // Configure bundle when selections change (but not during initialization)
  useEffect(() => {
    // Skip configuration if not initialized, not valid, or no selections
    if (!isInitialized || !validation.isValid || Object.keys(selectedOptions).length === 0) {
      return;
    }
    
    // Skip if this looks like the initial default configuration
    // Compare without JSON.stringify to avoid BigInt serialization issues
    const isDefaultConfig = bundleProduct?.meta?.bundle_configuration?.selected_options && 
      (() => {
        const apiSelections = bundleProduct.meta.bundle_configuration.selected_options;
        
        // Check if the keys match
        const apiKeys = Object.keys(apiSelections);
        const selectedKeys = Object.keys(selectedOptions);
        if (apiKeys.length !== selectedKeys.length) return false;
        
        // Check each component and option
        for (const componentKey of apiKeys) {
          if (!selectedOptions[componentKey]) return false;
          
          const apiOptions = apiSelections[componentKey];
          const selectedOptionsForComponent = selectedOptions[componentKey];
          
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
    
    debouncedConfigure(selectedOptions);
  }, [selectedOptions, validation.isValid, debouncedConfigure, isInitialized, bundleProduct?.meta?.bundle_configuration]);

  // Update URL when configuration changes
  useEffect(() => {
    if (updateUrlOnChange && typeof window !== "undefined" && Object.keys(selectedOptions).length > 0 && isInitialized) {
      try {
        const url = new URL(window.location.href);
        const encoded = btoa(JSON.stringify(selectedOptions));
        url.searchParams.set("bundle_config", encoded);
        window.history.replaceState({}, "", url.toString());
      } catch (error) {
        console.error("Failed to update URL:", error);
      }
    }
  }, [selectedOptions, updateUrlOnChange, isInitialized]);

  // Handle component selection
  const handleComponentSelection = useCallback(
    (componentKey: string, optionId: string, quantity: number) => {
      const component = components[componentKey];
      
      setSelectedOptions((prev) => {
        const newOptions = { ...prev };
        
        if (!newOptions[componentKey]) {
          newOptions[componentKey] = {};
        }

        // If component has max=1 and we're selecting a new option, clear others
        if (component?.max === 1 && quantity > 0) {
          // Clear all other selections in this component
          newOptions[componentKey] = { [optionId]: quantity };
        } else if (quantity > 0) {
          newOptions[componentKey][optionId] = quantity;
        } else {
          delete newOptions[componentKey][optionId];
          if (Object.keys(newOptions[componentKey]).length === 0) {
            delete newOptions[componentKey];
          }
        }

        return newOptions;
      });
    },
    [components]
  );

  // Calculate current price and use configured bundle data when available
  const currentPrice = configuredBundle?.data?.meta?.display_price?.without_tax?.formatted
    || bundleProduct?.meta?.display_price?.without_tax?.formatted;
  
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
        <div style={{ marginBottom: "20px", fontSize: "1.2em", fontWeight: "bold" }}>
          Price: {isConfiguring ? "Updating..." : currentPrice || "N/A"}
        </div>
      )}

      {showValidationErrors && validation.errors.length > 0 && (
        <div style={{ marginBottom: "20px", color: "#d32f2f" }}>
          {validation.errors.map((error, idx) => (
            <div key={idx}>{error}</div>
          ))}
        </div>
      )}

      {Object.entries(displayComponents).map(([componentKey, component]) => (
        <ComponentSelector
          key={componentKey}
          componentKey={componentKey}
          component={component}
          selectedOptions={selectedOptions[componentKey] || {}}
          onSelectionChange={handleComponentSelection}
        />
      ))}
    </div>
  );
}

interface ComponentSelectorProps {
  componentKey: string;
  component: ComponentProduct;
  selectedOptions: Record<string, number>;
  onSelectionChange: (componentKey: string, optionId: string, quantity: number) => void;
}

function ComponentSelector({
  componentKey,
  component,
  selectedOptions,
  onSelectionChange,
}: ComponentSelectorProps) {
  const selectedCount = Object.values(selectedOptions).reduce((sum, qty) => sum + qty, 0);
  const isRequired = component.min !== undefined && component.min !== null && component.min > 0;
  const isSingleSelect = component.min === 1 && component.max === 1;
  const isOptional = component.min === 0 || component.min === null;

  return (
    <div style={{ marginBottom: "20px", padding: "10px", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
      <h3 style={{ marginTop: 0 }}>
        {component.name || `Component ${componentKey}`} 
        {isRequired && <span style={{ color: "#d32f2f" }}> *</span>}
        {isOptional && <span style={{ fontSize: "0.8em", color: "#666" }}> (Optional)</span>}
      </h3>
      
      {component.min !== undefined && component.min !== null && (
        <p style={{ fontSize: "0.9em", color: "#666" }}>
          {component.min === component.max
            ? `Select exactly ${component.min}`
            : component.max !== null && component.max !== undefined
            ? `Select ${component.min} to ${component.max}`
            : `Select at least ${component.min}`}
          {" "}(Currently: {selectedCount})
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {(component.options || []).map((option, index) => {
          const optionId = option.id || `option-${index}`;
          const currentQuantity = selectedOptions[optionId] || 0;
          const maxQuantity = option.quantity || 1;

          return (
            <div key={optionId} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type={isSingleSelect ? "radio" : "checkbox"}
                name={isSingleSelect ? `component-${componentKey}` : undefined}
                checked={currentQuantity > 0}
                onChange={(e) => {
                  if (option.id) {
                    if (isSingleSelect) {
                      // For radio buttons, always set to 1 when selected
                      onSelectionChange(componentKey, option.id, e.target.checked ? 1 : 0);
                    } else {
                      // For checkboxes, toggle between 0 and 1
                      onSelectionChange(componentKey, option.id, e.target.checked ? 1 : 0);
                    }
                  }
                }}
              />
              <label style={{ flex: 1 }}>{optionId}</label>
              
              {maxQuantity > 1 && currentQuantity > 0 && (
                <input
                  type="number"
                  min="1"
                  max={maxQuantity}
                  value={currentQuantity}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 0;
                    if (option.id) {
                      onSelectionChange(componentKey, option.id, Math.min(value, maxQuantity));
                    }
                  }}
                  style={{ width: "60px" }}
                />
              )}
            </div>
          );
        })}
      </div>
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