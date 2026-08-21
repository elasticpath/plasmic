/**
 * @jest-environment jsdom
 *
 * Tests for composable bundle components.
 *
 * These components rely on @plasmicapp/host for DataProvider/useSelector data
 * flow and usePlasmicCanvasContext for design-time detection. We mock the host
 * module and test component rendering, data display, interactivity, and
 * accessibility attributes.
 *
 * esbuild jest transform hoists `import` to `require()` at file top BEFORE
 * jest.mock() calls take effect. All code-under-test modules are loaded via
 * explicit `require()` (not `import`) so they see the mocked @plasmicapp/host.
 */

// --- Mocks (hoisted by Jest before any other code) ---

jest.mock("@plasmicapp/host", () => {
  const React = require("react");
  return {
    DataProvider: ({ children, name, data }: any) =>
      React.createElement("div", { "data-provider": name, "data-provider-value": JSON.stringify(data) }, children),
    useSelector: jest.fn(),
    usePlasmicCanvasContext: jest.fn().mockReturnValue(null),
    repeatedElement: jest.fn((_i: number, children: any) => children),
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// --- Imports (not mocked — safe for esbuild to hoist) ---
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// --- Load mocked host functions via require (after jest.mock takes effect) ---
const {
  useSelector: mockUseSelector,
  usePlasmicCanvasContext: mockUsePlasmicCanvasContext,
  DataProvider: MockDataProvider,
  repeatedElement: mockRepeatedElement,
} = require("@plasmicapp/host");

// --- Load components-under-test via require (after jest.mock takes effect) ---
const { EPBundleComponentField } = require("../EPBundleComponentField");
const { EPBundleOptionField } = require("../EPBundleOptionField");
const { EPBundlePriceField } = require("../EPBundlePriceField");
const { EPBundleValidationErrors } = require("../EPBundleValidationErrors");
const { EPBundleVariationField } = require("../EPBundleVariationField");
const { EPBundleOptionTrigger } = require("../EPBundleOptionTrigger");
const { EPBundleOptionQuantityButton } = require("../EPBundleOptionQuantityButton");
const { EPBundleSelectionIndicator } = require("../EPBundleSelectionIndicator");
const { EPBundleOptionQuantityControl } = require("../EPBundleOptionQuantityControl");
const { EPBundleComponentList } = require("../EPBundleComponentList");
const { EPBundleOptionList } = require("../EPBundleOptionList");
const { EPBundleVariationOptionList } = require("../EPBundleVariationOptionList");
const { EPBundleVariationOptionTrigger } = require("../EPBundleVariationOptionTrigger");
const { BundleFormContext } = require("../BundleContext");
const { BundleOptionContext } = require("../BundleContext");
const { BundleVariationContext } = require("../BundleContext");
const { MOCK_BUNDLE_COMPONENTS, MOCK_BUNDLE_DATA, MOCK_BUNDLE_DATA_WITH_ERRORS } = require("../design-time-data");
const { epBundleOptionTriggerMeta } = require("../EPBundleOptionTrigger");
const { epBundleSelectionIndicatorMeta } = require("../EPBundleSelectionIndicator");
const { epBundleVariationOptionTriggerMeta } = require("../EPBundleVariationOptionTrigger");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Configure useSelector to return specific data per key */
function setupSelector(selectorData: Record<string, any>) {
  (mockUseSelector as jest.Mock).mockImplementation((key: string) => selectorData[key]);
}

/** Set up editor mode (usePlasmicCanvasContext returns truthy) */
function setEditorMode(inEditor: boolean) {
  (mockUsePlasmicCanvasContext as jest.Mock).mockReturnValue(inEditor ? {} : null);
}

/** Default form context value for tests */
const TEST_FORM_CONTEXT = {
  handleComponentSelection: jest.fn(),
  selectedOptions: { processor: { "opt-proc-1": 1 }, memory: { "opt-mem-1": 2 } },
  components: {
    processor: {
      name: "Processor",
      min: 1,
      max: 1,
      sort_order: 1,
      options: [
        { id: "opt-proc-1", sort_order: 1, min: null, max: null, default: true },
        { id: "opt-proc-2", sort_order: 2, min: null, max: null, default: false },
      ],
    },
    memory: {
      name: "Memory",
      min: 1,
      max: 3,
      sort_order: 2,
      options: [
        { id: "opt-mem-1", sort_order: 1, min: 1, max: 4, default: true },
      ],
    },
  },
  parentProducts: {},
  optionProducts: {
    "opt-proc-1": { name: "Core i5", price: "$299.00", image: "", sku: "PROC-I5", description: "6-core" },
    "opt-proc-2": { name: "Core i7", price: "$499.00", image: "", sku: "PROC-I7", description: "8-core" },
    "opt-mem-1": { name: "8GB DDR5", price: "$79.00", image: "", sku: "MEM-8GB", description: "DDR5-4800" },
  },
  productsLoading: false,
  isFixedPrice: false,
};

// ===========================================================================
// EPBundleComponentField
// ===========================================================================

describe("EPBundleComponentField", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
  });

  it("renders component name from selector data", () => {
    setupSelector({
      currentBundleComponent: { name: "Processor", min: 1, max: 1, options: [] },
    });
    const { container } = render(<EPBundleComponentField field="name" />);
    expect(container.textContent).toBe("Processor");
  });

  it("renders a bounded range in selectionInfo", () => {
    setupSelector({
      currentBundleComponent: { name: "Gift", min: 0, max: 3, selectedCount: 1, options: [] },
    });
    const { container } = render(<EPBundleComponentField field="selectionInfo" />);
    expect(container.textContent).toBe("1 of 0\u20133");
  });

  it("renders an exact requirement in selectionInfo", () => {
    setupSelector({
      currentBundleComponent: { name: "Games", min: 2, max: 2, selectedCount: 1, options: [] },
    });
    const { container } = render(<EPBundleComponentField field="selectionInfo" />);
    expect(container.textContent).toBe("1 of 2");
  });

  it("does not print MAX_SAFE_INTEGER for a component with no maximum", () => {
    // A component with no max arrives as Number.MAX_SAFE_INTEGER, and used to
    // render as "1 of 0\u20139007199254740991".
    setupSelector({
      currentBundleComponent: {
        name: "Test",
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        selectedCount: 1,
        options: [],
      },
    });
    const { container } = render(<EPBundleComponentField field="selectionInfo" />);
    expect(container.textContent).toBe("1 selected");
  });

  it("shows the minimum when unbounded above it", () => {
    setupSelector({
      currentBundleComponent: {
        name: "Test",
        min: 2,
        max: Number.MAX_SAFE_INTEGER,
        selectedCount: 3,
        options: [],
      },
    });
    const { container } = render(<EPBundleComponentField field="selectionInfo" />);
    expect(container.textContent).toBe("3 of 2+");
  });

  it("renders an empty max rather than MAX_SAFE_INTEGER", () => {
    setupSelector({
      currentBundleComponent: {
        name: "Test",
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        options: [],
      },
    });
    const { container } = render(<EPBundleComponentField field="max" />);
    expect(container.textContent).toBe("");
  });

  it("renders min field", () => {
    setupSelector({
      currentBundleComponent: { name: "Memory", min: 1, max: 4, options: [] },
    });
    const { container } = render(<EPBundleComponentField field="min" />);
    expect(container.textContent).toBe("1");
  });

  it("renders max field", () => {
    setupSelector({
      currentBundleComponent: { name: "Memory", min: 1, max: 4, options: [] },
    });
    const { container } = render(<EPBundleComponentField field="max" />);
    expect(container.textContent).toBe("4");
  });

  it("renders selectedCount", () => {
    setupSelector({
      currentBundleComponent: { name: "Memory", selectedCount: 2, options: [] },
    });
    const { container } = render(<EPBundleComponentField field="selectedCount" />);
    expect(container.textContent).toBe("2");
  });

  it("renders isValid as string", () => {
    setupSelector({
      currentBundleComponent: { name: "Memory", isValid: true, options: [] },
    });
    const { container } = render(<EPBundleComponentField field="isValid" />);
    expect(container.textContent).toBe("true");
  });

  it("renders optionCount from options.length", () => {
    setupSelector({
      currentBundleComponent: { name: "Memory", options: [{}, {}, {}] },
    });
    const { container } = render(<EPBundleComponentField field="optionCount" />);
    expect(container.textContent).toBe("3");
  });

  it("falls back to mock data in editor when no selector data", () => {
    setEditorMode(true);
    setupSelector({});
    const { container } = render(<EPBundleComponentField field="name" />);
    // Should display mock component name
    expect(container.textContent).toBe(MOCK_BUNDLE_COMPONENTS[0].name);
  });

  it("returns null when no data and not in editor", () => {
    setupSelector({});
    const { container } = render(<EPBundleComponentField field="name" />);
    expect(container.innerHTML).toBe("");
  });
});

