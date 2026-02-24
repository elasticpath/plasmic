import { useEffect, useState, useRef } from "react";
import debounce from "debounce";
import { ElasticPathBundleProduct } from "../types";
import {
  convertSelectionsForAPI,
  areSelectionsEqual,
} from "../utils/bundleSelectionUtils";
import { shouldTriggerConfiguration } from "../utils/configurationComparison";
import { handleAPIError } from "../../utils/errorHandling";
import { createLogger } from "../../utils/logger";

const log = createLogger("useBundleConfigOrchestration");

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
  configureBundleSelection: (
    options: Record<string, Record<string, number>>
  ) => Promise<any>;
  debounceMs?: number;
}

interface UseBundleConfigurationOrchestrationReturn {
  isConfiguring: boolean;
  error: Error | null;
}

/**
 * Orchestrates bundle configuration API calls with debouncing and duplicate prevention.
 *
 * Uses areSelectionsEqual() for structural comparison (avoids JSON.stringify key-ordering issues)
 * and a ref for last-configured tracking (no state sync needed — ref is always current in closures).
 * Exposes error state so consumers (EPBundleProvider) can surface configuration failures.
 */
export function useBundleConfigurationOrchestration({
  selectedOptions,
  isInitialized,
  isValid,
  bundleProduct,
  configureBundleSelection,
  debounceMs = 500,
}: UseBundleConfigurationOrchestrationProps): UseBundleConfigurationOrchestrationReturn {
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Ref tracks last successfully configured selections — no state needed since
  // no consumer renders based on this value (it's only used for dedup comparison).
  const lastConfiguredRef = useRef<Record<string, Record<string, number>>>({});

  // Debounced configuration function
  const configureFunction = useRef<DebouncedFunction | null>(null);

  useEffect(() => {
    configureFunction.current = debounce(
      async (options: Record<string, Record<string, number>>) => {
        // Early return for duplicates — avoids unnecessary isConfiguring flash
        if (
          Object.keys(options).length === 0 ||
          areSelectionsEqual(options, lastConfiguredRef.current)
        ) {
          return;
        }

        try {
          setIsConfiguring(true);
          setError(null);
          await configureBundleSelection(options);
          lastConfiguredRef.current = options;
        } catch (err) {
          const apiError = handleAPIError(err, "bundle configuration");
          setError(
            new Error(apiError.message)
          );
          log.error("Failed to process bundle configuration", {
            error: apiError.message,
          } as Record<string, unknown>);
        } finally {
          setIsConfiguring(false);
        }
      },
      debounceMs
    );

    return () => {
      if (configureFunction.current) {
        configureFunction.current.clear();
      }
    };
  }, [configureBundleSelection, debounceMs]);

  // Trigger configuration when selections change
  useEffect(() => {
    const apiFormattedSelections = convertSelectionsForAPI(selectedOptions);

    if (
      !shouldTriggerConfiguration(
        isInitialized,
        isValid,
        apiFormattedSelections,
        bundleProduct
      )
    ) {
      return;
    }

    if (configureFunction.current) {
      configureFunction.current(apiFormattedSelections);
    }
  }, [
    selectedOptions,
    isValid,
    isInitialized,
    bundleProduct?.meta?.bundle_configuration,
  ]);

  return {
    isConfiguring,
    error,
  };
}