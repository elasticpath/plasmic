/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useBundleConfigurationOrchestration } from "../useBundleConfigurationOrchestration";
import { ElasticPathBundleProduct } from "../../types";

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
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
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
    renderHook(() =>
      useBundleConfigurationOrchestration({
        ...defaultProps,
        selectedOptions: { component1: { option1: 1 } },
      })
    );

    // Advance timers to trigger debounced function
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Wait for async operations
    await act(async () => {
      await Promise.resolve();
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

    renderHook(() =>
      useBundleConfigurationOrchestration({
        ...defaultProps,
        bundleProduct,
        selectedOptions: { component1: { option1: 2 } }, // different from default
      })
    );

    // Advance timers to trigger debounced function
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Wait for async operations
    await act(async () => {
      await Promise.resolve();
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

    // Trigger first call
    act(() => {
      jest.advanceTimersByTime(100);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockConfigureBundleSelection).toHaveBeenCalledTimes(1);

    // Re-render with same selections should not trigger another call
    rerender({
      ...defaultProps,
      selectedOptions: { component1: { option1: 1 } }, // same selections
    });

    act(() => {
      jest.advanceTimersByTime(100);
    });

    await act(async () => {
      await Promise.resolve();
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

    // Trigger first call
    act(() => {
      jest.advanceTimersByTime(100);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockConfigureBundleSelection).toHaveBeenCalledTimes(1);
    expect(mockConfigureBundleSelection).toHaveBeenCalledWith({
      component1: { option1: 1 }
    });

    // Re-render with different selections should trigger another call
    rerender({
      ...defaultProps,
      selectedOptions: { component1: { option1: 2 } }, // different selections
    });

    act(() => {
      jest.advanceTimersByTime(100);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockConfigureBundleSelection).toHaveBeenCalledTimes(2);
    expect(mockConfigureBundleSelection).toHaveBeenLastCalledWith({
      component1: { option1: 2 }
    });
  });

  it("handles API errors gracefully", async () => {
    const mockConfigureWithError = jest.fn().mockRejectedValue(new Error("API Error"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    renderHook(() =>
      useBundleConfigurationOrchestration({
        ...defaultProps,
        configureBundleSelection: mockConfigureWithError,
        selectedOptions: { component1: { option1: 1 } },
      })
    );

    // Advance timers to trigger debounced function
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Wait for async operations and error handling
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockConfigureWithError).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to process bundle configuration:",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("tracks configuration state correctly", async () => {
    let promiseResolver: any;
    const slowConfigureFunction = jest.fn().mockImplementation(async () => {
      return new Promise(resolve => {
        promiseResolver = resolve;
        setTimeout(() => resolve(undefined), 50);
      });
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

    // Advance timers to trigger debounced function
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Check that it's now configuring
    expect(result.current.isConfiguring).toBe(true);

    // Advance the internal setTimeout and resolve the promise
    await act(async () => {
      jest.advanceTimersByTime(50);
      await Promise.resolve(); // Let the promise chain resolve
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

    // Advance timers to trigger debounced function
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Wait for async operations
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.lastConfigured).toBe(JSON.stringify({ component1: { option1: 1 } }));
  });
});