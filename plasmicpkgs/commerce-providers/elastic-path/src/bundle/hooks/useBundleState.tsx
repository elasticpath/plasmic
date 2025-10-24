import { useState, useEffect, useCallback } from "react";
import { ComponentProduct, ElasticPathBundleProduct } from "../types";
import { getDefaultSelections } from "../utils/bundleSelectionUtils";

interface UseBundleStateProps {
  components: Record<string, ComponentProduct>;
  bundleProduct?: ElasticPathBundleProduct;
  defaultConfiguration?: string;
}

interface UseBundleStateReturn {
  selectedOptions: Record<string, Record<string, number>>;
  setSelectedOptions: React.Dispatch<React.SetStateAction<Record<string, Record<string, number>>>>;
  isInitialized: boolean;
  handleComponentSelection: (
    componentKey: string, 
    optionId: string, 
    quantity: number, 
    variationId?: string
  ) => void;
}

export function useBundleState({
  components,
  bundleProduct,
  defaultConfiguration,
}: UseBundleStateProps): UseBundleStateReturn {
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Record<string, number>>>({});
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize selections from props or bundle defaults
  useEffect(() => {
    if (!isInitialized && Object.keys(components).length > 0) {
      let initialSelections: Record<string, Record<string, number>> = {};

      // Priority 1: Use the defaultConfiguration prop if provided
      if (defaultConfiguration) {
        try {
          const decoded = JSON.parse(atob(defaultConfiguration));
          initialSelections = getDefaultSelections(components, decoded);
        } catch (error) {
          console.error("Failed to parse default configuration:", error);
          initialSelections = getDefaultSelections(components);
        }
      } else {
        // Priority 2: Use the bundle's default configuration from the API response
        if (bundleProduct?.meta?.bundle_configuration?.selected_options) {
          // Convert BigInt values to numbers to avoid serialization issues
          const apiSelections = bundleProduct.meta.bundle_configuration.selected_options;
          const convertedSelections: Record<string, Record<string, number>> = {};
          
          for (const [componentKey, options] of Object.entries(apiSelections)) {
            convertedSelections[componentKey] = {};
            for (const [optionId, quantity] of Object.entries(options)) {
              convertedSelections[componentKey][optionId] = Number(quantity);
            }
          }
          
          initialSelections = getDefaultSelections(components, convertedSelections);
        } else {
          initialSelections = getDefaultSelections(components);
        }
      }
      
      setSelectedOptions(initialSelections);
      setIsInitialized(true);
    }
  }, [defaultConfiguration, bundleProduct?.meta?.bundle_configuration, components, isInitialized]);

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

  return {
    selectedOptions,
    setSelectedOptions,
    isInitialized,
    handleComponentSelection,
  };
}