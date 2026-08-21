import { z } from 'zod';
import { ComponentProduct, ComponentProductOption } from '../types';
import { createLogger } from "../../utils/logger";

const log = createLogger("bundleSchema");

/**
 * Creates a dynamic Zod schema based on bundle components
 * Replaces manual validation logic with schema-based validation
 */
export function createBundleSchema(components: Record<string, ComponentProduct>) {
  const componentSchemas: Record<string, z.ZodSchema> = {};

  Object.entries(components).forEach(([componentKey, component]) => {
    const min = component.min ?? 0;
    const max = component.max ?? Number.MAX_SAFE_INTEGER;
    const componentName = component.name || componentKey;

    // Base schema for option selections (optionId -> quantity)
    let optionSchema: z.ZodSchema = z.record(
      z.string(), // option ID (can be "parentId:childId" for variations)
      z.number().min(1, "Quantity must be at least 1") // quantity
    );

    // Component and option constraints, reported against this component's own
    // path. `refine`'s `path` is relative to the schema being refined, so a
    // `path: [componentKey]` here produced `[componentKey, componentKey]` —
    // which `useBundleForm` then failed to read, leaving every bundle silently
    // valid. `superRefine` with no path keeps the issue on the component.
    optionSchema = optionSchema.superRefine(
      (options: Record<string, number>, ctx: z.RefinementCtx) => {
        const selected = Object.values(options).reduce(
          (sum: number, qty: number) => sum + qty,
          0
        );

        if (min > 0 && selected < min) {
          const remaining = min - selected;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              min === max
                ? min === 1
                  ? `Please select one option for ${componentName}`
                  : `Please select exactly ${min} options for ${componentName}`
                : remaining === 1
                ? `Please select 1 more option for ${componentName}`
                : `Please select ${remaining} more options for ${componentName} (minimum: ${min})`,
          });
        }

        if (max < Number.MAX_SAFE_INTEGER && selected > max) {
          const excess = selected - max;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              excess === 1
                ? `Please remove 1 option from ${componentName} (maximum: ${max})`
                : `Please remove ${excess} options from ${componentName} (maximum: ${max})`,
          });
        }

        // Per-option quantity constraints
        for (const [optionId, quantity] of Object.entries(options)) {
          // Handle both direct IDs and parent:child IDs
          const baseOptionId = optionId.includes(":")
            ? optionId.split(":")[0]
            : optionId;
          const option = component.options?.find(
            (opt) => opt.id === baseOptionId
          );
          if (!option) continue;

          const minQty = option.min;
          const maxQty = option.max;

          if (minQty !== null && minQty !== undefined && quantity < minQty) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${componentName}: this option requires at least ${minQty} (currently ${quantity})`,
            });
          }
          if (maxQty !== null && maxQty !== undefined && quantity > maxQty) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${componentName}: this option allows at most ${maxQty} (currently ${quantity})`,
            });
          }
        }
      }
    );

    // Handle optional vs required components
    componentSchemas[componentKey] = min === 0 
      ? optionSchema.optional().default({})  // Optional components default to empty
      : optionSchema.default({});             // Required components start empty but must be filled
  });

  return z.object(componentSchemas);
}

/**
 * Creates a schema for validating individual option quantities
 * Used for more granular validation when needed
 */
export function createOptionQuantitySchema(option: ComponentProductOption) {
  const min = option.min ?? 1;
  const max = option.max ?? option.quantity ?? 1;
  const optionName = option.id || 'option';
  
  return z.number()
    .min(min, `${optionName} requires at least ${min}`)
    .max(max, `${optionName} allows maximum ${max}`);
}

/**
 * Type inference helper for bundle form data
 */
export type BundleFormData = Record<string, Record<string, number>>;

/**
 * Creates default values for the bundle form based on bundle configuration
 */
export function createBundleDefaultValues(
  components: Record<string, ComponentProduct>,
  bundleProduct?: any,
  defaultConfiguration?: string
): BundleFormData {
  const defaults: BundleFormData = {};
  
  // Priority 1: Use defaultConfiguration prop if provided (base64 encoded)
  if (defaultConfiguration) {
    try {
      const decoded = JSON.parse(atob(defaultConfiguration));
      Object.assign(defaults, decoded);
    } catch (error) {
      log.error("Failed to parse default configuration", { error: error instanceof Error ? error.message : String(error) } as Record<string, unknown>);
    }
  }
  
  // Priority 2: Use bundle's API configuration.
  //
  // Per component, not per option: merging option-by-option let the catalog's
  // default selection reappear alongside a higher-priority choice. Selecting a
  // variation of a parent product stores `parentId:childId`, and the merge then
  // re-added the bare `parentId` — which Elastic Path rejects with "too many
  // selections". A component the caller has already spoken for is left alone.
  if (bundleProduct?.meta?.bundle_configuration?.selected_options) {
    const apiSelections = bundleProduct.meta.bundle_configuration.selected_options;

    Object.entries(apiSelections).forEach(([componentKey, options]: [string, any]) => {
      if (defaults[componentKey] && Object.keys(defaults[componentKey]).length > 0) {
        return;
      }
      defaults[componentKey] = {};
      // Convert BigInt values to numbers
      Object.entries(options).forEach(([optionId, quantity]) => {
        defaults[componentKey][optionId] = Number(quantity);
      });
    });
  }
  
  // Priority 3: Auto-select defaults for required components
  Object.entries(components).forEach(([componentKey, component]) => {
    const min = component.min ?? 0;
    
    // If component is required and has no selections, select default option
    if (min > 0 && (!defaults[componentKey] || Object.keys(defaults[componentKey]).length === 0)) {
      const defaultOption = component.options?.find(option => option.default) 
        || component.options?.[0];
      
      if (defaultOption?.id) {
        defaults[componentKey] = {
          [defaultOption.id]: defaultOption.quantity || 1
        };
      }
    }
    
    // Ensure all components have at least an empty object
    if (!defaults[componentKey]) {
      defaults[componentKey] = {};
    }
  });
  
  return defaults;
}