// ===========================================================================
// EPBundleOptionField
// ===========================================================================

describe("EPBundleOptionField", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
  });

  it("renders option name from selector data", () => {
    setupSelector({ currentBundleOption: { name: "Core i5", price: "$299" } });
    const { container } = render(<EPBundleOptionField field="name" />);
    expect(container.textContent).toBe("Core i5");
  });

  it("renders price", () => {
    setupSelector({ currentBundleOption: { name: "Core i5", price: "$299.00" } });
    const { container } = render(<EPBundleOptionField field="price" />);
    expect(container.textContent).toBe("$299.00");
  });

  it("renders boolean isSelected as string", () => {
    setupSelector({ currentBundleOption: { isSelected: true } });
    const { container } = render(<EPBundleOptionField field="isSelected" />);
    expect(container.textContent).toBe("true");
  });

  it("renders quantity", () => {
    setupSelector({ currentBundleOption: { quantity: 3 } });
    const { container } = render(<EPBundleOptionField field="quantity" />);
    expect(container.textContent).toBe("3");
  });

  it("falls back to mock data in editor", () => {
    setEditorMode(true);
    setupSelector({});
    const { container } = render(<EPBundleOptionField field="name" />);
    expect(container.textContent).toBe(MOCK_BUNDLE_COMPONENTS[0].options[0].name);
  });
});

// ===========================================================================
// EPBundlePriceField
// ===========================================================================

describe("EPBundlePriceField", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
  });

  it("renders price from bundleData", () => {
    setupSelector({
      bundleData: { currentPrice: "$1,249.00", isConfiguring: false, pricingType: "cumulative" },
    });
    const { container } = render(<EPBundlePriceField />);
    expect(container.textContent).toContain("$1,249.00");
  });

  it("shows loading text when configuring", () => {
    setupSelector({
      bundleData: { currentPrice: "$1,249.00", isConfiguring: true, pricingType: "cumulative" },
    });
    const { container } = render(<EPBundlePriceField />);
    expect(container.textContent).toContain("Calculating");
  });

  it("sets data-configuring attribute when configuring", () => {
    setupSelector({
      bundleData: { currentPrice: "$1,249.00", isConfiguring: true, pricingType: "cumulative" },
    });
    const { container } = render(<EPBundlePriceField />);
    const span = container.querySelector("span");
    expect(span?.getAttribute("data-configuring")).toBeTruthy();
  });

  it("falls back to mock data in editor", () => {
    setEditorMode(true);
    setupSelector({});
    const { container } = render(<EPBundlePriceField />);
    expect(container.textContent).toContain(MOCK_BUNDLE_DATA.currentPrice);
  });

  it("returns null when no data and not in editor", () => {
    setupSelector({});
    const { container } = render(<EPBundlePriceField />);
    expect(container.innerHTML).toBe("");
  });
});

// ===========================================================================
// EPBundleValidationErrors
// ===========================================================================

describe("EPBundleValidationErrors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
  });

  it("renders validation errors", () => {
    setupSelector({
      bundleData: { errors: ["Select a processor", "Select storage"], isValid: false },
    });
    const { container } = render(
      <EPBundleValidationErrors>
        <span>error slot</span>
      </EPBundleValidationErrors>
    );
    // Component wraps each error in a DataProvider with currentBundleError data
    const providers = container.querySelectorAll("[data-provider='currentBundleError']");
    expect(providers).toHaveLength(2);
    expect(providers[0].getAttribute("data-provider-value")).toContain("Select a processor");
    expect(providers[1].getAttribute("data-provider-value")).toContain("Select storage");
  });

  it("has role=alert and aria-live=polite", () => {
    setupSelector({
      bundleData: { errors: ["Error 1"], isValid: false },
    });
    const { container } = render(<EPBundleValidationErrors />);
    const alertDiv = container.querySelector("[role='alert']");
    expect(alertDiv).toBeTruthy();
    expect(alertDiv?.getAttribute("aria-live")).toBe("polite");
  });

  it("returns null when no errors", () => {
    setupSelector({
      bundleData: { errors: [], isValid: true },
    });
    const { container } = render(<EPBundleValidationErrors />);
    expect(container.innerHTML).toBe("");
  });

  it("falls back to mock error data in editor", () => {
    setEditorMode(true);
    setupSelector({});
    const { container } = render(
      <EPBundleValidationErrors previewState="withData">
        <span>error slot</span>
      </EPBundleValidationErrors>
    );
    const providers = container.querySelectorAll("[data-provider='currentBundleError']");
    expect(providers.length).toBeGreaterThan(0);
    expect(providers[0].getAttribute("data-provider-value")).toContain(
      MOCK_BUNDLE_DATA_WITH_ERRORS.errors[0]
    );
  });
});

