import { z } from 'zod';
import { ComponentProduct, ComponentProductOption } from '../types';

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

    // Add component-level min validation
    if (min > 0) {
      optionSchema = optionSchema.refine(
        (options: Record<string, number>) => {
          const totalCount = Object.values(options).reduce((sum: number, qty: number) => sum + qty, 0);
          return totalCount >= min;
        },
        {
          message: min === 1 
            ? `Please select one option for ${componentName}`
            : min === max
            ? `Please select exactly ${min} options for ${componentName}`
            : `Please select at least ${min} options for ${componentName}`,
          path: [componentKey]
        }
      );
    }

    // Add component-level max validation
    if (max < Number.MAX_SAFE_INTEGER) {
      optionSchema = optionSchema.refine(
        (options: Record<string, number>) => {
          const totalCount = Object.values(options).reduce((sum: number, qty: number) => sum + qty, 0);
          return totalCount <= max;
        },
        {
          message: `Maximum ${max} selections allowed for ${componentName}`,
          path: [componentKey]
        }
      );
    }

    // Add option-level quantity validation if any options have min/max constraints
    const hasQuantityConstraints = component.options?.some(option => 
      option.min !== null && option.min !== undefined ||
      option.max !== null && option.max !== undefined
    );

    if (hasQuantityConstraints && component.options) {
      optionSchema = optionSchema.refine(
        (options: Record<string, number>) => {
          // Validate each selected option's quantity constraints
          for (const [optionId, quantity] of Object.entries(options)) {
            // Find the option definition (handle both direct IDs and parent:child IDs)
            const baseOptionId = optionId.includes(':') ? optionId.split(':')[0] : optionId;
            const option = component.options?.find(opt => opt.id === baseOptionId);
            
            if (option) {
              const minQty = option.min;
              const maxQty = option.max;
              
              if (minQty !== null && minQty !== undefined && quantity < minQty) {
                return false;
              }
              
              if (maxQty !== null && maxQty !== undefined && quantity > maxQty) {
                return false;
              }
            }
          }
          return true;
        },
        {
          message: `One or more options have invalid quantities for ${componentName}`,
          path: [componentKey]
        }
      );
    }

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
      console.error("Failed to parse default configuration:", error);
    }
  }
  
  // Priority 2: Use bundle's API configuration
  if (bundleProduct?.meta?.bundle_configuration?.selected_options) {
    const apiSelections = bundleProduct.meta.bundle_configuration.selected_options;
    
    // Convert BigInt values to numbers
    Object.entries(apiSelections).forEach(([componentKey, options]: [string, any]) => {
      if (!defaults[componentKey]) {
        defaults[componentKey] = {};
      }
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