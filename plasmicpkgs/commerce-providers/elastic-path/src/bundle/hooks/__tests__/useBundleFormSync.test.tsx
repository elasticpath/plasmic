/**
 * @jest-environment jsdom
 */
import { renderHook } from "@testing-library/react";

// Mock react-hook-form
const mockParentSetValue = jest.fn();
const mockFormSetValue = jest.fn();

jest.mock("react-hook-form", () => ({
  useFormContext: jest.fn(() => ({
    setValue: mockParentSetValue,
  })),
}));

// Mock bundleSelectionUtils
jest.mock("../../utils/bundleSelectionUtils", () => ({
  convertSelectionsForAPI: jest.fn((selections) => {
    const result: Record<string, Record<string, number>> = {};
    Object.entries(selections).forEach(([compKey, options]: [string, any]) => {
      if (compKey === "BundleConfiguration" || compKey === "ConfiguredBundleId")
        return;
      result[compKey] = {};
      Object.entries(options).forEach(([key, qty]: [string, any]) => {
        if (key.includes(":")) {
          result[compKey][key.split(":")[1]] = qty;
        } else {
          result[compKey][key] = qty;
        }
      });
    });
    return result;
  }),
}));

// Mock logger
jest.mock("../../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const { useBundleFormSync } = require("../useBundleFormSync");
const { useFormContext } = require("react-hook-form");
const { convertSelectionsForAPI } = require("../../utils/bundleSelectionUtils");

describe("useBundleFormSync", () => {
  const mockForm = {
    setValue: mockFormSetValue,
    watch: jest.fn(),
    handleSubmit: jest.fn(),
    formState: { errors: {} },
    reset: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock to return parent form by default
    (useFormContext as jest.Mock).mockReturnValue({
      setValue: mockParentSetValue,
    });
  });

  describe("configuredBundle sync", () => {
    it("updates internal form with configured bundle data", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: {},
          isInitialized: true,
          form: mockForm as any,
          configuredBundle: {
            data: {
              id: "configured-123",
              meta: {
                bundle_configuration: {
                  selected_options: {
                    processor: { "opt-1": BigInt(1) },
                    memory: { "mem-1": BigInt(2) },
                  },
                },
              },
            },
          },
        })
      );

      // Should update internal form with serialized config
      expect(mockFormSetValue).toHaveBeenCalledWith("BundleConfiguration", {
        selected_options: {
          processor: { "opt-1": 1 },
          memory: { "mem-1": 2 },
        },
      });
      expect(mockFormSetValue).toHaveBeenCalledWith(
        "ConfiguredBundleId",
        "configured-123"
      );
    });

    it("updates parent form context with configured bundle data", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: {},
          isInitialized: true,
          form: mockForm as any,
          configuredBundle: {
            data: {
              id: "configured-123",
              meta: {
                bundle_configuration: {
                  selected_options: {
                    processor: { "opt-1": BigInt(1) },
                  },
                },
              },
            },
          },
        })
      );

      expect(mockParentSetValue).toHaveBeenCalledWith("BundleConfiguration", {
        selected_options: {
          processor: { "opt-1": 1 },
        },
      });
      expect(mockParentSetValue).toHaveBeenCalledWith(
        "ConfiguredBundleId",
        "configured-123"
      );
    });

    it("does not update forms when no configuredBundle", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: {},
          isInitialized: true,
          form: mockForm as any,
          configuredBundle: undefined,
        })
      );

      // Only the selected options sync effect should fire, not the configuredBundle one
      const bundleConfigCalls = mockFormSetValue.mock.calls.filter(
        (call: any[]) => call[0] === "BundleConfiguration"
      );
      expect(bundleConfigCalls).toHaveLength(0);
    });

    it("skips ConfiguredBundleId when no id on configured bundle", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: {},
          isInitialized: true,
          form: mockForm as any,
          configuredBundle: {
            data: {
              meta: {
                bundle_configuration: {
                  selected_options: {
                    processor: { "opt-1": BigInt(1) },
                  },
                },
              },
            },
          },
        })
      );

      const idCalls = mockFormSetValue.mock.calls.filter(
        (call: any[]) => call[0] === "ConfiguredBundleId"
      );
      expect(idCalls).toHaveLength(0);
    });
  });

  describe("selected options sync to parent form", () => {
    it("syncs selected options to parent form when initialized", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: { processor: { "opt-1": 1 } },
          isInitialized: true,
        })
      );

      expect(convertSelectionsForAPI).toHaveBeenCalledWith({
        processor: { "opt-1": 1 },
      });
      expect(mockParentSetValue).toHaveBeenCalledWith("BundleConfiguration", {
        selected_options: { processor: { "opt-1": 1 } },
      });
    });

    it("does not sync when not initialized", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: { processor: { "opt-1": 1 } },
          isInitialized: false,
        })
      );

      // Parent form setValue should not be called for option sync
      expect(mockParentSetValue).not.toHaveBeenCalled();
    });

    it("does not sync when parent form is not available", () => {
      (useFormContext as jest.Mock).mockReturnValue(null);

      renderHook(() =>
        useBundleFormSync({
          selectedOptions: { processor: { "opt-1": 1 } },
          isInitialized: true,
        })
      );

      expect(mockParentSetValue).not.toHaveBeenCalled();
    });

    it("does not sync when selections are empty (no component data)", () => {
      (convertSelectionsForAPI as jest.Mock).mockReturnValueOnce({});

      renderHook(() =>
        useBundleFormSync({
          selectedOptions: {},
          isInitialized: true,
        })
      );

      // Should not call setValue for BundleConfiguration when no component selections
      const bundleConfigCalls = mockParentSetValue.mock.calls.filter(
        (call: any[]) => call[0] === "BundleConfiguration"
      );
      expect(bundleConfigCalls).toHaveLength(0);
    });
  });

  describe("URL update", () => {
    const originalLocation = window.location;
    const mockReplaceState = jest.fn();

    beforeEach(() => {
      // Mock window.location and history
      delete (window as any).location;
      (window as any).location = {
        href: "https://example.com/product/test-bundle",
      };
      window.history.replaceState = mockReplaceState;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it("updates URL with bundle_config param when updateUrlOnChange is true", () => {
      const selectedOptions = { processor: { "opt-1": 1 } };

      renderHook(() =>
        useBundleFormSync({
          selectedOptions,
          updateUrlOnChange: true,
          isInitialized: true,
        })
      );

      expect(mockReplaceState).toHaveBeenCalled();
      const url = mockReplaceState.mock.calls[0][2];
      expect(url).toContain("bundle_config=");
      // Verify the encoded value is valid base64
      const urlObj = new URL(url);
      const encoded = urlObj.searchParams.get("bundle_config");
      expect(encoded).toBeTruthy();
      const decoded = JSON.parse(atob(encoded!));
      expect(decoded).toEqual(selectedOptions);
    });

    it("does not update URL when updateUrlOnChange is false", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: { processor: { "opt-1": 1 } },
          updateUrlOnChange: false,
          isInitialized: true,
        })
      );

      expect(mockReplaceState).not.toHaveBeenCalled();
    });

    it("does not update URL when not initialized", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: { processor: { "opt-1": 1 } },
          updateUrlOnChange: true,
          isInitialized: false,
        })
      );

      expect(mockReplaceState).not.toHaveBeenCalled();
    });

    it("does not update URL when selections are empty", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: {},
          updateUrlOnChange: true,
          isInitialized: true,
        })
      );

      expect(mockReplaceState).not.toHaveBeenCalled();
    });
  });

  describe("BigInt conversion", () => {
    it("converts BigInt values from API response to numbers", () => {
      renderHook(() =>
        useBundleFormSync({
          selectedOptions: {},
          isInitialized: true,
          form: mockForm as any,
          configuredBundle: {
            data: {
              id: "bundle-id",
              meta: {
                bundle_configuration: {
                  selected_options: {
                    component1: { option1: BigInt(3), option2: BigInt(1) },
                  },
                },
              },
            },
          },
        })
      );

      const configCall = mockFormSetValue.mock.calls.find(
        (call: any[]) => call[0] === "BundleConfiguration"
      );
      expect(configCall).toBeTruthy();
      // Values should be plain numbers, not BigInt
      const config = configCall[1];
      expect(typeof config.selected_options.component1.option1).toBe("number");
      expect(config.selected_options.component1.option1).toBe(3);
      expect(config.selected_options.component1.option2).toBe(1);
    });
  });
});