// ===========================================================================
// EPBundleVariationField
// ===========================================================================

describe("EPBundleVariationField", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
  });

  it("renders variation name from selector", () => {
    setupSelector({
      currentBundleVariation: { id: "var-1", name: "Color", values: [{ id: "opt-red", label: "Red" }, { id: "opt-blue", label: "Blue" }] },
    });
    const { container } = render(<EPBundleVariationField field="name" />);
    expect(container.textContent).toBe("Color");
  });

  it("renders optionCount from values.length", () => {
    setupSelector({
      currentBundleVariation: { id: "var-1", name: "Color", values: [{ id: "opt-red", label: "Red" }, { id: "opt-blue", label: "Blue" }] },
    });
    const { container } = render(<EPBundleVariationField field="optionCount" />);
    expect(container.textContent).toBe("2");
  });

  it("displays option label from currentBundleVariationOption", () => {
    setupSelector({
      currentBundleVariation: { id: "var-1", name: "Color", values: [{ id: "opt-red", label: "Red" }] },
      currentBundleVariationOption: { id: "opt-red", label: "Red", isSelected: true },
    });
    const { container } = render(<EPBundleVariationField field="optionLabel" />);
    expect(container.textContent).toBe("Red");
  });

  it("displays mock option label in editor when no data", () => {
    setEditorMode(true);
    setupSelector({});
    const { container } = render(<EPBundleVariationField field="optionLabel" />);
    // MOCK_BUNDLE_VARIATION_OPTIONS[0].label is "Space Gray"
    expect(container.textContent).toBe("Space Gray");
  });

  it("returns null when no data and not in editor", () => {
    setupSelector({});
    const { container } = render(<EPBundleVariationField field="name" />);
    expect(container.innerHTML).toBe("");
  });
});

// ===========================================================================
// EPBundleOptionTrigger
// ===========================================================================

describe("EPBundleOptionTrigger", () => {
  const mockHandleComponentSelection = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
  });

  function renderTrigger(
    optionData: any = {},
    componentData: any = {},
    formCtxOverrides: Partial<typeof TEST_FORM_CONTEXT> = {}
  ) {
    setupSelector({
      currentBundleOption: { id: "opt-1", name: "Core i5", isSelected: false, quantity: 0, minQty: null, maxQty: null, ...optionData },
      currentBundleComponent: { key: "processor", min: 1, max: 1, ...componentData },
    });

    const formCtx = {
      ...TEST_FORM_CONTEXT,
      handleComponentSelection: mockHandleComponentSelection,
      ...formCtxOverrides,
    };

    return render(
      <BundleFormContext.Provider value={formCtx}>
        <EPBundleOptionTrigger>
          <span>Option Content</span>
        </EPBundleOptionTrigger>
      </BundleFormContext.Provider>
    );
  }

  it("renders with role=radio for single-select components (min=1, max=1)", () => {
    renderTrigger({}, { min: 1, max: 1 });
    const trigger = screen.getByRole("radio");
    expect(trigger).toBeTruthy();
  });

  it("renders with role=checkbox for multi-select components", () => {
    renderTrigger({}, { min: 1, max: 3 });
    const trigger = screen.getByRole("checkbox");
    expect(trigger).toBeTruthy();
  });

  it("sets aria-checked based on selection state", () => {
    renderTrigger({ isSelected: true });
    const trigger = screen.getByRole("radio");
    expect(trigger.getAttribute("aria-checked")).toBe("true");
  });

  it("sets data-selected attribute when selected", () => {
    renderTrigger({ isSelected: true });
    const trigger = screen.getByRole("radio");
    expect(trigger.hasAttribute("data-selected")).toBe(true);
  });

  it("does not set data-selected when not selected", () => {
    renderTrigger({ isSelected: false });
    const trigger = screen.getByRole("radio");
    expect(trigger.hasAttribute("data-selected")).toBe(false);
  });

  it("has accessible label with option name", () => {
    renderTrigger({ name: "Core i7" });
    const trigger = screen.getByRole("radio");
    expect(trigger.getAttribute("aria-label")).toBe("Select Core i7");
  });

  it("has fallback accessible label when no name", () => {
    renderTrigger({ name: undefined });
    const trigger = screen.getByRole("radio");
    expect(trigger.getAttribute("aria-label")).toBe("Select option");
  });

  it("calls handleComponentSelection with quantity 1 on click when not selected", () => {
    renderTrigger({ isSelected: false });
    fireEvent.click(screen.getByRole("radio"));
    expect(mockHandleComponentSelection).toHaveBeenCalledWith("processor", "opt-1", 1);
  });

  it("calls handleComponentSelection with quantity 0 on click when selected (deselect)", () => {
    renderTrigger({ isSelected: true });
    fireEvent.click(screen.getByRole("radio"));
    expect(mockHandleComponentSelection).toHaveBeenCalledWith("processor", "opt-1", 0);
  });

  it("handles keyboard activation with Enter", () => {
    renderTrigger({ isSelected: false });
    fireEvent.keyDown(screen.getByRole("radio"), { key: "Enter" });
    expect(mockHandleComponentSelection).toHaveBeenCalledWith("processor", "opt-1", 1);
  });

  it("handles keyboard activation with Space", () => {
    renderTrigger({ isSelected: false });
    fireEvent.keyDown(screen.getByRole("radio"), { key: " " });
    expect(mockHandleComponentSelection).toHaveBeenCalledWith("processor", "opt-1", 1);
  });

  it("provides BundleOptionContext to children", () => {
    const ContextReader = () => {
      const ctx = require("../BundleContext").useBundleOption();
      return <span data-testid="ctx">{JSON.stringify({ isSelected: ctx?.isSelected, optionId: ctx?.optionId })}</span>;
    };

    setupSelector({
      currentBundleOption: { id: "opt-1", name: "Test", isSelected: true, quantity: 2 },
      currentBundleComponent: { key: "processor", min: 1, max: 1 },
    });

    render(
      <BundleFormContext.Provider value={{ ...TEST_FORM_CONTEXT, handleComponentSelection: jest.fn() }}>
        <EPBundleOptionTrigger>
          <ContextReader />
        </EPBundleOptionTrigger>
      </BundleFormContext.Provider>
    );

    const ctx = JSON.parse(screen.getByTestId("ctx").textContent!);
    expect(ctx.isSelected).toBe(true);
    expect(ctx.optionId).toBe("opt-1");
  });
});

