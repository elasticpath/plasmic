import { useEffect, useMemo, useState } from "react";
import debounce from "debounce";
import { ElasticPathBundleProduct } from "../types";
import { convertSelectionsForAPI } from "../utils/bundleSelectionUtils";
import { shouldTriggerConfiguration } from "../utils/configurationComparison";

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

  // Debounced configuration function
  const debouncedConfigure = useMemo(
    () =>
      debounce(async (options: Record<string, Record<string, number>>) => {
        try {
          setIsConfiguring(true);
          const optionsString = JSON.stringify(options);
          if (optionsString !== lastConfigured && Object.keys(options).length > 0) {
            await configureBundleSelection(options);
            setLastConfigured(optionsString);
          }
        } catch (error) {
          console.error("Failed to process bundle configuration:", error);
        } finally {
          setIsConfiguring(false);
        }
      }, debounceMs),
    [configureBundleSelection, debounceMs, lastConfigured]
  );

  // Configure bundle when selections change (but not during initialization)
  useEffect(() => {
    // Convert selections to API format first
    const apiFormattedSelections = convertSelectionsForAPI(selectedOptions);
    
    // Check if configuration should be triggered (using API-formatted selections for comparison)
    if (!shouldTriggerConfiguration(isInitialized, isValid, apiFormattedSelections, bundleProduct)) {
      return;
    }
    
    debouncedConfigure(apiFormattedSelections);
  }, [selectedOptions, isValid, debouncedConfigure, isInitialized, bundleProduct?.meta?.bundle_configuration]);

  // Cleanup debounced function on unmount
  useEffect(() => {
    return () => {
      debouncedConfigure.clear();
    };
  }, [debouncedConfigure]);

  return {
    isConfiguring,
    lastConfigured,
  };
}