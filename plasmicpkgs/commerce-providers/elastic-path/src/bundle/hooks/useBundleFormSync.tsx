import { useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { convertSelectionsForAPI } from "../utils/bundleSelectionUtils";

interface UseBundleFormSyncProps {
  selectedOptions: Record<string, Record<string, number>>;
  updateUrlOnChange?: boolean;
  isInitialized: boolean;
  form?: UseFormReturn<any>;
  configuredBundle?: any;
}

export function useBundleFormSync({
  selectedOptions,
  updateUrlOnChange,
  isInitialized,
  form,
  configuredBundle,
}: UseBundleFormSyncProps) {
  // Update form when bundle configuration is received from API
  useEffect(() => {
    if (form && configuredBundle?.data?.meta?.bundle_configuration) {
      // Convert BigInt to serializable format before storing in form
      const serializableConfig = {
        selected_options: Object.fromEntries(
          Object.entries(configuredBundle.data.meta.bundle_configuration.selected_options).map(
            ([key, options]: [string, any]) => [
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
      if (configuredBundle.data.id) {
        form.setValue("ConfiguredBundleId", configuredBundle.data.id);
      }
    }
  }, [form, configuredBundle]);

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
}