// ===========================================================================
// EPBundleOptionQuantityButton — verifies the min/max bounds fix
// ===========================================================================

describe("EPBundleOptionQuantityButton", () => {
  const mockSetQuantity = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
  });

  function renderButton(
    action: "increment" | "decrement",
    optionContextOverrides: Partial<{ quantity: number; isSelected: boolean }> = {},
    selectorOverrides: any = {}
  ) {
    const optionCtx = {
      componentKey: "memory",
      optionId: "opt-mem-1",
      isSelected: true,
      quantity: 2,
      toggleOption: jest.fn(),
      setQuantity: mockSetQuantity,
      ...optionContextOverrides,
    };

    setupSelector({
      currentBundleOption: { minQty: 1, maxQty: 4, ...selectorOverrides },
    });

    return render(
      <BundleOptionContext.Provider value={optionCtx}>
        <EPBundleOptionQuantityButton action={action}>
          {action === "increment" ? "+" : "-"}
        </EPBundleOptionQuantityButton>
      </BundleOptionContext.Provider>
    );
  }

  it("shows the glyph for its own direction when the slot is empty", () => {
    // The slot default was "+" for both directions, so a decrement button
    // dropped in as-is read "+".
    setupSelector({ currentBundleOption: { minQty: 1, maxQty: 4 } });
    const optionCtx = {
      componentKey: "memory",
      optionId: "opt-mem-1",
      isSelected: true,
      quantity: 2,
      toggleOption: jest.fn(),
      setQuantity: mockSetQuantity,
    };

    const dec = render(
      <BundleOptionContext.Provider value={optionCtx}>
        <EPBundleOptionQuantityButton action="decrement" />
      </BundleOptionContext.Provider>
    );
    expect(dec.container.textContent).toBe("\u2212");

    const inc = render(
      <BundleOptionContext.Provider value={optionCtx}>
        <EPBundleOptionQuantityButton action="increment" />
      </BundleOptionContext.Provider>
    );
    expect(inc.container.textContent).toBe("+");
  });

  it("keeps slot content when there is any", () => {
    const { container } = renderButton("decrement", { quantity: 2 });
    expect(container.textContent).toBe("-");
  });

  it("increments quantity on click", () => {
    renderButton("increment", { quantity: 2 });
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetQuantity).toHaveBeenCalledWith(3);
  });

  it("decrements quantity on click", () => {
    renderButton("decrement", { quantity: 3 });
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetQuantity).toHaveBeenCalledWith(2);
  });

  it("does NOT increment past maxQty", () => {
    renderButton("increment", { quantity: 4 }, { maxQty: 4 });
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetQuantity).not.toHaveBeenCalled();
  });

  it("does NOT decrement below minQty", () => {
    renderButton("decrement", { quantity: 1 }, { minQty: 1 });
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetQuantity).not.toHaveBeenCalled();
  });

  it("clamps increment to max when quantity is at boundary", () => {
    renderButton("increment", { quantity: 3 }, { maxQty: 4 });
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetQuantity).toHaveBeenCalledWith(4); // Math.min(4, 3+1) = 4
  });

  it("clamps decrement to min when quantity is at boundary", () => {
    renderButton("decrement", { quantity: 2 }, { minQty: 1 });
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetQuantity).toHaveBeenCalledWith(1); // Math.max(1, 2-1) = 1
  });

  it("sets aria-disabled when at max bound (increment)", () => {
    renderButton("increment", { quantity: 4 }, { maxQty: 4 });
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("sets aria-disabled when at min bound (decrement)", () => {
    renderButton("decrement", { quantity: 1 }, { minQty: 1 });
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("is not disabled when within bounds (increment)", () => {
    renderButton("increment", { quantity: 2 }, { maxQty: 4 });
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-disabled")).toBe("false");
  });

  it("is not disabled when within bounds (decrement)", () => {
    renderButton("decrement", { quantity: 3 }, { minQty: 1 });
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-disabled")).toBe("false");
  });

  it("has proper aria-label for increment", () => {
    renderButton("increment");
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toBe("Increase option quantity");
  });

  it("has proper aria-label for decrement", () => {
    renderButton("decrement");
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toBe("Decrease option quantity");
  });

  it("handles keyboard Enter activation", () => {
    renderButton("increment", { quantity: 2 });
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(mockSetQuantity).toHaveBeenCalledWith(3);
  });

  it("defaults to max 99 when maxQty is null", () => {
    setupSelector({ currentBundleOption: { maxQty: null, minQty: null } });
    const optionCtx = {
      componentKey: "memory",
      optionId: "opt-mem-1",
      isSelected: true,
      quantity: 50,
      toggleOption: jest.fn(),
      setQuantity: mockSetQuantity,
    };

    render(
      <BundleOptionContext.Provider value={optionCtx}>
        <EPBundleOptionQuantityButton action="increment">+</EPBundleOptionQuantityButton>
      </BundleOptionContext.Provider>
    );

    fireEvent.click(screen.getByRole("button"));
    expect(mockSetQuantity).toHaveBeenCalledWith(51);
  });

  it("defaults to min 0 when minQty is null", () => {
    setupSelector({ currentBundleOption: { maxQty: null, minQty: null } });
    const optionCtx = {
      componentKey: "memory",
      optionId: "opt-mem-1",
      isSelected: true,
      quantity: 1,
      toggleOption: jest.fn(),
      setQuantity: mockSetQuantity,
    };

    render(
      <BundleOptionContext.Provider value={optionCtx}>
        <EPBundleOptionQuantityButton action="decrement">-</EPBundleOptionQuantityButton>
      </BundleOptionContext.Provider>
    );

    fireEvent.click(screen.getByRole("button"));
    expect(mockSetQuantity).toHaveBeenCalledWith(0);
  });
});

// ===========================================================================
// EPBundleOptionQuantityControl
// ===========================================================================

describe("EPBundleOptionQuantityControl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
  });

  it("provides bundleOptionQuantity DataProvider with correct shape", () => {
    setupSelector({
      currentBundleOption: { quantity: 2, minQty: 1, maxQty: 4 },
    });

    const optionCtx = {
      componentKey: "memory",
      optionId: "opt-mem-1",
      isSelected: true,
      quantity: 2,
      toggleOption: jest.fn(),
      setQuantity: jest.fn(),
    };

    const { container } = render(
      <BundleOptionContext.Provider value={optionCtx}>
        <EPBundleOptionQuantityControl>
          <span>Children</span>
        </EPBundleOptionQuantityControl>
      </BundleOptionContext.Provider>
    );

    const provider = container.querySelector("[data-provider='bundleOptionQuantity']");
    expect(provider).toBeTruthy();
    const data = JSON.parse(provider!.getAttribute("data-provider-value")!);
    expect(data.quantity).toBe(2);
    expect(data.min).toBe(1);
    expect(data.max).toBe(4);
    expect(data.canDecrement).toBe(true);
    expect(data.canIncrement).toBe(true);
  });

  it("sets canIncrement=false when at max", () => {
    setupSelector({
      currentBundleOption: { quantity: 4, minQty: 1, maxQty: 4 },
    });

    const optionCtx = {
      componentKey: "memory",
      optionId: "opt-mem-1",
      isSelected: true,
      quantity: 4,
      toggleOption: jest.fn(),
      setQuantity: jest.fn(),
    };

    const { container } = render(
      <BundleOptionContext.Provider value={optionCtx}>
        <EPBundleOptionQuantityControl>
          <span>Children</span>
        </EPBundleOptionQuantityControl>
      </BundleOptionContext.Provider>
    );

    const provider = container.querySelector("[data-provider='bundleOptionQuantity']");
    const data = JSON.parse(provider!.getAttribute("data-provider-value")!);
    expect(data.canIncrement).toBe(false);
    expect(data.canDecrement).toBe(true);
  });

  it("sets canDecrement=false when at min", () => {
    setupSelector({
      currentBundleOption: { quantity: 1, minQty: 1, maxQty: 4 },
    });

    const optionCtx = {
      componentKey: "memory",
      optionId: "opt-mem-1",
      isSelected: true,
      quantity: 1,
      toggleOption: jest.fn(),
      setQuantity: jest.fn(),
    };

    const { container } = render(
      <BundleOptionContext.Provider value={optionCtx}>
        <EPBundleOptionQuantityControl>
          <span>Children</span>
        </EPBundleOptionQuantityControl>
      </BundleOptionContext.Provider>
    );

    const provider = container.querySelector("[data-provider='bundleOptionQuantity']");
    const data = JSON.parse(provider!.getAttribute("data-provider-value")!);
    expect(data.canDecrement).toBe(false);
    expect(data.canIncrement).toBe(true);
  });
});

