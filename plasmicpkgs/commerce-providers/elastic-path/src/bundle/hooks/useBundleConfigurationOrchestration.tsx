import { useEffect, useState, useRef } from "react";
import debounce from "debounce";
import { ElasticPathBundleProduct } from "../types";
import { convertSelectionsForAPI } from "../utils/bundleSelectionUtils";
import { shouldTriggerConfiguration } from "../utils/configurationComparison";

// Type for debounced function with clear method
interface DebouncedFunction {
  (options: Record<string, Record<string, number>>): Promise<void> | undefined;
  clear(): void;
}

interface UseBundleConfigurationOrchestrationProps {
  selectedOptions: Record<string, Record<string, number>>;
  isInitialized: boolean;
  isValid: boolean;
  bundleProduct?: ElasticPathBundleProduct;
  configureBundleSelection: (options: Record<string, Record<string, number>>) => Promise<any>;
  debounceMs?: number;
}

interface UseBundleConfigurationOrchestrationReturn {
  isConfiguring: boolean;
  lastConfigured: string;
}

/**
 * Orchestrates bundle configuration API calls with debouncing and duplicate prevention
 */
export function useBundleConfigurationOrchestration({
  selectedOptions,
  isInitialized,
  isValid,
  bundleProduct,
  configureBundleSelection,
  debounceMs = 500,
}: UseBundleConfigurationOrchestrationProps): UseBundleConfigurationOrchestrationReturn {
  // Track last configured state to avoid duplicate API calls
  const [lastConfigured, setLastConfigured] = useState<string>("");
  const [isConfiguring, setIsConfiguring] = useState(false);

  // Create a ref to hold the latest lastConfigured value
  const lastConfiguredRef = useRef(lastConfigured);
  
  // Update the ref whenever lastConfigured changes
  useEffect(() => {
    lastConfiguredRef.current = lastConfigured;
  }, [lastConfigured]);

  // Configuration function with debouncing
  const configureFunction = useRef<DebouncedFunction | null>(null);
  
  useEffect(() => {
    configureFunction.current = debounce(async (options: Record<string, Record<string, number>>) => {
      try {
        setIsConfiguring(true);
        const optionsString = JSON.stringify(options);
        if (optionsString !== lastConfiguredRef.current && Object.keys(options).length > 0) {
          await configureBundleSelection(options);
          setLastConfigured(optionsString);
        }
      } catch (error) {
        console.error("Failed to process bundle configuration:", error);
      } finally {
        setIsConfiguring(false);
      }
    }, debounceMs);
    
    return () => {
      if (configureFunction.current) {
        configureFunction.current.clear();
      }
    };
  }, [configureBundleSelection, debounceMs]);

  // Configure bundle when selections change (but not during initialization)
  useEffect(() => {
    // Convert selections to API format first
    const apiFormattedSelections = convertSelectionsForAPI(selectedOptions);
    
    // Check if configuration should be triggered (using API-formatted selections for comparison)
    if (!shouldTriggerConfiguration(isInitialized, isValid, apiFormattedSelections, bundleProduct)) {
      return;
    }
    
    if (configureFunction.current) {
      configureFunction.current(apiFormattedSelections);
    }
  }, [selectedOptions, isValid, isInitialized, bundleProduct?.meta?.bundle_configuration]);


  return {
    isConfiguring,
    lastConfigured,
  };
}