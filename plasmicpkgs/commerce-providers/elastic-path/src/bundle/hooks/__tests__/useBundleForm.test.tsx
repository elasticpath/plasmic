/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";

// Mock react-hook-form
const mockSetValue = jest.fn();
const mockWatch = jest.fn().mockReturnValue({});
const mockReset = jest.fn();
const mockHandleSubmit = jest.fn(
  (successHandler: any) => (e?: any) => {
    e?.preventDefault?.();
    return Promise.resolve(successHandler(mockWatch()));
  }
);

jest.mock("react-hook-form", () => ({
  useForm: jest.fn(() => ({
    handleSubmit: mockHandleSubmit,
    watch: mockWatch,
    setValue: mockSetValue,
    formState: { errors: {}, isValid: true },
    reset: mockReset,
    register: jest.fn(),
    getValues: jest.fn((name?: string) =>
      name === undefined ? mockWatch() : mockWatch()[name]
    ),
  })),
}));

// Mock zod resolver
jest.mock("@hookform/resolvers/zod", () => ({
  zodResolver: jest.fn(() => jest.fn()),
}));

// Validity and messages come from the schema, so the stub has to answer
// safeParse. Tests that care set `mockSafeParseResult`.
let mockSafeParseResult: any = { success: true };

// Mock the schema module
jest.mock("../../schemas/bundleSchema", () => ({
  createBundleSchema: jest.fn(() => ({
    // Minimal Zod-like schema shape
    parse: jest.fn(),
    safeParse: jest.fn(() => mockSafeParseResult),
  })),
  createBundleDefaultValues: jest.fn(
    (components: Record<string, any>) => {
      const defaults: Record<string, Record<string, number>> = {};
      Object.keys(components).forEach((key) => {
        defaults[key] = {};
      });
      return defaults;
    }
  ),
}));

// Mock the selection utils
jest.mock("../../utils/bundleSelectionUtils", () => ({
  convertSelectionsForAPI: jest.fn((selections) => {
    const result: Record<string, Record<string, number>> = {};
    Object.entries(selections).forEach(([compKey, options]: [string, any]) => {
      if (compKey === "BundleConfiguration" || compKey === "ConfiguredBundleId")
        return;
      result[compKey] = {};
      Object.entries(options).forEach(([key, qty]: [string, any]) => {
        if (key.includes(":")) {
          const childId = key.split(":")[1];
          result[compKey][childId] = qty;
        } else {
          result[compKey][key] = qty;
        }
      });
    });
    return result;
  }),
}));

// Import after mocks are set up
const { useBundleForm, useApiFormattedSelections } = require("../useBundleForm");
const { createBundleDefaultValues } = require("../../schemas/bundleSchema");
const { useForm } = require("react-hook-form");