// ===========================================================================
// EPBundleComponentList
// ===========================================================================

describe("EPBundleComponentList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
    (mockRepeatedElement as jest.Mock).mockImplementation((_i: number, children: any) => children);
  });

  it("renders component items from form context", () => {
    setupSelector({ bundleData: { componentCount: 2 } });

    const { container } = render(
      <BundleFormContext.Provider value={TEST_FORM_CONTEXT}>
        <EPBundleComponentList>
          <span>Component item</span>
        </EPBundleComponentList>
      </BundleFormContext.Provider>
    );

    // Should render items for each component (processor + memory)
    const items = container.querySelectorAll("[role='listitem']");
    expect(items.length).toBe(2);
  });

  it("never shows a product id where a name belongs", () => {
    // optionProducts had no entry for this option, and `name` fell back to the
    // option id — putting a raw UUID in front of the shopper.
    setupSelector({ bundleData: { componentCount: 1 } });

    const { container } = render(
      <BundleFormContext.Provider
        value={{
          ...TEST_FORM_CONTEXT,
          selectedOptions: { unresolved: { "9dc2b489-60f8-426f-a29c-787d710937a6": 1 } },
          components: {
            unresolved: {
              name: "Mystery",
              min: 1,
              max: 1,
              sort_order: 1,
              options: [
                { id: "9dc2b489-60f8-426f-a29c-787d710937a6", sort_order: 1, min: null, max: null },
              ],
            },
          },
          optionProducts: {},
        }}
      >
        <EPBundleComponentList>
          <span>Item</span>
        </EPBundleComponentList>
      </BundleFormContext.Provider>
    );

    const provider = container.querySelector("[data-provider='currentBundleComponent']");
    const data = JSON.parse(provider!.getAttribute("data-provider-value")!);
    expect(data.options[0].name).toBe("");
    expect(data.options[0].isUnavailable).toBe(true);
  });

  it("does not call an option unavailable while the products are still loading", () => {
    // optionProducts is empty on first paint, so !name flagged every option in
    // the bundle as unavailable until the fetch landed.
    setupSelector({ bundleData: { componentCount: 1 } });

    const { container } = render(
      <BundleFormContext.Provider
        value={{
          ...TEST_FORM_CONTEXT,
          optionProducts: {},
          productsLoading: true,
        }}
      >
        <EPBundleComponentList>
          <span>Item</span>
        </EPBundleComponentList>
      </BundleFormContext.Provider>
    );

    const provider = container.querySelector("[data-provider='currentBundleComponent']");
    const data = JSON.parse(provider!.getAttribute("data-provider-value")!);
    expect(data.options[0].isUnavailable).toBe(false);
  });

  it("marks a resolved option as available", () => {
    setupSelector({ bundleData: { componentCount: 2 } });

    const { container } = render(
      <BundleFormContext.Provider value={TEST_FORM_CONTEXT}>
        <EPBundleComponentList>
          <span>Item</span>
        </EPBundleComponentList>
      </BundleFormContext.Provider>
    );

    const provider = container.querySelector("[data-provider='currentBundleComponent']");
    const data = JSON.parse(provider!.getAttribute("data-provider-value")!);
    expect(data.options[0].name).toBe("Core i5");
    expect(data.options[0].isUnavailable).toBe(false);
  });

  it("has role=list with aria-label", () => {
    setupSelector({ bundleData: { componentCount: 2 } });

    const { container } = render(
      <BundleFormContext.Provider value={TEST_FORM_CONTEXT}>
        <EPBundleComponentList>
          <span>Item</span>
        </EPBundleComponentList>
      </BundleFormContext.Provider>
    );

    const list = container.querySelector("[role='list']");
    expect(list).toBeTruthy();
    expect(list?.getAttribute("aria-label")).toBe("Bundle components");
  });

  it("provides currentBundleComponent DataProvider", () => {
    setupSelector({ bundleData: { componentCount: 2 } });

    const { container } = render(
      <BundleFormContext.Provider value={TEST_FORM_CONTEXT}>
        <EPBundleComponentList>
          <span>Item</span>
        </EPBundleComponentList>
      </BundleFormContext.Provider>
    );

    const providers = container.querySelectorAll("[data-provider='currentBundleComponent']");
    expect(providers.length).toBe(2);

    // First component should be processor (sort_order: 1)
    const firstData = JSON.parse(providers[0].getAttribute("data-provider-value")!);
    expect(firstData.name).toBe("Processor");
    expect(firstData.key).toBe("processor");
  });

  it("returns null when no form context and not in editor", () => {
    setupSelector({});
    const { container } = render(
      <EPBundleComponentList>
        <span>Item</span>
      </EPBundleComponentList>
    );
    expect(container.innerHTML).toBe("");
  });

  it("falls back to mock data in editor", () => {
    setEditorMode(true);
    setupSelector({});

    const { container } = render(
      <EPBundleComponentList>
        <span>Item</span>
      </EPBundleComponentList>
    );

    const items = container.querySelectorAll("[role='listitem']");
    expect(items.length).toBe(MOCK_BUNDLE_COMPONENTS.length);
  });

  it("uses child variant metadata when parentId:childId key is selected", () => {
    setupSelector({ bundleData: { componentCount: 1 } });

    const formCtxWithChild = {
      ...TEST_FORM_CONTEXT,
      // Selection uses parentId:childId key format
      selectedOptions: {
        storage: { "parent-ssd:child-512gb-red": 1 },
      },
      components: {
        storage: {
          name: "Storage",
          min: 1,
          max: 1,
          sort_order: 1,
          options: [
            { id: "parent-ssd", sort_order: 1, min: null, max: null, default: true },
          ],
        },
      },
      parentProducts: {
        "parent-ssd": { isParent: true },
      },
      optionProducts: {
        // Parent product metadata
        "parent-ssd": { name: "SSD (Parent)", price: "$99.00", image: "", sku: "SSD-PARENT", description: "Parent" },
        // Child variant metadata — should be used when child is selected
        "child-512gb-red": { name: "512GB SSD Red", price: "$119.00", image: "/red.jpg", sku: "SSD-512-RED", description: "Red variant" },
      },
    };

    const { container } = render(
      <BundleFormContext.Provider value={formCtxWithChild}>
        <EPBundleComponentList>
          <span>Item</span>
        </EPBundleComponentList>
      </BundleFormContext.Provider>
    );

    const providers = container.querySelectorAll("[data-provider='currentBundleComponent']");
    expect(providers.length).toBe(1);
    const componentData = JSON.parse(providers[0].getAttribute("data-provider-value")!);

    // The option should show child variant metadata, not parent
    expect(componentData.options[0].name).toBe("512GB SSD Red");
    expect(componentData.options[0].price).toBe("$119.00");
    expect(componentData.options[0].sku).toBe("SSD-512-RED");
    expect(componentData.options[0].imageUrl).toBe("/red.jpg");
    expect(componentData.options[0].isParentProduct).toBe(true);
    expect(componentData.options[0].isSelected).toBe(true);
    expect(componentData.options[0].quantity).toBe(1);
  });

  it("falls back to parent metadata when no child variant is selected", () => {
    setupSelector({ bundleData: { componentCount: 1 } });

    const formCtxNoChild = {
      ...TEST_FORM_CONTEXT,
      // No selection for this component yet
      selectedOptions: { storage: {} },
      components: {
        storage: {
          name: "Storage",
          min: 1,
          max: 1,
          sort_order: 1,
          options: [
            { id: "parent-ssd", sort_order: 1, min: null, max: null, default: false },
          ],
        },
      },
      parentProducts: {
        "parent-ssd": { isParent: true },
      },
      optionProducts: {
        "parent-ssd": { name: "SSD (Parent)", price: "$99.00", image: "", sku: "SSD-PARENT", description: "Parent" },
        "child-512gb-red": { name: "512GB SSD Red", price: "$119.00", image: "/red.jpg", sku: "SSD-512-RED", description: "Red variant" },
      },
    };

    const { container } = render(
      <BundleFormContext.Provider value={formCtxNoChild}>
        <EPBundleComponentList>
          <span>Item</span>
        </EPBundleComponentList>
      </BundleFormContext.Provider>
    );

    const providers = container.querySelectorAll("[data-provider='currentBundleComponent']");
    const componentData = JSON.parse(providers[0].getAttribute("data-provider-value")!);

    // Should show parent metadata when no child is selected
    expect(componentData.options[0].name).toBe("SSD (Parent)");
    expect(componentData.options[0].price).toBe("$99.00");
    expect(componentData.options[0].isSelected).toBe(false);
  });

  it("handles plain (non-parent) product selections alongside parent:child keys", () => {
    setupSelector({ bundleData: { componentCount: 1 } });

    const formCtxMixed = {
      ...TEST_FORM_CONTEXT,
      selectedOptions: {
        components: {
          "plain-product": 1,
          "parent-prod:child-variant": 1,
        },
      },
      components: {
        components: {
          name: "Components",
          min: 1,
          max: 3,
          sort_order: 1,
          options: [
            { id: "plain-product", sort_order: 1, min: null, max: null, default: false },
            { id: "parent-prod", sort_order: 2, min: null, max: null, default: false },
          ],
        },
      },
      parentProducts: {
        "parent-prod": { isParent: true },
      },
      optionProducts: {
        "plain-product": { name: "Plain Widget", price: "$50.00", image: "", sku: "PLAIN", description: "Simple" },
        "parent-prod": { name: "Parent Widget", price: "$75.00", image: "", sku: "PARENT", description: "Parent" },
        "child-variant": { name: "Child Widget Blue", price: "$85.00", image: "/blue.jpg", sku: "CHILD-BLUE", description: "Blue variant" },
      },
    };

    const { container } = render(
      <BundleFormContext.Provider value={formCtxMixed}>
        <EPBundleComponentList>
          <span>Item</span>
        </EPBundleComponentList>
      </BundleFormContext.Provider>
    );

    const providers = container.querySelectorAll("[data-provider='currentBundleComponent']");
    const componentData = JSON.parse(providers[0].getAttribute("data-provider-value")!);

    // Plain product should show its own metadata
    const plainOpt = componentData.options.find((o: any) => o.id === "plain-product");
    expect(plainOpt.name).toBe("Plain Widget");
    expect(plainOpt.price).toBe("$50.00");

    // Parent product with child selected should show child metadata
    const parentOpt = componentData.options.find((o: any) => o.id === "parent-prod");
    expect(parentOpt.name).toBe("Child Widget Blue");
    expect(parentOpt.price).toBe("$85.00");
  });
});

