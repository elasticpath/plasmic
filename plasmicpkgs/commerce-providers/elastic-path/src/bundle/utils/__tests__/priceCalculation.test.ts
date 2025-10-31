import { calculateBundlePrice, formatPriceDisplay } from "../priceCalculation";
import { ElasticPathBundleProduct } from "../../types";

describe("priceCalculation", () => {
  describe("calculateBundlePrice", () => {
    const mockBundleProduct: ElasticPathBundleProduct = {
      id: "bundle-123",
      attributes: {
        sku: "BUNDLE-SKU",
        components: {
          component1: { name: "Component 1", options: [] }
        }
      },
      meta: {
        display_price: {
          without_tax: {
            formatted: "$99.99"
          }
        }
      }
    } as ElasticPathBundleProduct;

    it("uses configured bundle price when available", () => {
      const configuredBundle = {
        data: {
          ...mockBundleProduct,
          meta: {
            display_price: {
              without_tax: {
                formatted: "$149.99"
              }
            }
          }
        }
      };

      const result = calculateBundlePrice(mockBundleProduct, configuredBundle);

      expect(result.currentPrice).toBe("$149.99");
      expect(result.isFixedPrice).toBe(true);
      expect(result.displayProduct).toBe(configuredBundle.data);
      expect(result.displayComponents).toBe(configuredBundle.data.attributes.components);
    });

    it("falls back to bundle product price when no configured bundle", () => {
      const result = calculateBundlePrice(mockBundleProduct);

      expect(result.currentPrice).toBe("$99.99");
      expect(result.isFixedPrice).toBe(true);
      expect(result.displayProduct).toBe(mockBundleProduct);
      expect(result.displayComponents).toBe(mockBundleProduct.attributes.components);
    });

    it("detects cumulative pricing when no SKU", () => {
      const cumulativeBundle = {
        ...mockBundleProduct,
        attributes: {
          components: { component1: { name: "Component 1", options: [] } }
          // no sku
        }
      } as ElasticPathBundleProduct;

      const result = calculateBundlePrice(cumulativeBundle);

      expect(result.isFixedPrice).toBe(false);
    });

    it("handles missing price information", () => {
      const bundleWithoutPrice = {
        ...mockBundleProduct,
        meta: {}
      } as ElasticPathBundleProduct;

      const result = calculateBundlePrice(bundleWithoutPrice);

      expect(result.currentPrice).toBeUndefined();
      expect(result.isFixedPrice).toBe(true);
    });

    it("handles undefined bundle product", () => {
      const result = calculateBundlePrice(undefined);

      expect(result.currentPrice).toBeUndefined();
      expect(result.isFixedPrice).toBe(false);
      expect(result.displayComponents).toEqual({});
    });

    it("handles configured bundle with different components", () => {
      const configuredBundle = {
        data: {
          ...mockBundleProduct,
          attributes: {
            sku: "CONFIGURED-SKU",
            components: {
              component1: { name: "Updated Component 1", options: [] },
              component2: { name: "New Component 2", options: [] }
            }
          }
        }
      };

      const result = calculateBundlePrice(mockBundleProduct, configuredBundle);

      expect(result.displayComponents).toBe(configuredBundle.data.attributes.components);
      expect(Object.keys(result.displayComponents)).toHaveLength(2);
    });

    it("falls back to original components when configured bundle has no components", () => {
      const configuredBundle = {
        data: {
          ...mockBundleProduct,
          attributes: {}
        }
      };

      const result = calculateBundlePrice(mockBundleProduct, configuredBundle);

      expect(result.displayComponents).toBe(mockBundleProduct.attributes.components);
    });
  });

  describe("formatPriceDisplay", () => {
    it("shows calculating message when configuring", () => {
      expect(formatPriceDisplay("$99.99", true, true)).toBe("Calculating price...");
    });

    it("shows price when available and not configuring", () => {
      expect(formatPriceDisplay("$99.99", false, true)).toBe("$99.99");
    });

    it("shows fixed price fallback when no price available", () => {
      expect(formatPriceDisplay(undefined, false, true)).toBe("Price not available");
    });

    it("shows cumulative price fallback when no price available", () => {
      expect(formatPriceDisplay(undefined, false, false)).toBe("Starting from base price");
    });

    it("shows calculating message even when price is available if configuring", () => {
      expect(formatPriceDisplay("$99.99", true, false)).toBe("Calculating price...");
    });

    it("handles empty string price", () => {
      expect(formatPriceDisplay("", false, true)).toBe("Price not available");
    });

    it("uses default parameters correctly", () => {
      expect(formatPriceDisplay("$99.99")).toBe("$99.99");
      expect(formatPriceDisplay(undefined)).toBe("Price not available");
    });
  });
});