describe("useBundleForm", () => {
  const singleSelectComponent = {
    name: "Processor",
    min: 1,
    max: 1,
    sort_order: 1,
    options: [
      { id: "opt-1", type: "product" as const, quantity: 1, default: true },
      { id: "opt-2", type: "product" as const, quantity: 1, default: false },
    ],
  };

  const multiSelectComponent = {
    name: "Memory",
    min: 1,
    max: 3,
    sort_order: 2,
    options: [
      {
        id: "mem-1",
        type: "product" as const,
        quantity: 1,
        min: 1,
        max: 4,
        default: true,
      },
      {
        id: "mem-2",
        type: "product" as const,
        quantity: 1,
        min: 1,
        max: 2,
        default: false,
      },
    ],
  };

  const defaultComponents = {
    processor: singleSelectComponent,
    memory: multiSelectComponent,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSafeParseResult = { success: true };
    mockWatch.mockReturnValue({
      processor: {},
      memory: {},
    });
  });

  it("initializes with components and creates form", () => {
    renderHook(() =>
      useBundleForm({
        components: defaultComponents,
      })
    );

    expect(useForm).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "onChange",
      })
    );
  });

  it("returns all expected properties", () => {
    const { result } = renderHook(() =>
      useBundleForm({
        components: defaultComponents,
      })
    );

    expect(result.current).toHaveProperty("form");
    expect(result.current).toHaveProperty("selectedOptions");
    expect(result.current).toHaveProperty("isValid");
    expect(result.current).toHaveProperty("errors");
    expect(result.current).toHaveProperty("handleComponentSelection");
    expect(result.current).toHaveProperty("handleSubmit");
    expect(result.current).toHaveProperty("reset");
  });

  it("reports isValid from the schema", () => {
    const { result } = renderHook(() =>
      useBundleForm({
        components: defaultComponents,
      })
    );

    expect(result.current.isValid).toBe(true);
  });

  describe("handleComponentSelection", () => {
    it("writes the whole component map in one call", () => {
      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      act(() => {
        result.current.handleComponentSelection("processor", "opt-1", 1);
      });

      expect(mockSetValue).toHaveBeenCalledTimes(1);
      expect(mockSetValue).toHaveBeenCalledWith(
        "processor",
        { "opt-1": 1 },
        { shouldValidate: true, shouldDirty: true }
      );
    });

    it("builds parentId:childId key when variationId is provided", () => {
      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      act(() => {
        result.current.handleComponentSelection(
          "processor",
          "parent-1",
          1,
          "child-1"
        );
      });

      expect(mockSetValue).toHaveBeenCalledWith(
        "processor",
        { "parent-1:child-1": 1 },
        expect.objectContaining({ shouldValidate: true })
      );
    });

    it("replaces the previous choice for single-select components (max=1)", () => {
      mockWatch.mockReturnValue({
        processor: { "opt-1": 1 },
        memory: {},
      });

      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      act(() => {
        result.current.handleComponentSelection("processor", "opt-2", 1);
      });

      // The replaced option is gone, not held at zero: Elastic Path rejects a
      // zero-quantity entry outright ("Must be greater than or equal to 1").
      expect(mockSetValue).toHaveBeenCalledWith(
        "processor",
        { "opt-2": 1 },
        { shouldValidate: true, shouldDirty: true }
      );
    });

    it("drops the bare parent when one of its variations is chosen", () => {
      mockWatch.mockReturnValue({
        processor: { "parent-1": 1 },
        memory: {},
      });

      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      act(() => {
        result.current.handleComponentSelection(
          "processor",
          "parent-1",
          1,
          "child-9"
        );
      });

      expect(mockSetValue).toHaveBeenCalledWith(
        "processor",
        { "parent-1:child-9": 1 },
        { shouldValidate: true, shouldDirty: true }
      );
    });

    it("keeps other selections for multi-select components", () => {
      mockWatch.mockReturnValue({
        processor: {},
        memory: { "mem-1": 1 },
      });

      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      act(() => {
        result.current.handleComponentSelection("memory", "mem-2", 1);
      });

      expect(mockSetValue).toHaveBeenCalledWith(
        "memory",
        { "mem-1": 1, "mem-2": 1 },
        { shouldValidate: true, shouldDirty: true }
      );
    });

    it("removes a deselected option from the component map", () => {
      mockWatch.mockReturnValue({
        processor: { "opt-1": 1 },
        memory: { "mem-1": 1, "mem-2": 2 },
      });

      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      act(() => {
        result.current.handleComponentSelection("memory", "mem-1", 0);
      });

      expect(mockSetValue).toHaveBeenCalledTimes(1);
      expect(mockSetValue).toHaveBeenCalledWith(
        "memory",
        { "mem-2": 2 },
        { shouldValidate: true, shouldDirty: true }
      );
    });

    it("never emits a zero quantity, whatever the starting state", () => {
      mockWatch.mockReturnValue({
        processor: {},
        memory: { "mem-1": 0, "mem-2": 1 },
      });

      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      act(() => {
        result.current.handleComponentSelection("memory", "mem-2", 2);
      });

      const written = mockSetValue.mock.calls[0][1] as Record<string, number>;
      expect(Object.values(written).every((qty) => qty > 0)).toBe(true);
      expect(written).toEqual({ "mem-2": 2 });
    });

    it("does nothing for unknown component key", () => {
      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      act(() => {
        result.current.handleComponentSelection("unknown", "opt-1", 1);
      });

      expect(mockSetValue).not.toHaveBeenCalled();
    });
  });

  describe("handleSubmit", () => {
    it("wraps react-hook-form handleSubmit", () => {
      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      const submitFn = result.current.handleSubmit();
      expect(typeof submitFn).toBe("function");
    });

    it("calls provided callback on submit", async () => {
      const callback = jest.fn();
      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      await act(async () => {
        await result.current.handleSubmit(callback)();
      });

      expect(callback).toHaveBeenCalled();
    });

    it("falls back to onSubmit prop when no callback is provided", async () => {
      const onSubmit = jest.fn();
      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents, onSubmit })
      );

      await act(async () => {
        await result.current.handleSubmit()();
      });

      expect(onSubmit).toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("calls rhfReset with freshly computed default values", () => {
      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      act(() => {
        result.current.reset();
      });

      expect(createBundleDefaultValues).toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalled();
    });
  });

  describe("errors", () => {
    it("keys schema issues by their component", () => {
      mockSafeParseResult = {
        success: false,
        error: {
          issues: [
            {
              path: ["processor"],
              message: "Please select one option for Processor",
            },
          ],
        },
      };

      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      expect(result.current.isValid).toBe(false);
      expect(result.current.errors.processor).toBe(
        "Please select one option for Processor"
      );
    });

    it("keeps the first message per component", () => {
      mockSafeParseResult = {
        success: false,
        error: {
          issues: [
            { path: ["memory"], message: "first" },
            { path: ["memory"], message: "second" },
          ],
        },
      };

      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      expect(result.current.errors.memory).toBe("first");
    });

    it("returns empty errors object when no form errors", () => {
      const { result } = renderHook(() =>
        useBundleForm({ components: defaultComponents })
      );

      expect(result.current.errors).toEqual({});
    });
  });
});

