import { ElasticPathBundleProduct } from "../types";

/**
 * Compares current selections with the bundle's default configuration
 * to determine if they match exactly
 */
export function isMatchingDefaultConfiguration(
  currentSelections: Record<string, Record<string, number>>,
  bundleProduct?: ElasticPathBundleProduct
): boolean {
  if (!bundleProduct?.meta?.bundle_configuration?.selected_options) {
    return false;
  }

  const apiSelections = bundleProduct.meta.bundle_configuration.selected_options;
  
  // Check if the keys match
  const apiKeys = Object.keys(apiSelections);
  const selectedKeys = Object.keys(currentSelections);
  if (apiKeys.length !== selectedKeys.length) return false;
  
  // Check each component and option
  for (const componentKey of apiKeys) {
    if (!currentSelections[componentKey]) return false;
    
    const apiOptions = apiSelections[componentKey];
    const selectedOptionsForComponent = currentSelections[componentKey];
    
    const apiOptionKeys = Object.keys(apiOptions);
    const selectedOptionKeys = Object.keys(selectedOptionsForComponent);
    
    if (apiOptionKeys.length !== selectedOptionKeys.length) return false;
    
    for (const optionId of apiOptionKeys) {
      const apiQty = Number(apiOptions[optionId]); // Convert BigInt to number
      const selectedQty = selectedOptionsForComponent[optionId];
      
      if (apiQty !== selectedQty) return false;
    }
  }
  
  return true;
}

/**
 * Determines if bundle configuration should be triggered based on current state
 */
export function shouldTriggerConfiguration(
  isInitialized: boolean,
  isValid: boolean,
  selectedOptions: Record<string, Record<string, number>>,
  bundleProduct?: ElasticPathBundleProduct
): boolean {
  // Skip configuration if not initialized, not valid, or no selections
  if (!isInitialized || !isValid || Object.keys(selectedOptions).length === 0) {
    return false;
  }
  
  // Skip if this looks like the initial default configuration
  if (isMatchingDefaultConfiguration(selectedOptions, bundleProduct)) {
    return false;
  }
  
  return true;
}