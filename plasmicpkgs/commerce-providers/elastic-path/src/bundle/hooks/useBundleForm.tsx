import { useMemo, useCallback } from 'react';
import { useForm, UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ComponentProduct, ElasticPathBundleProduct } from '../types';
import { 
  createBundleSchema, 
  createBundleDefaultValues,
  BundleFormData 
} from '../schemas/bundleSchema';
import { convertSelectionsForAPI } from '../utils/bundleSelectionUtils';

interface UseBundleFormProps {
  components: Record<string, ComponentProduct>;
  bundleProduct?: ElasticPathBundleProduct;
  defaultConfiguration?: string;
  onSubmit?: (data: BundleFormData) => void;
}

interface UseBundleFormReturn {
  form: UseFormReturn<BundleFormData>;
  selectedOptions: BundleFormData;
  isValid: boolean;
  errors: Record<string, string>;
  handleComponentSelection: (
    componentKey: string, 
    optionId: string, 
    quantity: number, 
    variationId?: string
  ) => void;
  handleSubmit: (callback?: (data: BundleFormData) => void) => (e?: React.BaseSyntheticEvent) => Promise<void>;
  reset: () => void;
}

/**
 * Reads the bundle_config URL parameter if present.
 * Returns the base64-encoded string (same format as defaultConfiguration prop).
 * Returns undefined in SSR or when the param is absent.
 */
function getUrlBundleConfig(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("bundle_config") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hook for managing bundle form state with Zod validation
 * Replaces useFormContext dependency with self-contained form management
 */
export function useBundleForm({
  components,
  bundleProduct,
  defaultConfiguration,
  onSubmit,
}: UseBundleFormProps): UseBundleFormReturn {
  // Create dynamic schema based on components
  const bundleSchema = useMemo(
    () => createBundleSchema(components),
    [components]
  );

  // URL param takes highest priority for restoring state (shared links, page reload).
  // Priority chain: URL param > defaultConfiguration prop > API config > auto-select
  const effectiveDefaultConfiguration = useMemo(() => {
    const urlConfig = getUrlBundleConfig();
    return urlConfig || defaultConfiguration;
  }, [defaultConfiguration]);

  // Calculate default values
  const defaultValues = useMemo(
    () => createBundleDefaultValues(components, bundleProduct, effectiveDefaultConfiguration),
    [components, bundleProduct, effectiveDefaultConfiguration]
  );

  // Initialize form with Zod resolver
  const form = useForm<BundleFormData>({
    resolver: zodResolver(bundleSchema as any),
    defaultValues,
    mode: 'onChange', // Enable real-time validation
  });

  const { 
    handleSubmit: rhfHandleSubmit,
    watch,
    setValue,
    formState: { errors: formErrors, isValid },
    reset: rhfReset,
  } = form;

  // Watch all form values for real-time updates
  const selectedOptions = watch();

  // Convert form errors to simple string format for backward compatibility
  const errors = useMemo(() => {
    const errorMessages: Record<string, string> = {};
    
    Object.entries(formErrors).forEach(([key, error]) => {
      if (error?.message) {
        errorMessages[key] = error.message;
      }
    });
    
    return errorMessages;
  }, [formErrors]);

  // Handle component selection - maintains existing API
  const handleComponentSelection = useCallback(
    (componentKey: string, optionId: string, quantity: number, variationId?: string) => {
      const component = components[componentKey];
      if (!component) return;

      // Use variationId if provided (for parent products)
      const selectionKey = variationId ? `${optionId}:${variationId}` : optionId;
      
      setValue(`${componentKey}.${selectionKey}`, quantity, {
        shouldValidate: true,
        shouldDirty: true,
      });

      // Handle single-select components (max=1) - clear other selections
      if (component.max === 1 && quantity > 0) {
        const currentSelections = selectedOptions[componentKey] || {};
        Object.keys(currentSelections).forEach(key => {
          if (key !== selectionKey) {
            setValue(`${componentKey}.${key}`, 0, {
              shouldValidate: true,
              shouldDirty: true,
            });
          }
        });
      }

      // Remove zero quantities
      if (quantity === 0) {
        const currentSelections = { ...selectedOptions[componentKey] };
        delete currentSelections[selectionKey];
        
        // Update the entire component object
        setValue(componentKey, currentSelections, {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    },
    [components, selectedOptions, setValue]
  );

  // Handle form submission
  const handleSubmit = useCallback(
    (callback?: (data: BundleFormData) => void) => 
      rhfHandleSubmit((data) => {
        const finalCallback = callback || onSubmit;
        if (finalCallback) {
          finalCallback(data);
        }
      }),
    [rhfHandleSubmit, onSubmit]
  );

  // Reset form to default values (respects URL param > prop > API > auto-select priority)
  const reset = useCallback(() => {
    const resetConfig = getUrlBundleConfig() || defaultConfiguration;
    const newDefaults = createBundleDefaultValues(components, bundleProduct, resetConfig);
    rhfReset(newDefaults);
  }, [rhfReset, components, bundleProduct, defaultConfiguration]);

  return {
    form,
    selectedOptions,
    isValid,
    errors,
    handleComponentSelection,
    handleSubmit,
    reset,
  };
}

/**
 * Helper hook for getting API-formatted selections from form data
 */
export function useApiFormattedSelections(selectedOptions: BundleFormData) {
  return useMemo(
    () => convertSelectionsForAPI(selectedOptions),
    [selectedOptions]
  );
}