// ===========================================================================
// EPBundleOptionList
// ===========================================================================

describe("EPBundleOptionList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
    (mockRepeatedElement as jest.Mock).mockImplementation((_i: number, children: any) => children);
  });

  it("renders option items from currentBundleComponent", () => {
    const options = [
      { id: "opt-1", name: "Option A", isSelected: true, quantity: 1 },
      { id: "opt-2", name: "Option B", isSelected: false, quantity: 0 },
    ];
    setupSelector({ currentBundleComponent: { key: "comp-1", options } });

    const { container } = render(
      <EPBundleOptionList>
        <span>Option item</span>
      </EPBundleOptionList>
    );

    const items = container.querySelectorAll("[role='listitem']");
    expect(items.length).toBe(2);
  });

  it("has role=list with aria-label", () => {
    setupSelector({
      currentBundleComponent: { key: "comp-1", options: [{ id: "opt-1" }] },
    });

    const { container } = render(
      <EPBundleOptionList>
        <span>Item</span>
      </EPBundleOptionList>
    );

    const list = container.querySelector("[role='list']");
    expect(list).toBeTruthy();
    expect(list?.getAttribute("aria-label")).toBe("Bundle options");
  });

  it("provides currentBundleOption DataProvider", () => {
    const options = [{ id: "opt-1", name: "Test Option" }];
    setupSelector({ currentBundleComponent: { key: "comp-1", options } });

    const { container } = render(
      <EPBundleOptionList>
        <span>Item</span>
      </EPBundleOptionList>
    );

    const providers = container.querySelectorAll("[data-provider='currentBundleOption']");
    expect(providers.length).toBe(1);
    const data = JSON.parse(providers[0].getAttribute("data-provider-value")!);
    expect(data.id).toBe("opt-1");
    expect(data.name).toBe("Test Option");
  });

  it("returns null with empty options", () => {
    setupSelector({ currentBundleComponent: { key: "comp-1", options: [] } });
    const { container } = render(
      <EPBundleOptionList>
        <span>Item</span>
      </EPBundleOptionList>
    );
    expect(container.innerHTML).toBe("");
  });
});

