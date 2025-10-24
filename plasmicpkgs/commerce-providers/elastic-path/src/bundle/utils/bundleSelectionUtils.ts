import { ComponentProduct } from "../types";

/**
 * Helper function to sort items by sort_order
 */
export const sortByOrder = <T extends { sort_order?: number | null }>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    const orderA = a.sort_order ?? Number.MAX_VALUE;
    const orderB = b.sort_order ?? Number.MAX_VALUE;
    return orderA - orderB;
  });
};

/**
 * Convert parent product selections to API format
 * Transforms parent:child format to just child ID for API calls
 */
export const convertSelectionsForAPI = (
  selections: Record<string, Record<string, number>>
): Record<string, Record<string, number>> => {
  const apiSelections: Record<string, Record<string, number>> = {};
  
  // Special form fields to exclude from API calls
  const excludedFields = ['BundleConfiguration', 'ConfiguredBundleId'];
  
  Object.entries(selections).forEach(([componentKey, options]) => {
    // Skip excluded form fields
    if (excludedFields.includes(componentKey)) {
      return;
    }
    
    apiSelections[componentKey] = {};
    
    Object.entries(options).forEach(([selectionKey, quantity]) => {
      if (selectionKey.includes(':')) {
        // Parent product variation: use the child product ID
        const [parentId, childId] = selectionKey.split(':');
        apiSelections[componentKey][childId] = quantity;
      } else {
        // Simple product: use as-is
        apiSelections[componentKey][selectionKey] = quantity;
      }
    });
  });
  
  return apiSelections;
};

/**
 * Check if two selection objects are equal (for avoiding unnecessary API calls)
 */
export const areSelectionsEqual = (
  selections1: Record<string, Record<string, number>>,
  selections2: Record<string, Record<string, number>>
): boolean => {
  const keys1 = Object.keys(selections1);
  const keys2 = Object.keys(selections2);
  
  if (keys1.length !== keys2.length) return false;
  
  for (const componentKey of keys1) {
    if (!selections2[componentKey]) return false;
    
    const options1 = selections1[componentKey];
    const options2 = selections2[componentKey];
    
    const optionKeys1 = Object.keys(options1);
    const optionKeys2 = Object.keys(options2);
    
    if (optionKeys1.length !== optionKeys2.length) return false;
    
    for (const optionId of optionKeys1) {
      if (options1[optionId] !== options2[optionId]) return false;
    }
  }
  
  return true;
};

/**
 * Get default selections for required components
 */
export const getDefaultSelections = (
  components: Record<string, ComponentProduct>,
  existingSelections?: Record<string, Record<string, number>>
): Record<string, Record<string, number>> => {
  const defaultSelections: Record<string, Record<string, number>> = {
    ...existingSelections
  };
  
  Object.entries(components).forEach(([componentKey, component]) => {
    const hasSelection = defaultSelections[componentKey] && 
      Object.keys(defaultSelections[componentKey]).length > 0;
    
    if (!hasSelection && component.min && component.min > 0 && component.options?.length) {
      // Find default option or fall back to first option
      const defaultOption = component.options.find(opt => opt.default) || component.options[0];
      if (defaultOption.id) {
        if (!defaultSelections[componentKey]) {
          defaultSelections[componentKey] = {};
        }
        defaultSelections[componentKey][defaultOption.id] = defaultOption.quantity || 1;
      }
    }
  });
  
  return defaultSelections;
};