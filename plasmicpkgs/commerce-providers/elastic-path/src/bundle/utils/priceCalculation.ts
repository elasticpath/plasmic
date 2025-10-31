import { ElasticPathBundleProduct } from "../types";

export interface BundlePriceInfo {
  currentPrice?: string;
  isFixedPrice: boolean;
  displayProduct: ElasticPathBundleProduct;
  displayComponents: Record<string, any>;
}

/**
 * Calculates the current bundle price and determines display information
 */
export function calculateBundlePrice(
  bundleProduct?: ElasticPathBundleProduct,
  configuredBundle?: { data?: ElasticPathBundleProduct }
): BundlePriceInfo {
  // Calculate current price - prefer configured bundle price
  const currentPrice = configuredBundle?.data?.meta?.display_price?.without_tax?.formatted
    || bundleProduct?.meta?.display_price?.without_tax?.formatted;
  
  // Detect bundle pricing type (fixed price has SKU, cumulative doesn't)
  const isFixedPrice = bundleProduct?.attributes?.sku !== undefined;
  
  // Use configured bundle product data when available, fallback to original
  const displayProduct = (configuredBundle?.data || bundleProduct) as ElasticPathBundleProduct;
  const displayComponents = displayProduct?.attributes?.components || (bundleProduct?.attributes?.components || {});

  return {
    currentPrice,
    isFixedPrice,
    displayProduct,
    displayComponents
  };
}

/**
 * Formats price display text based on pricing type and configuration state
 */
export function formatPriceDisplay(
  currentPrice?: string,
  isConfiguring: boolean = false,
  isFixedPrice: boolean = true
): string {
  if (isConfiguring) {
    return "Calculating price...";
  }
  
  if (!currentPrice) {
    return isFixedPrice ? "Price not available" : "Starting from base price";
  }
  
  return currentPrice;
}