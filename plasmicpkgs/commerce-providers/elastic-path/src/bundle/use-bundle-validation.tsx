import { useMemo } from "react";
import { BundleConfiguration, ComponentProduct, ValidationResult } from "./types";

export function useBundleValidation(
  components: Record<string, ComponentProduct>,
  selectedOptions: Record<string, Record<string, number>>
): ValidationResult {
  return useMemo(() => {
    const errors: string[] = [];
    
    Object.entries(components).forEach(([componentKey, component]) => {
      const selections = selectedOptions[componentKey] || {};
      
      // For parent products, count each parent:child selection as one selection
      // but multiple variations of the same parent should count as separate selections
      const selectedCount = Object.values(selections).reduce(
        (sum, quantity) => sum + quantity,
        0
      );

      // Component-level validation
      if (component.min !== undefined && component.min !== null && selectedCount < component.min) {
        const componentName = component.name || componentKey;
        if (component.min === component.max) {
          if (component.min === 1) {
            errors.push(`Please select one option for ${componentName}`);
          } else {
            errors.push(`Please select exactly ${component.min} options for ${componentName}`);
          }
        } else {
          const remaining = component.min - selectedCount;
          if (remaining === 1) {
            errors.push(`Please select 1 more option for ${componentName}`);
          } else {
            errors.push(`Please select ${remaining} more options for ${componentName} (minimum: ${component.min})`);
          }
        }
      }

      if (component.max !== undefined && component.max !== null && selectedCount > component.max) {
        const componentName = component.name || componentKey;
        const excess = selectedCount - component.max;
        if (excess === 1) {
          errors.push(`Please remove 1 option from ${componentName} (maximum: ${component.max})`);
        } else {
          errors.push(`Please remove ${excess} options from ${componentName} (maximum: ${component.max})`);
        }
      }

      // Option-level quantity validation
      component.options?.forEach((option) => {
        if (option.id && selections[option.id]) {
          const quantity = selections[option.id];
          const minQty = option.min;
          const maxQty = option.max;
          const optionName = option.id;

          if (minQty !== null && minQty !== undefined && quantity < minQty) {
            errors.push(`${optionName} requires at least ${minQty} (currently: ${quantity})`);
          }

          if (maxQty !== null && maxQty !== undefined && quantity > maxQty) {
            errors.push(`${optionName} allows maximum ${maxQty} (currently: ${quantity})`);
          }
        }
      });
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }, [components, selectedOptions]);
}

export function validateBundleSelection(
  components: Record<string, ComponentProduct>,
  selectedOptions: Record<string, Record<string, number>>
): ValidationResult {
  const errors: string[] = [];

  Object.entries(components).forEach(([componentKey, component]) => {
    const selections = selectedOptions[componentKey] || {};
    const selectedCount = Object.values(selections).reduce(
      (sum, quantity) => sum + quantity,
      0
    );

    if (component.min !== undefined && component.min !== null && selectedCount < component.min) {
      if (component.min === component.max) {
        errors.push(`Please select exactly ${component.min} ${component.name || componentKey}`);
      } else {
        errors.push(`Please select at least ${component.min} ${component.name || componentKey}`);
      }
    }

    if (component.max !== undefined && component.max !== null && selectedCount > component.max) {
      errors.push(`Please select at most ${component.max} ${component.name || componentKey}`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}