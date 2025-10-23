/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useBundleConfigurationOrchestration } from "../useBundleConfigurationOrchestration";
import { ElasticPathBundleProduct } from "../../types";

// Mock debounce to run immediately
jest.mock("debounce", () => (fn: Function) => {
  const debouncedFn = (...args: any[]) => fn(...args);
  debouncedFn.clear = jest.fn();
  return debouncedFn;
});

describe("useBundleConfigurationOrchestration", () => {
  const mockConfigureBundleSelection = jest.fn().mockResolvedValue(undefined);
  
  const defaultProps = {
    selectedOptions: {},
    isInitialized: true,
    isValid: true,
    bundleProduct: undefined,
    configureBundleSelection: mockConfigureBundleSelection,
    debounceMs: 100,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not trigger configuration when not initialized", () => {
    renderHook(() =>
      useBundleConfigurationOrchestration({
        ...defaultProps,
        isInitialized: false,
        selectedOptions: { component1: { option1: 1 } },
      })
    );

    expect(mockConfigureBundleSelection).not.toHaveBeenCalled();
  });

  it("does not trigger configuration when not valid", () => {
    renderHook(() =>
      useBundleConfigurationOrchestration({
        ...defaultProps,
        isValid: false,
        selectedOptions: { component1: { option1: 1 } },
      })
    );

    expect(mockConfigureBundleSelection).not.toHaveBeenCalled();
  });

  it("does not trigger configuration when no selections", () => {
    renderHook(() =>
      useBundleConfigurationOrchestration({
        ...defaultProps,
        selectedOptions: {},
      })
    );

    expect(mockConfigureBundleSelection).not.toHaveBeenCalled();
  });

  it("triggers configuration when conditions are met", async () => {
    await act(async () => {
      renderHook(() =>
        useBundleConfigurationOrchestration({
          ...defaultProps,
          selectedOptions: { component1: { option1: 1 } },
        })
      );
    });

    expect(mockConfigureBundleSelection).toHaveBeenCalledWith({
      component1: { option1: 1 }
    });
  });

  it("does not trigger configuration when selections match default", () => {
    const bundleProduct = {
      meta: {
        bundle_configuration: {
          selected_options: {
            component1: { option1: BigInt(1) }
          }
        }
      }
    } as ElasticPathBundleProduct;

    renderHook(() =>
      useBundleConfigurationOrchestration({
        ...defaultProps,
        bundleProduct,
        selectedOptions: { component1: { option1: 1 } }, // matches default
      })
    );

    expect(mockConfigureBundleSelection).not.toHaveBeenCalled();
  });

  it("triggers configuration when selections differ from default", async () => {
    const bundleProduct = {
      meta: {
        bundle_configuration: {
          selected_options: {
            component1: { option1: BigInt(1) }
          }
        }
      }
    } as ElasticPathBundleProduct;

    await act(async () => {
      renderHook(() =>
        useBundleConfigurationOrchestration({
          ...defaultProps,
          bundleProduct,
          selectedOptions: { component1: { option1: 2 } }, // different from default
        })
      );
    });

    expect(mockConfigureBundleSelection).toHaveBeenCalledWith({
      component1: { option1: 2 }
    });
  });

  it("prevents duplicate API calls for same selections", async () => {
    const { rerender } = renderHook(
      (props) => useBundleConfigurationOrchestration(props),
      {
        initialProps: {
          ...defaultProps,
          selectedOptions: { component1: { option1: 1 } },
        }
      }
    );

    await act(async () => {
      // First render should trigger call
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockConfigureBundleSelection).toHaveBeenCalledTimes(1);

    // Re-render with same selections should not trigger another call
    rerender({
      ...defaultProps,
      selectedOptions: { component1: { option1: 1 } }, // same selections
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockConfigureBundleSelection).toHaveBeenCalledTimes(1);
  });

  it("triggers new API call when selections change", async () => {
    const { rerender } = renderHook(
      (props) => useBundleConfigurationOrchestration(props),
      {
        initialProps: {
          ...defaultProps,
          selectedOptions: { component1: { option1: 1 } },
        }
      }
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockConfigureBundleSelection).toHaveBeenCalledTimes(1);
    expect(mockConfigureBundleSelection).toHaveBeenCalledWith({
      component1: { option1: 1 }
    });

    // Re-render with different selections should trigger another call
    await act(async () => {
      rerender({
        ...defaultProps,
        selectedOptions: { component1: { option1: 2 } }, // different selections
      });
    });

    expect(mockConfigureBundleSelection).toHaveBeenCalledTimes(2);
    expect(mockConfigureBundleSelection).toHaveBeenLastCalledWith({
      component1: { option1: 2 }
    });
  });

  it("handles API errors gracefully", async () => {
    const mockConfigureWithError = jest.fn().mockRejectedValue(new Error("API Error"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    await act(async () => {
      renderHook(() =>
        useBundleConfigurationOrchestration({
          ...defaultProps,
          configureBundleSelection: mockConfigureWithError,
          selectedOptions: { component1: { option1: 1 } },
        })
      );
    });

    expect(mockConfigureWithError).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to process bundle configuration:",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("tracks configuration state correctly", async () => {
    let isConfiguring = false;
    
    const slowConfigureFunction = jest.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const { result } = renderHook(() =>
      useBundleConfigurationOrchestration({
        ...defaultProps,
        configureBundleSelection: slowConfigureFunction,
        selectedOptions: { component1: { option1: 1 } },
      })
    );

    // Should not be configuring initially
    expect(result.current.isConfiguring).toBe(false);

    await act(async () => {
      // Start async operation
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    // Configuration should complete
    expect(result.current.isConfiguring).toBe(false);
    expect(slowConfigureFunction).toHaveBeenCalled();
  });

  it("updates lastConfigured when configuration succeeds", async () => {
    const { result } = renderHook(() =>
      useBundleConfigurationOrchestration({
        ...defaultProps,
        selectedOptions: { component1: { option1: 1 } },
      })
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.lastConfigured).toBe(JSON.stringify({ component1: { option1: 1 } }));
  });
});