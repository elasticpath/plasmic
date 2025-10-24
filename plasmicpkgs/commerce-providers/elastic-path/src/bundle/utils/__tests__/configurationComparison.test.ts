import { isMatchingDefaultConfiguration, shouldTriggerConfiguration } from "../configurationComparison";
import { ElasticPathBundleProduct } from "../../types";

describe("configurationComparison", () => {
  describe("isMatchingDefaultConfiguration", () => {
    it("returns false when bundle product has no default configuration", () => {
      const currentSelections = { component1: { option1: 1 } };
      const bundleProduct = {} as ElasticPathBundleProduct;
      
      expect(isMatchingDefaultConfiguration(currentSelections, bundleProduct)).toBe(false);
    });

    it("returns false when bundle product is undefined", () => {
      const currentSelections = { component1: { option1: 1 } };
      
      expect(isMatchingDefaultConfiguration(currentSelections, undefined)).toBe(false);
    });

    it("returns true when selections exactly match default configuration", () => {
      const currentSelections = {
        component1: { option1: 1, option2: 2 },
        component2: { option3: 1 }
      };

      const bundleProduct = {
        meta: {
          bundle_configuration: {
            selected_options: {
              component1: { option1: BigInt(1), option2: BigInt(2) },
              component2: { option3: BigInt(1) }
            }
          }
        }
      } as ElasticPathBundleProduct;

      expect(isMatchingDefaultConfiguration(currentSelections, bundleProduct)).toBe(true);
    });

    it("returns false when selections have different quantities", () => {
      const currentSelections = {
        component1: { option1: 2 } // Different quantity
      };

      const bundleProduct = {
        meta: {
          bundle_configuration: {
            selected_options: {
              component1: { option1: BigInt(1) }
            }
          }
        }
      } as ElasticPathBundleProduct;

      expect(isMatchingDefaultConfiguration(currentSelections, bundleProduct)).toBe(false);
    });

    it("returns false when selections have different options", () => {
      const currentSelections = {
        component1: { option2: 1 } // Different option
      };

      const bundleProduct = {
        meta: {
          bundle_configuration: {
            selected_options: {
              component1: { option1: BigInt(1) }
            }
          }
        }
      } as ElasticPathBundleProduct;

      expect(isMatchingDefaultConfiguration(currentSelections, bundleProduct)).toBe(false);
    });

    it("returns false when selections have different components", () => {
      const currentSelections = {
        component2: { option1: 1 } // Different component
      };

      const bundleProduct = {
        meta: {
          bundle_configuration: {
            selected_options: {
              component1: { option1: BigInt(1) }
            }
          }
        }
      } as ElasticPathBundleProduct;

      expect(isMatchingDefaultConfiguration(currentSelections, bundleProduct)).toBe(false);
    });

    it("handles BigInt conversion correctly", () => {
      const currentSelections = {
        component1: { option1: 999999999999999 } // Large number
      };

      const bundleProduct = {
        meta: {
          bundle_configuration: {
            selected_options: {
              component1: { option1: BigInt(999999999999999) }
            }
          }
        }
      } as ElasticPathBundleProduct;

      expect(isMatchingDefaultConfiguration(currentSelections, bundleProduct)).toBe(true);
    });
  });

  describe("shouldTriggerConfiguration", () => {
    const mockBundleProduct = {
      meta: {
        bundle_configuration: {
          selected_options: {
            component1: { option1: BigInt(1) }
          }
        }
      }
    } as ElasticPathBundleProduct;

    it("returns false when not initialized", () => {
      expect(shouldTriggerConfiguration(
        false, // not initialized
        true,
        { component1: { option1: 1 } },
        mockBundleProduct
      )).toBe(false);
    });

    it("returns false when not valid", () => {
      expect(shouldTriggerConfiguration(
        true,
        false, // not valid
        { component1: { option1: 1 } },
        mockBundleProduct
      )).toBe(false);
    });

    it("returns false when no selections", () => {
      expect(shouldTriggerConfiguration(
        true,
        true,
        {}, // no selections
        mockBundleProduct
      )).toBe(false);
    });

    it("returns false when selections match default configuration", () => {
      expect(shouldTriggerConfiguration(
        true,
        true,
        { component1: { option1: 1 } }, // matches default
        mockBundleProduct
      )).toBe(false);
    });

    it("returns true when all conditions are met and selections differ from default", () => {
      expect(shouldTriggerConfiguration(
        true,
        true,
        { component1: { option1: 2 } }, // different from default
        mockBundleProduct
      )).toBe(true);
    });

    it("returns true when no default configuration exists", () => {
      expect(shouldTriggerConfiguration(
        true,
        true,
        { component1: { option1: 1 } },
        undefined // no bundle product
      )).toBe(true);
    });
  });
});