import { validateBundleProduct, getBundlePricingType } from "../productValidation";
import { Product } from "../../../types/product";
import { ElasticPathBundleProduct } from "../../types";

describe("productValidation", () => {
  describe("validateBundleProduct", () => {
    it("returns error when no product is provided", () => {
      const result = validateBundleProduct(undefined);
      
      expect(result).toEqual({
        isValid: false,
        isBundle: false,
        components: {},
        errorMessage: "No product selected"
      });
    });

    it("returns error when product has no raw data", () => {
      const product = { rawData: undefined } as Product;
      const result = validateBundleProduct(product);
      
      expect(result).toEqual({
        isValid: false,
        isBundle: false,
        components: {},
        errorMessage: "Product data not available"
      });
    });

    it("returns error when product data is missing", () => {
      const product = { rawData: { data: null } } as Product;
      const result = validateBundleProduct(product);
      
      expect(result).toEqual({
        isValid: false,
        isBundle: false,
        components: {},
        errorMessage: "Product data not available"
      });
    });

    it("returns error when product is not a bundle", () => {
      const product = {
        rawData: {
          data: {
            meta: {
              product_types: ["simple"]
            }
          }
        }
      } as Product;
      
      const result = validateBundleProduct(product);
      
      expect(result).toEqual({
        isValid: false,
        isBundle: false,
        components: {},
        errorMessage: "This product is not a bundle"
      });
    });

    it("returns success for valid bundle product", () => {
      const bundleData = {
        id: "bundle-123",
        meta: {
          product_types: ["bundle"]
        },
        attributes: {
          components: {
            component1: { name: "Component 1", options: [] },
            component2: { name: "Component 2", options: [] }
          }
        }
      };

      const product = {
        rawData: { data: bundleData }
      } as Product;
      
      const result = validateBundleProduct(product);
      
      expect(result).toEqual({
        isValid: true,
        isBundle: true,
        bundleProduct: bundleData,
        components: bundleData.attributes.components
      });
    });

    it("handles bundle product with no components", () => {
      const bundleData = {
        id: "bundle-123",
        meta: {
          product_types: ["bundle"]
        },
        attributes: {}
      };

      const product = {
        rawData: { data: bundleData }
      } as Product;
      
      const result = validateBundleProduct(product);
      
      expect(result).toEqual({
        isValid: true,
        isBundle: true,
        bundleProduct: bundleData,
        components: {}
      });
    });

    it("handles product with missing meta", () => {
      const product = {
        rawData: {
          data: {
            id: "product-123"
            // no meta
          }
        }
      } as Product;
      
      const result = validateBundleProduct(product);
      
      expect(result).toEqual({
        isValid: false,
        isBundle: false,
        components: {},
        errorMessage: "This product is not a bundle"
      });
    });
  });

  describe("getBundlePricingType", () => {
    it("returns fixed pricing when bundle has SKU", () => {
      const bundleProduct = {
        attributes: {
          sku: "BUNDLE-SKU-123"
        }
      } as ElasticPathBundleProduct;
      
      const result = getBundlePricingType(bundleProduct);
      
      expect(result).toEqual({
        isFixedPrice: true,
        pricingType: "fixed"
      });
    });

    it("returns cumulative pricing when bundle has no SKU", () => {
      const bundleProduct = {
        attributes: {
          name: "Bundle Product"
          // no sku
        }
      } as ElasticPathBundleProduct;
      
      const result = getBundlePricingType(bundleProduct);
      
      expect(result).toEqual({
        isFixedPrice: false,
        pricingType: "cumulative"
      });
    });

    it("returns cumulative pricing when bundle product is undefined", () => {
      const result = getBundlePricingType(undefined);
      
      expect(result).toEqual({
        isFixedPrice: false,
        pricingType: "cumulative"
      });
    });

    it("returns cumulative pricing when bundle has undefined SKU", () => {
      const bundleProduct = {
        attributes: {
          sku: undefined
        }
      } as ElasticPathBundleProduct;
      
      const result = getBundlePricingType(bundleProduct);
      
      expect(result).toEqual({
        isFixedPrice: false,
        pricingType: "cumulative"
      });
    });

    it("returns fixed pricing when bundle has empty string SKU", () => {
      const bundleProduct = {
        attributes: {
          sku: ""
        }
      } as ElasticPathBundleProduct;
      
      const result = getBundlePricingType(bundleProduct);
      
      expect(result).toEqual({
        isFixedPrice: true,
        pricingType: "fixed"
      });
    });
  });
});