// ===========================================================================
// EPBundleVariationOptionList
// ===========================================================================

describe("EPBundleVariationOptionList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
    (mockRepeatedElement as jest.Mock).mockImplementation((_i: number, children: any) => children);
  });

  it("renders variation option items", () => {
    const variation = {
      id: "var-color",
      name: "Color",
      values: [{ id: "opt-red", label: "Red" }, { id: "opt-blue", label: "Blue" }, { id: "opt-green", label: "Green" }],
    };
    const variationCtx = { selectedValues: { "var-color": "opt-red" }, selectVariation: jest.fn() };

    setupSelector({ currentBundleVariation: variation });

    const { container } = render(
      <BundleVariationContext.Provider value={variationCtx}>
        <EPBundleVariationOptionList>
          <span>Variation item</span>
        </EPBundleVariationOptionList>
      </BundleVariationContext.Provider>
    );

    const items = container.querySelectorAll("[role='listitem']");
    expect(items.length).toBe(3);
  });

  it("enriches options with isSelected from context using option IDs", () => {
    const variation = {
      id: "var-color",
      name: "Color",
      values: [{ id: "opt-red", label: "Red" }, { id: "opt-blue", label: "Blue" }],
    };
    const variationCtx = { selectedValues: { "var-color": "opt-red" }, selectVariation: jest.fn() };

    setupSelector({ currentBundleVariation: variation });

    const { container } = render(
      <BundleVariationContext.Provider value={variationCtx}>
        <EPBundleVariationOptionList>
          <span>Item</span>
        </EPBundleVariationOptionList>
      </BundleVariationContext.Provider>
    );

    const providers = container.querySelectorAll("[data-provider='currentBundleVariationOption']");
    const redData = JSON.parse(providers[0].getAttribute("data-provider-value")!);
    const blueData = JSON.parse(providers[1].getAttribute("data-provider-value")!);

    expect(redData.id).toBe("opt-red");
    expect(redData.label).toBe("Red");
    expect(redData.isSelected).toBe(true);
    expect(blueData.id).toBe("opt-blue");
    expect(blueData.label).toBe("Blue");
    expect(blueData.isSelected).toBe(false);
  });
});

// ===========================================================================
// EPBundleVariationOptionTrigger
// ===========================================================================

describe("EPBundleVariationOptionTrigger", () => {
  const mockSelectVariation = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
  });

  function renderVariationTrigger(
    variationData: any = {},
    optionData: any = {},
    isSelected: boolean = false
  ) {
    setupSelector({
      currentBundleVariation: { id: "var-color", name: "Color", values: [], ...variationData },
      currentBundleVariationOption: { id: "opt-red", label: "Red", isSelected, ...optionData },
    });

    const variationCtx = {
      selectedValues: {},
      selectVariation: mockSelectVariation,
    };

    return render(
      <BundleVariationContext.Provider value={variationCtx}>
        <EPBundleVariationOptionTrigger>
          <span>Red</span>
        </EPBundleVariationOptionTrigger>
      </BundleVariationContext.Provider>
    );
  }

  it("renders with role=radio", () => {
    renderVariationTrigger();
    expect(screen.getByRole("radio")).toBeTruthy();
  });

  it("sets aria-checked based on isSelected", () => {
    renderVariationTrigger({}, {}, true);
    expect(screen.getByRole("radio").getAttribute("aria-checked")).toBe("true");
  });

  it("sets data-selected when selected", () => {
    renderVariationTrigger({}, {}, true);
    expect(screen.getByRole("radio").hasAttribute("data-selected")).toBe(true);
  });

  it("calls selectVariation with option ID on click", () => {
    renderVariationTrigger();
    fireEvent.click(screen.getByRole("radio"));
    expect(mockSelectVariation).toHaveBeenCalledWith("var-color", "opt-red");
  });

  it("has accessible label from option label", () => {
    renderVariationTrigger({}, { id: "opt-sg", label: "Space Gray" });
    expect(screen.getByRole("radio").getAttribute("aria-label")).toBe("Space Gray");
  });

  it("handles keyboard Enter activation", () => {
    renderVariationTrigger();
    fireEvent.keyDown(screen.getByRole("radio"), { key: "Enter" });
    expect(mockSelectVariation).toHaveBeenCalledWith("var-color", "opt-red");
  });
});

