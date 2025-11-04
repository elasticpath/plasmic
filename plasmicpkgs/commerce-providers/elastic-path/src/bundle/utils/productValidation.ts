import { Product } from "../../types/product";
import { ElasticPathBundleProduct } from "../types";

export interface ProductValidationResult {
  isValid: boolean;
  isBundle: boolean;
  bundleProduct?: ElasticPathBundleProduct;
  components: Record<string, any>;
  errorMessage?: string;
}

/**
 * Validates and extracts bundle product information from a normalized product
 */
export function validateBundleProduct(normalizedProduct?: Product): ProductValidationResult {
  if (!normalizedProduct) {
    return {
      isValid: false,
      isBundle: false,
      components: {},
      errorMessage: "No product selected"
    };
  }

  const rawProduct = normalizedProduct.rawData?.data;
  
  if (!rawProduct) {
    return {
      isValid: false,
      isBundle: false,
      components: {},
      errorMessage: "Product data not available"
    };
  }

  // Check if this is a bundle product
  const isBundle = rawProduct.meta?.product_types?.[0] === "bundle";
  
  if (!isBundle) {
    return {
      isValid: false,
      isBundle: false,
      components: {},
      errorMessage: "This product is not a bundle"
    };
  }

  const bundleProduct = rawProduct as ElasticPathBundleProduct;
  const components = bundleProduct?.attributes?.components || {};

  return {
    isValid: true,
    isBundle: true,
    bundleProduct,
    components
  };
}

/**
 * Determines if a bundle has fixed pricing (has SKU) or cumulative pricing
 */
export function getBundlePricingType(bundleProduct?: ElasticPathBundleProduct): {
  isFixedPrice: boolean;
  pricingType: 'fixed' | 'cumulative';
} {
  const isFixedPrice = bundleProduct?.attributes?.sku !== undefined;
  return {
    isFixedPrice,
    pricingType: isFixedPrice ? 'fixed' : 'cumulative'
  };
}