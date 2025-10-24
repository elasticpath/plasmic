import { useEffect } from "react";
import { UseFormReturn, useFormContext } from "react-hook-form";
import { convertSelectionsForAPI } from "../utils/bundleSelectionUtils";
import { BundleFormData } from "../schemas/bundleSchema";

interface UseBundleFormSyncProps {
  selectedOptions: BundleFormData;
  updateUrlOnChange?: boolean;
  isInitialized: boolean;
  form?: UseFormReturn<BundleFormData>;
  configuredBundle?: any;
}

export function useBundleFormSync({
  selectedOptions,
  updateUrlOnChange,
  isInitialized,
  form,
  configuredBundle,
}: UseBundleFormSyncProps) {
  // Get parent form context if available
  const parentForm = useFormContext();
  // Update both internal and parent forms when bundle configuration is received from API
  useEffect(() => {
    if (configuredBundle?.data?.meta?.bundle_configuration) {
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
      
      // Update internal form if available
      if (form) {
        form.setValue("BundleConfiguration", serializableConfig);
        if (configuredBundle.data.id) {
          form.setValue("ConfiguredBundleId", configuredBundle.data.id);
        }
      }
      
      // IMPORTANT: Also update parent form context for cart integration
      if (parentForm) {
        parentForm.setValue("BundleConfiguration", serializableConfig);
        if (configuredBundle.data.id) {
          parentForm.setValue("ConfiguredBundleId", configuredBundle.data.id);
        }
      }
    }
  }, [form, parentForm, configuredBundle]);

  // Sync selected options to parent form for cart integration
  useEffect(() => {
    if (parentForm && isInitialized) {
      // Convert selections to API format
      const apiFormattedSelections = convertSelectionsForAPI(selectedOptions);
      
      // Only update if we have actual component selections (not just form fields)
      const hasComponentSelections = Object.keys(apiFormattedSelections).length > 0;
      if (hasComponentSelections) {
        parentForm.setValue("BundleConfiguration", {
          selected_options: apiFormattedSelections
        });
      }
    }
  }, [parentForm, selectedOptions, isInitialized]);

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