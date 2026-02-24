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
 * Find the matching child product based on selected variations.
 *
 * `selections` maps variationId → option ID (not display label).
 * This avoids fragile name-based matching and allows duplicate-named
 * variation options to coexist safely.
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
    // Find the option IDs for this child product in the variation matrix
    const optionIds = getOptionsFromSkuId(child.id, parentInfo.variationMatrix);

    if (!optionIds || optionIds.length === 0) {
      return false;
    }

    // selections values are now option IDs — direct comparison against the matrix
    return Object.values(selections).every((selectedOptionId) =>
      optionIds.includes(selectedOptionId)
    );
  }) || null;
};