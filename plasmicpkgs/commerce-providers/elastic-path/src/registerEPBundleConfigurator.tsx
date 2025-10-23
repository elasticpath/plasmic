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
import { useBundleOptionProducts, OptionProduct } from "./bundle/use-bundle-option-products";
import { useParentProducts, ParentProductInfo, ChildProduct } from "./bundle/use-parent-products";
import { 
  BundleConfiguration, 
  ComponentProduct, 
  ElasticPathBundleProduct 
} from "./bundle/types";
import type { Product as ElasticPathProduct } from "@epcc-sdk/sdks-shopper";
import { Product } from "./types/product";

// Helper function to sort items by sort_order
const sortByOrder = <T extends { sort_order?: number | null }>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    const orderA = a.sort_order ?? Number.MAX_VALUE;
    const orderB = b.sort_order ?? Number.MAX_VALUE;
    return orderA - orderB;
  });
};

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
  // For parent products, we store: selectedOptions[componentKey][parentId:childId] = quantity
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

  // Fetch parent product information and child variations
  const { parentProducts, loading: parentProductsLoading } = useParentProducts({
    components,
    enabled: isBundle && isInitialized,
  });

  // Fetch product details for options (including child products)
  const { products: optionProducts, loading: productsLoading } = useBundleOptionProducts({
    components,
    parentProducts,
    enabled: isBundle && isInitialized,
  });

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
              // Find default option or fall back to first option
              const defaultOption = component.options.find(opt => opt.default) || component.options[0];
              if (defaultOption.id) {
                if (!decoded[componentKey]) {
                  decoded[componentKey] = {};
                }
                decoded[componentKey][defaultOption.id] = defaultOption.quantity || 1;
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
          // Find default option or fall back to first option
          const defaultOption = component.options.find(opt => opt.default) || component.options[0];
          if (defaultOption.id) {
            if (!defaultSelections[componentKey]) {
              defaultSelections[componentKey] = {};
            }
            defaultSelections[componentKey][defaultOption.id] = defaultOption.quantity || 1;
          }
        }
      });
      
      setSelectedOptions(defaultSelections);
      
      // Mark as initialized regardless of whether we found defaults
      setIsInitialized(true);
    }
  }, [defaultConfiguration, bundleProduct?.meta?.bundle_configuration, isBundle, isInitialized]);

  // Convert parent product selections to API format
  const convertSelectionsForAPI = (selections: Record<string, Record<string, number>>) => {
    const apiSelections: Record<string, Record<string, number>> = {};
    
    Object.entries(selections).forEach(([componentKey, options]) => {
      apiSelections[componentKey] = {};
      
      Object.entries(options).forEach(([selectionKey, quantity]) => {
        if (selectionKey.includes(':')) {
          // Parent product variation: use the child product ID
          const [parentId, childId] = selectionKey.split(':');
          apiSelections[componentKey][childId] = quantity;
        } else {
          // Simple product: use as-is
          apiSelections[componentKey][selectionKey] = quantity;
        }
      });
    });
    
    return apiSelections;
  };

  // Configure bundle when selections change (but not during initialization)
  useEffect(() => {
    // Skip configuration if not initialized, not valid, or no selections
    if (!isInitialized || !validation.isValid || Object.keys(selectedOptions).length === 0) {
      return;
    }
    
    // Convert selections to API format for comparison
    const apiFormattedSelections = convertSelectionsForAPI(selectedOptions);
    
    // Skip if this looks like the initial default configuration
    // Compare without JSON.stringify to avoid BigInt serialization issues
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

  // Handle component selection (including parent product variations)
  const handleComponentSelection = useCallback(
    (componentKey: string, optionId: string, quantity: number, variationId?: string) => {
      const component = components[componentKey];
      
      // For parent products, use parentId:childId as the key
      const selectionKey = variationId ? `${optionId}:${variationId}` : optionId;
      
      setSelectedOptions((prev) => {
        const newOptions = { ...prev };
        
        if (!newOptions[componentKey]) {
          newOptions[componentKey] = {};
        }

        // If component has max=1 and we're selecting a new option, clear others
        if (component?.max === 1 && quantity > 0) {
          // Clear all other selections in this component
          newOptions[componentKey] = { [selectionKey]: quantity };
        } else if (quantity > 0) {
          newOptions[componentKey][selectionKey] = quantity;
        } else {
          delete newOptions[componentKey][selectionKey];
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
        <div style={{ marginBottom: "20px", fontSize: "1.2em", fontWeight: "bold" }}>
          <div>
            Price: {isConfiguring ? "Updating..." : currentPrice || "N/A"}
          </div>
          <div style={{ fontSize: "0.8em", fontWeight: "normal", color: "#666" }}>
            {isFixedPrice ? "Fixed Price Bundle" : "Cumulative Price Bundle"}
          </div>
        </div>
      )}

      {showValidationErrors && validation.errors.length > 0 && (
        <div style={{ marginBottom: "20px", color: "#d32f2f" }}>
          {validation.errors.map((error, idx) => (
            <div key={idx}>{error}</div>
          ))}
        </div>
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
          parentProductsLoading={parentProductsLoading}
        />
      ))}
    </div>
  );
}

interface ComponentSelectorProps {
  componentKey: string;
  component: ComponentProduct;
  selectedOptions: Record<string, number>;
  onSelectionChange: (componentKey: string, optionId: string, quantity: number, variationId?: string) => void;
  optionProducts: Record<string, OptionProduct>;
  productsLoading: boolean;
  isFixedPrice: boolean;
  parentProducts: Record<string, ParentProductInfo>;
  parentProductsLoading: boolean;
}

function ComponentSelector({
  componentKey,
  component,
  selectedOptions,
  onSelectionChange,
  optionProducts,
  productsLoading,
  isFixedPrice,
  parentProducts,
  parentProductsLoading,
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
        {sortByOrder(component.options || []).map((option, index) => (
          <OptionSelector
            key={option.id || `option-${index}`}
            option={option}
            index={index}
            componentKey={componentKey}
            selectedOptions={selectedOptions}
            onSelectionChange={onSelectionChange}
            optionProducts={optionProducts}
            productsLoading={productsLoading}
            isFixedPrice={isFixedPrice}
            parentProducts={parentProducts}
            parentProductsLoading={parentProductsLoading}
            isSingleSelect={isSingleSelect}
          />
        ))}
      </div>
    </div>
  );
}

interface OptionSelectorProps {
  option: NonNullable<ComponentProduct["options"]>[0];
  index: number;
  componentKey: string;
  selectedOptions: Record<string, number>;
  onSelectionChange: (componentKey: string, optionId: string, quantity: number, variationId?: string) => void;
  optionProducts: Record<string, OptionProduct>;
  productsLoading: boolean;
  isFixedPrice: boolean;
  parentProducts: Record<string, ParentProductInfo>;
  parentProductsLoading: boolean;
  isSingleSelect: boolean;
}

function OptionSelector({
  option,
  index,
  componentKey,
  selectedOptions,
  onSelectionChange,
  optionProducts,
  productsLoading,
  isFixedPrice,
  parentProducts,
  parentProductsLoading,
  isSingleSelect,
}: OptionSelectorProps) {
  const optionId = option.id || `option-${index}`;
  const parentInfo = parentProducts[optionId];
  
  // Uncomment for debugging parent product selection
  // console.log(`OptionSelector for ${optionId}:`, {
  //   parentInfo,
  //   isParent: parentInfo?.isParent,
  //   childrenCount: parentInfo?.children?.length || 0,
  //   parentProducts: Object.keys(parentProducts)
  // });
  
  // For parent products, we need to handle variations
  if (parentInfo?.isParent) {
    // Even if no children found yet, still render parent product option
    // to allow manual selection or show loading state
    // console.log(`Rendering ParentProductOption for ${optionId} (${parentInfo.children?.length || 0} children)`);
    return (
      <ParentProductOption
        option={option}
        optionId={optionId}
        parentInfo={parentInfo}
        componentKey={componentKey}
        selectedOptions={selectedOptions}
        onSelectionChange={onSelectionChange}
        optionProducts={optionProducts}
        isFixedPrice={isFixedPrice}
        isSingleSelect={isSingleSelect}
      />
    );
  }

  // Regular simple product option
  const currentQuantity = selectedOptions[optionId] || 0;
  const hasQuantityRange = option.min !== null || option.max !== null;
  const minQty = option.min || 1;
  const maxQty = option.max || option.quantity || 1;
  const defaultQty = option.quantity || 1;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <input
        type={isSingleSelect ? "radio" : "checkbox"}
        name={isSingleSelect ? `component-${componentKey}` : undefined}
        checked={currentQuantity > 0}
        onChange={(e) => {
          if (option.id) {
            if (isSingleSelect) {
              onSelectionChange(componentKey, option.id, e.target.checked ? defaultQty : 0);
            } else {
              onSelectionChange(componentKey, option.id, e.target.checked ? minQty : 0);
            }
          }
        }}
      />
      <label style={{ flex: 1 }}>
        {(() => {
          const optionProduct = optionProducts[optionId];
          if (productsLoading) {
            return `${optionId} (Loading...)`;
          }
          if (optionProduct) {
            return (
              <span>
                {optionProduct.name || optionId}
                {!isFixedPrice && optionProduct.price && (
                  <span style={{ marginLeft: "8px", color: "#666" }}>
                    (+{optionProduct.price})
                  </span>
                )}
                {option.default && <span style={{ fontSize: "0.8em", color: "#666" }}> (Default)</span>}
              </span>
            );
          }
          return (
            <span>
              {optionId}
              {option.default && <span style={{ fontSize: "0.8em", color: "#666" }}> (Default)</span>}
            </span>
          );
        })()}
      </label>
      
      {/* Show quantity selector if option has variable quantities or max > 1 */}
      {(hasQuantityRange || maxQty > 1) && currentQuantity > 0 && (
        <input
          type="number"
          min={minQty}
          max={maxQty}
          value={currentQuantity}
          onChange={(e) => {
            const value = parseInt(e.target.value) || 0;
            if (option.id && value >= minQty && value <= maxQty) {
              onSelectionChange(componentKey, option.id, value);
            }
          }}
          style={{ width: "80px" }}
        />
      )}
      
      {/* Show quantity range info */}
      {hasQuantityRange && currentQuantity > 0 && (
        <span style={{ fontSize: "0.8em", color: "#666" }}>
          ({minQty}-{maxQty})
        </span>
      )}
    </div>
  );
}

interface ParentProductOptionProps {
  option: NonNullable<ComponentProduct["options"]>[0];
  optionId: string;
  parentInfo: ParentProductInfo;
  componentKey: string;
  selectedOptions: Record<string, number>;
  onSelectionChange: (componentKey: string, optionId: string, quantity: number, variationId?: string) => void;
  optionProducts: Record<string, OptionProduct>;
  isFixedPrice: boolean;
  isSingleSelect: boolean;
}

function ParentProductOption({
  option,
  optionId,
  parentInfo,
  componentKey,
  selectedOptions,
  onSelectionChange,
  optionProducts,
  isFixedPrice,
  isSingleSelect,
}: ParentProductOptionProps) {
  const [showVariations, setShowVariations] = useState(false);
  const [variationSelections, setVariationSelections] = useState<Record<string, string>>({});
  
  // Get parent product details for variation metadata
  const parentProduct = optionProducts[optionId];
  
  // Check if any variation of this parent is selected
  const hasSelection = Object.keys(selectedOptions).some(key => key.startsWith(`${optionId}:`));
  
  // Get the currently selected variation
  const selectedVariationKey = Object.keys(selectedOptions).find(key => 
    key.startsWith(`${optionId}:`) && selectedOptions[key] > 0
  );
  const selectedVariationId = selectedVariationKey?.split(':')[1];
  const selectedVariation = parentInfo.children?.find(child => child.id === selectedVariationId);

  // Get variations from parent info
  const variations = parentInfo.variations || [];

  // Helper function to find option IDs for a given child product ID in the variation matrix
  const getOptionsFromSkuId = (
    skuId: string,
    entry: any,
    options: string[] = []
  ): string[] | undefined => {
    if (typeof entry === "string") {
      return entry === skuId ? options : undefined;
    }

    let acc: string[] | undefined;
    Object.keys(entry).every((key) => {
      const result = getOptionsFromSkuId(skuId, entry[key], [...options, key]);
      if (result) {
        acc = result;
        return false;
      }
      return true;
    });
    return acc;
  };

  // Find the matching child product based on selected variations
  const findMatchingVariant = (selections: Record<string, string>) => {
    if (!parentInfo.children || !parentInfo.variationMatrix || Object.keys(selections).length === 0) {
      return null;
    }

    // Check if we have all variations selected
    if (Object.keys(selections).length !== variations.length) {
      return null;
    }

    return parentInfo.children.find((child) => {
      // Find the option IDs for this child product
      const optionIds = getOptionsFromSkuId(child.id, parentInfo.variationMatrix);
      
      if (!optionIds || optionIds.length === 0) {
        return false;
      }

      // Check if this child matches all selected variation values
      return Object.entries(selections).every(([variationId, selectedValue]) => {
        // Find the variation and option that matches this selection
        const variation = variations.find(v => v.id === variationId);
        const option = variation?.options?.find(opt => opt.name === selectedValue);
        
        return option && optionIds.includes(option.id);
      });
    });
  };

  // Handle variation selection change
  const handleVariationChange = (variationId: string, value: string) => {
    const newSelections = { ...variationSelections, [variationId]: value };
    setVariationSelections(newSelections);

    // Find matching variant
    const matchingVariant = findMatchingVariant(newSelections);
    
    // Update bundle selection
    if (selectedVariationId) {
      // Clear previous selection
      onSelectionChange(componentKey, optionId, 0, selectedVariationId);
    }
    
    if (matchingVariant) {
      // Select new variant
      onSelectionChange(componentKey, optionId, 1, matchingVariant.id);
    }
  };

  return (
    <div style={{ border: "1px solid #e0e0e0", borderRadius: "4px", padding: "10px" }}>
      {/* Parent product header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
        <input
          type={isSingleSelect ? "radio" : "checkbox"}
          name={isSingleSelect ? `component-${componentKey}` : undefined}
          checked={hasSelection}
          onChange={(e) => {
            if (e.target.checked) {
              setShowVariations(true);
              // Select first available (non-excluded) variation if none selected
              if (!hasSelection) {
                const firstAvailableChild = parentInfo.children?.find(child => !child.excluded);
                if (firstAvailableChild) {
                  onSelectionChange(componentKey, optionId, 1, firstAvailableChild.id);
                }
              }
            } else {
              // Deselect all variations
              setShowVariations(false);
              if (selectedVariationKey) {
                onSelectionChange(componentKey, optionId, 0, selectedVariationId);
              }
            }
          }}
        />
        <label style={{ flex: 1, fontWeight: "bold" }}>
          {parentProduct?.name || optionId}
          <span style={{ fontSize: "0.8em", color: "#666", fontWeight: "normal" }}> (Parent Product)</span>
          {option.default && <span style={{ fontSize: "0.8em", color: "#666" }}> (Default)</span>}
        </label>
        
        {hasSelection && (
          <button
            type="button"
            onClick={() => setShowVariations(!showVariations)}
            style={{
              background: "none",
              border: "1px solid #ccc",
              borderRadius: "4px",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "0.8em",
            }}
          >
            {showVariations ? "Hide" : "Show"} Variations
          </button>
        )}
      </div>

      {/* Show selected variation summary */}
      {hasSelection && selectedVariation && (
        <div style={{ marginBottom: "8px", fontSize: "0.9em", color: "#666" }}>
          Selected: {selectedVariation.name || selectedVariation.id}
          {!isFixedPrice && selectedVariation.price && ` (+${selectedVariation.price})`}
        </div>
      )}

      {/* Variation selector */}
      {showVariations && hasSelection && (
        <div style={{ marginLeft: "20px", marginTop: "8px" }}>
          {variations && variations.length > 0 ? (
            <>
              <div style={{ fontSize: "0.9em", fontWeight: "bold", marginBottom: "6px" }}>
                Choose Variation:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {variations.map((variation) => (
                  <div key={variation.id} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "0.8em", fontWeight: "bold" }}>
                      {variation.name}:
                    </label>
                    <select
                      value={variationSelections[variation.id] || ""}
                      onChange={(e) => handleVariationChange(variation.id, e.target.value)}
                      style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: "4px" }}
                    >
                      <option value="">Select {variation.name}</option>
                      {variation.options?.map((option) => (
                        <option key={option.id} value={option.name}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              
              {/* Show selected variant info */}
              {Object.keys(variationSelections).length === variations.length && (
                <div style={{ marginTop: "8px", padding: "8px", backgroundColor: "#f0f8ff", borderRadius: "4px" }}>
                  {(() => {
                    const matchingVariant = findMatchingVariant(variationSelections);
                    if (matchingVariant) {
                      return (
                        <div style={{ fontSize: "0.8em", color: "#333" }}>
                          <div><strong>Selected Variant:</strong> {matchingVariant.name || matchingVariant.id}</div>
                          {matchingVariant.sku && <div><strong>SKU:</strong> {matchingVariant.sku}</div>}
                          {!isFixedPrice && matchingVariant.price && (
                            <div><strong>Price:</strong> +{matchingVariant.price}</div>
                          )}
                        </div>
                      );
                    } else {
                      return (
                        <div style={{ fontSize: "0.8em", color: "#d32f2f" }}>
                          No matching variant found for this combination.
                        </div>
                      );
                    }
                  })()}
                </div>
              )}
              
              {/* Show excluded variations separately for transparency */}
              {parentInfo.children?.some(child => child.excluded) && (
                <div style={{ marginTop: "8px", padding: "8px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
                  <div style={{ fontSize: "0.8em", color: "#666", marginBottom: "4px" }}>
                    Excluded variations (not available in this bundle):
                  </div>
                  {parentInfo.children
                    .filter(child => child.excluded)
                    .map((child) => (
                      <div key={child.id} style={{ fontSize: "0.8em", color: "#999", marginLeft: "10px" }}>
                        • {child.name || child.id}
                        {child.sku && ` (${child.sku})`}
                      </div>
                    ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: "0.9em", color: "#666" }}>
              No variations available. This parent product may need to be configured differently.
            </div>
          )}
        </div>
      )}

      {/* Loading state for variations */}
      {parentInfo.loading && (
        <div style={{ marginLeft: "20px", fontSize: "0.8em", color: "#666" }}>
          Loading variations...
        </div>
      )}
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