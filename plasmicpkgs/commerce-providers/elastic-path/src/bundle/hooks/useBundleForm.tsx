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
    getValues,
    reset: rhfReset,
  } = form;

  // Watch all form values for real-time updates
  const selectedOptions = watch();

  // Validity and messages come from the schema, run against the current
  // selections.
  //
  // Not from `formState`: react-hook-form only fills `errors` for fields it has
  // seen written, so a bundle that arrived invalid — a shared link, a catalog
  // default that cannot be satisfied — reported `isValid: false` with no message
  // to show for it. The shopper got a disabled button and no reason. One
  // safeParse answers both, for every path into the page.
  const { isValid, errors } = useMemo(() => {
    const result = (bundleSchema as { safeParse: (v: unknown) => any }).safeParse(
      selectedOptions
    );
    if (result.success) {
      return { isValid: true, errors: {} as Record<string, string> };
    }

    const errorMessages: Record<string, string> = {};
    for (const issue of result.error?.issues ?? []) {
      // First issue per component wins: one message per thing to fix.
      const key = String(issue.path?.[0] ?? "");
      if (key && !errorMessages[key]) {
        errorMessages[key] = issue.message;
      }
    }
    return { isValid: false, errors: errorMessages };
  }, [bundleSchema, selectedOptions]);

  // An option is either present with a positive quantity or absent: Elastic Path
  // rejects a zero-quantity selection outright. The current map comes from
  // `getValues`, not the render-time `watch()` snapshot, because switching a
  // variation fires two calls in one tick and a stale snapshot let the second
  // reinstate the child the first removed.
  const handleComponentSelection = useCallback(
    (componentKey: string, optionId: string, quantity: number, variationId?: string) => {
      const component = components[componentKey];
      if (!component) return;

      // Use variationId if provided (for parent products)
      const selectionKey = variationId ? `${optionId}:${variationId}` : optionId;

      const next: Record<string, number> = {};
      const isSingleSelect = component.max === 1 && quantity > 0;
      const current = (getValues(componentKey) ?? {}) as Record<string, number>;

      // An option resolves to exactly one variant, so choosing one supersedes
      // the option's other variants and its bare parent. Relying on the caller
      // to clear the old variant first is not enough: EPBundleVariationPicker
      // never passes `selectedVariationId`, so nothing is cleared and every
      // switch left another child behind.
      const supersedesVariants = !!variationId && quantity > 0;

      // The same rule read the other way. Choosing a variation also toggles the
      // option checkbox, which writes the bare parent with no variationId, so
      // whichever write lands last the option must not count twice.
      const supersededByVariant =
        !variationId &&
        quantity > 0 &&
        Object.keys(current).some((key) => key.startsWith(`${optionId}:`));

      Object.entries(current).forEach(([key, qty]) => {
        if (key === selectionKey) return; // rewritten below
        if (isSingleSelect) return; // single-select: this choice replaces the rest
        if (
          supersedesVariants &&
          (key === optionId || key.startsWith(`${optionId}:`))
        ) {
          return;
        }
        if (qty > 0) next[key] = qty;
      });

      if (quantity > 0 && !supersededByVariant) {
        next[selectionKey] = quantity;
      }

      setValue(componentKey, next, {
        shouldValidate: true,
        shouldDirty: true,
      });
    },
    [components, getValues, setValue]
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