describe("URL param restoration", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWatch.mockReturnValue({ processor: {}, memory: {} });
  });

  afterEach(() => {
    // Restore original location
    delete (window as any).location;
    window.location = originalLocation;
  });

  function setUrlParam(param: string, value: string) {
    delete (window as any).location;
    (window as any).location = {
      ...originalLocation,
      href: `https://example.com/product/test?${param}=${value}`,
      search: `?${param}=${value}`,
    };
  }

  it("reads bundle_config URL param as highest priority default", () => {
    const urlSelections = { processor: { "opt-2": 1 } };
    const encoded = btoa(JSON.stringify(urlSelections));
    setUrlParam("bundle_config", encoded);

    renderHook(() =>
      useBundleForm({
        components: {
          processor: {
            name: "Processor",
            min: 1,
            max: 1,
            sort_order: 1,
            options: [
              { id: "opt-1", type: "product" as const, quantity: 1, default: true },
            ],
          },
        },
      })
    );

    // createBundleDefaultValues should be called with the URL-encoded config
    expect(createBundleDefaultValues).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      encoded
    );
  });

  it("URL param overrides defaultConfiguration prop", () => {
    const urlSelections = { processor: { "opt-url": 1 } };
    const urlEncoded = btoa(JSON.stringify(urlSelections));
    setUrlParam("bundle_config", urlEncoded);

    const propSelections = { processor: { "opt-prop": 1 } };
    const propEncoded = btoa(JSON.stringify(propSelections));

    renderHook(() =>
      useBundleForm({
        components: {
          processor: {
            name: "Processor",
            min: 1,
            max: 1,
            sort_order: 1,
            options: [{ id: "opt-1", type: "product" as const, quantity: 1, default: true }],
          },
        },
        defaultConfiguration: propEncoded,
      })
    );

    // Should use URL config, not prop config
    expect(createBundleDefaultValues).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      urlEncoded
    );
  });

  it("falls back to defaultConfiguration prop when no URL param", () => {
    // Ensure no bundle_config in URL
    delete (window as any).location;
    (window as any).location = {
      ...originalLocation,
      href: "https://example.com/product/test",
      search: "",
    };

    const propEncoded = btoa(JSON.stringify({ processor: { "opt-prop": 1 } }));

    renderHook(() =>
      useBundleForm({
        components: {
          processor: {
            name: "Processor",
            min: 1,
            max: 1,
            sort_order: 1,
            options: [{ id: "opt-1", type: "product" as const, quantity: 1, default: true }],
          },
        },
        defaultConfiguration: propEncoded,
      })
    );

    expect(createBundleDefaultValues).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      propEncoded
    );
  });

  it("reset also reads URL param for highest priority", () => {
    const urlSelections = { processor: { "opt-2": 1 } };
    const encoded = btoa(JSON.stringify(urlSelections));
    setUrlParam("bundle_config", encoded);

    const { result } = renderHook(() =>
      useBundleForm({
        components: {
          processor: {
            name: "Processor",
            min: 1,
            max: 1,
            sort_order: 1,
            options: [{ id: "opt-1", type: "product" as const, quantity: 1, default: true }],
          },
        },
      })
    );

    // Clear calls from initialization
    (createBundleDefaultValues as jest.Mock).mockClear();

    act(() => {
      result.current.reset();
    });

    // Reset should also use URL param
    expect(createBundleDefaultValues).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      encoded
    );
  });
});

describe("useApiFormattedSelections", () => {
  it("converts parentId:childId keys to child-only keys", () => {
    const { result } = renderHook(() =>
      useApiFormattedSelections({
        component1: { "parent-1:child-1": 1 },
      })
    );

    expect(result.current).toEqual({
      component1: { "child-1": 1 },
    });
  });

  it("passes through simple keys unchanged", () => {
    const { result } = renderHook(() =>
      useApiFormattedSelections({
        component1: { "option-1": 1 },
      })
    );

    expect(result.current).toEqual({
      component1: { "option-1": 1 },
    });
  });

  it("excludes BundleConfiguration and ConfiguredBundleId fields", () => {
    const { result } = renderHook(() =>
      useApiFormattedSelections({
        component1: { "option-1": 1 },
        BundleConfiguration: { some: 1 } as any,
        ConfiguredBundleId: { some: 1 } as any,
      })
    );

    expect(result.current).toEqual({
      component1: { "option-1": 1 },
    });
  });
});
