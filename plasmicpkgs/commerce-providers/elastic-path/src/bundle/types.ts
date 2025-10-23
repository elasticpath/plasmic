import type { Product as ElasticPathProduct, BundleConfiguration as EPBundleConfiguration, ProductData } from "@epcc-sdk/sdks-shopper";
import { Product } from "../types/product";

// Re-export EP SDK types for bundles
export type BundleConfiguration = EPBundleConfiguration;

// The raw EP product type that includes bundle data
export interface ElasticPathBundleProduct extends ElasticPathProduct {
  attributes?: ElasticPathProduct["attributes"] & {
    components?: {
      [key: string]: ComponentProduct;
    };
  };
  meta?: ElasticPathProduct["meta"] & {
    product_types?: string[];
    bundle_configuration?: BundleConfiguration;
  };
}

// Extend the normalized Product type for bundles to include raw EP data
export interface BundleProduct extends Product {
  // Store the raw EP product data for bundle-specific features
  rawData?: ElasticPathBundleProduct;
}

// Component types based on EP API structure - matching SDK exactly
export interface ComponentProduct {
  name?: string;
  options?: ComponentProductOption[];
  min?: number | null;
  max?: number | null;
  sort_order?: number | null;
}

export interface ComponentProductOption {
  id?: string;
  type?: "product";
  quantity?: number;
  min?: number | null;
  max?: number | null;
  sort_order?: number | null;
  default?: boolean | null;
}

// Validation types
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}