// ===========================================================================
// EPBundleSelectionIndicator
// ===========================================================================

describe("EPBundleSelectionIndicator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(false);
    setupSelector({});
  });

  const defaultCtx = {
    componentKey: "processor",
    optionId: "opt-1",
    isSelected: false,
    quantity: 0,
    toggleOption: jest.fn(),
    setQuantity: jest.fn(),
  };

  it("renders a div with data-ep-bundle-selection-indicator", () => {
    render(
      <BundleOptionContext.Provider value={defaultCtx}>
        <EPBundleSelectionIndicator />
      </BundleOptionContext.Provider>
    );
    const el = document.querySelector("[data-ep-bundle-selection-indicator]");
    expect(el).toBeTruthy();
  });

  it("sets data-selected when option is selected", () => {
    render(
      <BundleOptionContext.Provider value={{ ...defaultCtx, isSelected: true, quantity: 1 }}>
        <EPBundleSelectionIndicator />
      </BundleOptionContext.Provider>
    );
    const el = document.querySelector("[data-ep-bundle-selection-indicator]");
    expect(el!.hasAttribute("data-selected")).toBe(true);
  });

  it("does not set data-selected when not selected", () => {
    render(
      <BundleOptionContext.Provider value={defaultCtx}>
        <EPBundleSelectionIndicator />
      </BundleOptionContext.Provider>
    );
    const el = document.querySelector("[data-ep-bundle-selection-indicator]");
    expect(el!.hasAttribute("data-selected")).toBe(false);
  });

  it("has aria-hidden=true", () => {
    render(
      <BundleOptionContext.Provider value={defaultCtx}>
        <EPBundleSelectionIndicator />
      </BundleOptionContext.Provider>
    );
    const el = document.querySelector("[data-ep-bundle-selection-indicator]");
    expect(el!.getAttribute("aria-hidden")).toBe("true");
  });

  it("applies className prop", () => {
    render(
      <BundleOptionContext.Provider value={defaultCtx}>
        <EPBundleSelectionIndicator className="my-indicator" />
      </BundleOptionContext.Provider>
    );
    const el = document.querySelector("[data-ep-bundle-selection-indicator]");
    expect(el!.className).toContain("my-indicator");
  });

  it("previewState=selected forces data-selected", () => {
    render(
      <BundleOptionContext.Provider value={defaultCtx}>
        <EPBundleSelectionIndicator previewState="selected" />
      </BundleOptionContext.Provider>
    );
    const el = document.querySelector("[data-ep-bundle-selection-indicator]");
    expect(el!.hasAttribute("data-selected")).toBe(true);
  });

  it("previewState=unselected forces no data-selected", () => {
    render(
      <BundleOptionContext.Provider value={{ ...defaultCtx, isSelected: true, quantity: 1 }}>
        <EPBundleSelectionIndicator previewState="unselected" />
      </BundleOptionContext.Provider>
    );
    const el = document.querySelector("[data-ep-bundle-selection-indicator]");
    expect(el!.hasAttribute("data-selected")).toBe(false);
  });

  it("falls back to mock data in editor when no context", () => {
    setEditorMode(true);
    // Render without BundleOptionContext provider — simulates being in editor
    // outside a real trigger. MOCK_BUNDLE_COMPONENTS[0].options[0].isSelected is true.
    render(<EPBundleSelectionIndicator />);
    const el = document.querySelector("[data-ep-bundle-selection-indicator]");
    expect(el!.hasAttribute("data-selected")).toBe(true);
  });

  it("renders without data-selected when no context and not in editor", () => {
    setEditorMode(false);
    render(<EPBundleSelectionIndicator />);
    const el = document.querySelector("[data-ep-bundle-selection-indicator]");
    expect(el!.hasAttribute("data-selected")).toBe(false);
  });
});

// ===========================================================================
// Design-time mock data coverage
// ===========================================================================

describe("Design-time mock data", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEditorMode(true);
    setupSelector({});
  });

  it("MOCK_BUNDLE_DATA has correct shape", () => {
    expect(MOCK_BUNDLE_DATA).toMatchObject({
      isValid: expect.any(Boolean),
      errors: expect.any(Array),
      pricingType: expect.stringMatching(/^(fixed|cumulative)$/),
      currentPrice: expect.any(String),
      isConfiguring: expect.any(Boolean),
      componentCount: expect.any(Number),
    });
  });

  it("MOCK_BUNDLE_COMPONENTS has correct option shape", () => {
    const option = MOCK_BUNDLE_COMPONENTS[0].options[0];
    expect(option).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      quantity: expect.any(Number),
      isSelected: expect.any(Boolean),
      isParentProduct: expect.any(Boolean),
      price: expect.any(String),
      sortOrder: expect.any(Number),
      isDefault: expect.any(Boolean),
      sku: expect.any(String),
      description: expect.any(String),
    });
  });

  it("MOCK_BUNDLE_COMPONENTS includes single-select, multi-select, and parent product types", () => {
    // Processor: single-select (min=1, max=1)
    expect(MOCK_BUNDLE_COMPONENTS[0].min).toBe(1);
    expect(MOCK_BUNDLE_COMPONENTS[0].max).toBe(1);

    // Memory: multi-select (min=1, max=3)
    expect(MOCK_BUNDLE_COMPONENTS[1].min).toBe(1);
    expect(MOCK_BUNDLE_COMPONENTS[1].max).toBe(3);

    // Storage: has a parent product option
    const parentOption = MOCK_BUNDLE_COMPONENTS[2].options.find((o: any) => o.isParentProduct);
    expect(parentOption).toBeTruthy();
  });

  it("MOCK_BUNDLE_DATA_WITH_ERRORS has errors", () => {
    expect(MOCK_BUNDLE_DATA_WITH_ERRORS.errors.length).toBeGreaterThan(0);
    expect(MOCK_BUNDLE_DATA_WITH_ERRORS.isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Variant registrations
// ---------------------------------------------------------------------------

describe("variant registrations", () => {
  it("EPBundleOptionTrigger registers selected variant", () => {
    expect(epBundleOptionTriggerMeta.variants).toEqual({
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    });
  });

  it("EPBundleSelectionIndicator registers selected variant", () => {
    expect(epBundleSelectionIndicatorMeta.variants).toEqual({
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    });
  });

  it("EPBundleVariationOptionTrigger registers selected variant", () => {
    expect(epBundleVariationOptionTriggerMeta.variants).toEqual({
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    });
  });
});
