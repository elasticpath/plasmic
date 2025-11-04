import { ParentProductInfo, ChildProduct } from "../use-parent-products";

/**
 * Helper function to find option IDs for a given child product ID in the variation matrix
 */
export const getOptionsFromSkuId = (
  skuId: string,
  entry: any,
  options: string[] = []
): string[] | undefined => {
  if (typeof entry === "string") {
    return entry === skuId ? options : undefined;
  }

  let acc: string[] | undefined;
  Object.keys(entry).every((key) => {
    const result = getOptionsFromSkuId(skuId, entry[key], [...options, key]);
    if (result) {
      acc = result;
      return false;
    }
    return true;
  });
  return acc;
};

/**
 * Find the matching child product based on selected variations
 */
export const findMatchingVariant = (
  selections: Record<string, string>,
  parentInfo: ParentProductInfo
): ChildProduct | null => {
  if (!parentInfo.children || !parentInfo.variationMatrix || Object.keys(selections).length === 0) {
    return null;
  }

  const variations = parentInfo.variations || [];

  // Check if we have all variations selected
  if (Object.keys(selections).length !== variations.length) {
    return null;
  }

  return parentInfo.children.find((child) => {
    // Find the option IDs for this child product
    const optionIds = getOptionsFromSkuId(child.id, parentInfo.variationMatrix);
    
    if (!optionIds || optionIds.length === 0) {
      return false;
    }

    // Check if this child matches all selected variation values
    return Object.entries(selections).every(([variationId, selectedValue]) => {
      // Find the variation and option that matches this selection
      const variation = variations.find(v => v.id === variationId);
      const option = variation?.options?.find(opt => opt.name === selectedValue);
      
      return option && optionIds.includes(option.id);
    });
  }) || null;
};