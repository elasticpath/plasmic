/**
 * @jest-environment jsdom
 */
import React, { StrictMode } from "react";
import { render, renderHook, act } from "@testing-library/react";

// Mock variationMatching
jest.mock("../../utils/variationMatching", () => ({
  findMatchingVariant: jest.fn(),
}));

const { findMatchingVariant } = require("../../utils/variationMatching");
const { useVariationSelection } = require("../useVariationSelection");

describe("useVariationSelection", () => {
  const mockOnSelectionChange = jest.fn();

  const baseParentInfo = {
    id: "parent-1",
    isParent: true,
    loading: false,
    children: [
      { id: "child-red-512", name: "Red 512GB", sku: "RED-512" },
      { id: "child-blue-512", name: "Blue 512GB", sku: "BLUE-512" },
      { id: "child-red-1tb", name: "Red 1TB", sku: "RED-1TB" },
    ],
    variations: [
      {
        id: "var-color",
        name: "Color",
        options: [
          { id: "opt-red", name: "Red" },
          { id: "opt-blue", name: "Blue" },
        ],
      },
      {
        id: "var-capacity",
        name: "Capacity",
        options: [
          { id: "opt-512", name: "512GB" },
          { id: "opt-1tb", name: "1TB" },
        ],
      },
    ],
    variationMatrix: {
      "opt-red": { "opt-512": "child-red-512", "opt-1tb": "child-red-1tb" },
      "opt-blue": { "opt-512": "child-blue-512" },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findMatchingVariant.mockReturnValue(null);
  });

  it("initializes with empty variation selections", () => {
    const { result } = renderHook(() =>
      useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange: mockOnSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
      })
    );

    expect(result.current.variationSelections).toEqual({});
    expect(result.current.matchingVariant).toBeNull();
  });

  it("returns all expected properties", () => {
    const { result } = renderHook(() =>
      useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange: mockOnSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
      })
    );

    expect(result.current).toHaveProperty("variationSelections");
    expect(result.current).toHaveProperty("setVariationSelections");
    expect(result.current).toHaveProperty("handleVariationChange");
    expect(result.current).toHaveProperty("matchingVariant");
  });

  it("updates variation selections when handleVariationChange is called", () => {
    findMatchingVariant.mockReturnValue(null);

    const { result } = renderHook(() =>
      useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange: mockOnSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
      })
    );

    act(() => {
      result.current.handleVariationChange("var-color", "opt-red");
    });

    // State should update with the new selection
    expect(result.current.variationSelections).toEqual({
      "var-color": "opt-red",
    });
  });

  it("calls onSelectionChange when a matching variant is found", () => {
    const matchedChild = {
      id: "child-red-512",
      name: "Red 512GB",
      sku: "RED-512",
    };
    findMatchingVariant.mockReturnValue(matchedChild);

    const { result } = renderHook(() =>
      useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange: mockOnSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
      })
    );

    act(() => {
      result.current.handleVariationChange("var-color", "opt-red");
    });

    expect(mockOnSelectionChange).toHaveBeenCalledWith(
      "storage",
      "parent-1",
      1,
      "child-red-512"
    );
  });

  it("does not update the bundle provider during the picker's render", () => {
    // onSelectionChange used to run inside the setVariationSelections updater,
    // and React runs updaters during render — so the setValue it performs was a
    // render-phase update on another component: "Cannot update a component
    // (EPBundleProviderInner) while rendering a different component
    // (EPBundleVariationPicker)".
    findMatchingVariant.mockReturnValue({
      id: "child-red-512",
      name: "Red 512GB",
      sku: "RED-512",
    });

    function Picker({
      onSelectionChange,
    }: {
      onSelectionChange: (...args: any[]) => void;
    }) {
      const { handleVariationChange } = useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
      });
      // A pending update on this fiber is what makes React defer the
      // setVariationSelections updater to the render phase instead of running
      // it eagerly during dispatch — which is the situation in the real app.
      const [, bump] = React.useState(0);
      return (
        <button
          onClick={() => {
            bump((n) => n + 1);
            handleVariationChange("var-color", "opt-red");
          }}
        >
          pick
        </button>
      );
    }

    // Stands in for EPBundleProviderInner: the selection writes its state.
    function Provider() {
      const [writes, setWrites] = React.useState(0);
      const onSelectionChange = React.useCallback(() => {
        setWrites((n) => n + 1);
      }, []);
      return (
        <>
          <span data-testid="writes">{writes}</span>
          <Picker onSelectionChange={onSelectionChange} />
        </>
      );
    }

    const errors: string[] = [];
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation((...args) => errors.push(String(args[0])));

    try {
      const { getByText, getByTestId } = render(<Provider />);
      act(() => {
        getByText("pick").click();
      });

      expect(
        errors.filter((e) => /Cannot update a component/.test(e))
      ).toEqual([]);
      expect(getByTestId("writes").textContent).toBe("1");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not call onSelectionChange when no matching variant is found", () => {
    findMatchingVariant.mockReturnValue(null);

    const { result } = renderHook(() =>
      useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange: mockOnSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
      })
    );

    act(() => {
      result.current.handleVariationChange("var-color", "opt-red");
    });

    expect(mockOnSelectionChange).not.toHaveBeenCalled();
  });

  it("clears previous variant when selecting a new one", () => {
    const newChild = {
      id: "child-blue-512",
      name: "Blue 512GB",
      sku: "BLUE-512",
    };
    findMatchingVariant.mockReturnValue(newChild);

    const { result } = renderHook(() =>
      useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange: mockOnSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
        selectedVariationId: "child-red-512",
      })
    );

    act(() => {
      result.current.handleVariationChange("var-color", "opt-blue");
    });

    // Should clear old variant first
    expect(mockOnSelectionChange).toHaveBeenCalledWith(
      "storage",
      "parent-1",
      0,
      "child-red-512"
    );
    // Then select new variant
    expect(mockOnSelectionChange).toHaveBeenCalledWith(
      "storage",
      "parent-1",
      1,
      "child-blue-512"
    );
  });

  it("does not clear previous variant if it matches the new one", () => {
    const sameChild = {
      id: "child-red-512",
      name: "Red 512GB",
      sku: "RED-512",
    };
    findMatchingVariant.mockReturnValue(sameChild);

    const { result } = renderHook(() =>
      useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange: mockOnSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
        selectedVariationId: "child-red-512",
      })
    );

    act(() => {
      result.current.handleVariationChange("var-capacity", "opt-512");
    });

    // Should NOT clear (no zero call)
    const zeroCalls = mockOnSelectionChange.mock.calls.filter(
      (call: any[]) => call[2] === 0
    );
    expect(zeroCalls).toHaveLength(0);

    // Should select (same) variant
    expect(mockOnSelectionChange).toHaveBeenCalledWith(
      "storage",
      "parent-1",
      1,
      "child-red-512"
    );
  });

  it("allows direct setVariationSelections for external control", () => {
    const { result } = renderHook(() =>
      useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange: mockOnSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
      })
    );

    act(() => {
      result.current.setVariationSelections({
        "var-color": "opt-red",
        "var-capacity": "opt-512",
      });
    });

    expect(result.current.variationSelections).toEqual({
      "var-color": "opt-red",
      "var-capacity": "opt-512",
    });
  });

  it("computes matchingVariant from current selections", () => {
    const matchedChild = {
      id: "child-red-512",
      name: "Red 512GB",
      sku: "RED-512",
    };
    findMatchingVariant.mockReturnValue(matchedChild);

    const { result } = renderHook(() =>
      useVariationSelection({
        parentInfo: baseParentInfo,
        onSelectionChange: mockOnSelectionChange,
        componentKey: "storage",
        optionId: "parent-1",
      })
    );

    expect(result.current.matchingVariant).toEqual(matchedChild);
    expect(findMatchingVariant).toHaveBeenCalledWith({}, baseParentInfo);
  });
});
