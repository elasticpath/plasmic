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
 *
 * Two things never reach Elastic Path:
 *
 * - A zero (or negative) quantity. `selected_options` quantities must be >= 1;
 *   a single zero entry fails the whole add with "Must be greater than or equal
 *   to 1", so a deselected option is dropped rather than sent as 0.
 * - A bare parent id whose variation has been chosen. The child selection
 *   supersedes it, and sending both counts as two selections against the
 *   component's max ("too many selections"), besides being rejected outright
 *   because a parent product is not purchasable.
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

    const entries = Object.entries(options ?? {}).filter(
      ([, quantity]) => typeof quantity === "number" && quantity > 0
    );

    // Parents whose variation is among the live selections.
    const supersededParents = new Set(
      entries
        .filter(([selectionKey]) => selectionKey.includes(":"))
        .map(([selectionKey]) => selectionKey.split(":")[0])
    );

    entries.forEach(([selectionKey, quantity]) => {
      if (selectionKey.includes(':')) {
        // Parent product variation: use the child product ID
        const [, childId] = selectionKey.split(':');
        apiSelections[componentKey][childId] = quantity;
      } else if (!supersededParents.has(selectionKey)) {
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