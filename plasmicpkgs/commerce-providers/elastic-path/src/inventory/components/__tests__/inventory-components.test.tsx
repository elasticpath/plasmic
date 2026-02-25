/**
 * @jest-environment jsdom
 *
 * Tests for inventory components: StockIndicator, LocationSelector, and
 * MultiLocationStock.
 *
 * StockIndicator and LocationSelector are pure presentational components.
 * MultiLocationStock depends on hooks (useProductStock, useLocations,
 * useFormContext) and utility functions, all of which are mocked.
 *
 * esbuild jest transform hoists `import` to `require()` at file top BEFORE
 * jest.mock() calls take effect. MultiLocationStock is loaded via explicit
 * `require()` so it sees the mocked modules.
 */

// --- Mocks (hoisted by Jest before any other code) ---

jest.mock("react-hook-form", () => ({
  useFormContext: jest.fn(),
}));

jest.mock("../../use-stock", () => ({
  useProductStock: jest.fn(),
}));

jest.mock("../../use-locations", () => ({
  useLocations: jest.fn(),
}));

jest.mock("../../utils/stockCalculations", () => ({
  filterStockByLocation: jest.fn((stock) => stock),
}));

jest.mock("../../utils/displayHelpers", () => ({
  getLocationDisplayName: jest.fn(
    (loc) => loc.attributes?.name || loc.id
  ),
  createStockSummaryMessage: jest.fn(
    (avail, _alloc, count) =>
      `${avail} available across ${count} locations`
  ),
  shouldShowMoreLocationsIndicator: jest.fn(
    (total, max, selected) => !selected && total > max
  ),
  createMoreLocationsText: jest.fn(
    (total, max) => `+${total - max} more locations`
  ),
}));

// --- Imports (not mocked - safe for esbuild to hoist) ---
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// --- Pure components can be imported directly ---
import { StockIndicator } from "../StockIndicator";
import { LocationSelector } from "../LocationSelector";

// --- Load hooked component via require (after jest.mock takes effect) ---
const { MultiLocationStock } = require("../MultiLocationStock");

// --- Load mocked hook/utility references ---
const mockUseProductStock = require("../../use-stock").useProductStock;
const mockUseLocations = require("../../use-locations").useLocations;
const mockUseFormContext = require("react-hook-form").useFormContext;

// --- Mock data ---

const mockLocations = [
  {
    id: "loc-1",
    type: "inventory_location",
    attributes: { name: "Store A", slug: "store-a" },
  },
  {
    id: "loc-2",
    type: "inventory_location",
    attributes: { name: "Store B", slug: "store-b" },
  },
];

const mockStock = {
  productId: "prod-1",
  totalAvailable: 25,
  totalAllocated: 5,
  totalStock: 30,
  locations: [
    {
      location: { id: "loc-1", attributes: { name: "Store A" } },
      stock: { available: 15, allocated: 3 },
    },
    {
      location: { id: "loc-2", attributes: { name: "Store B" } },
      stock: { available: 10, allocated: 2 },
    },
  ],
};

// ---------------------------------------------------------------------------
// StockIndicator tests
// ---------------------------------------------------------------------------

describe("StockIndicator", () => {
  it('renders "Out of stock" for stock=0', () => {
    render(<StockIndicator stock={0} />);
    expect(screen.getByText("Out of stock")).toBeTruthy();
  });

  it('renders "Only {n} left" for low stock with showExact=true', () => {
    render(<StockIndicator stock={3} showExact={true} />);
    expect(screen.getByText("Only 3 left")).toBeTruthy();
  });

  it('renders "Low stock" for low stock with showExact=false', () => {
    render(<StockIndicator stock={3} showExact={false} />);
    expect(screen.getByText("Low stock")).toBeTruthy();
  });

  it('renders "{n} in stock" for medium stock with showExact=true', () => {
    render(<StockIndicator stock={10} showExact={true} />);
    expect(screen.getByText("10 in stock")).toBeTruthy();
  });

  it('renders "{n} in stock" for high stock with showExact=true', () => {
    render(<StockIndicator stock={50} showExact={true} />);
    expect(screen.getByText("50 in stock")).toBeTruthy();
  });

  it('renders "In stock" for medium stock with showExact=false', () => {
    render(<StockIndicator stock={10} showExact={false} />);
    expect(screen.getByText("In stock")).toBeTruthy();
  });

  it('renders "In stock" for high stock with showExact=false', () => {
    render(<StockIndicator stock={50} showExact={false} />);
    expect(screen.getByText("In stock")).toBeTruthy();
  });

  it("uses correct colors for each stock level", () => {
    // jsdom normalizes hex colors to rgb() in computed styles
    const { unmount: u1 } = render(<StockIndicator stock={0} />);
    const outEl = screen.getByRole("status");
    expect(outEl.style.color).toBe("rgb(211, 47, 47)"); // #d32f2f
    u1();

    const { unmount: u2 } = render(<StockIndicator stock={3} />);
    const lowEl = screen.getByRole("status");
    expect(lowEl.style.color).toBe("rgb(245, 124, 0)"); // #f57c00
    u2();

    const { unmount: u3 } = render(<StockIndicator stock={10} />);
    const medEl = screen.getByRole("status");
    expect(medEl.style.color).toBe("rgb(25, 118, 210)"); // #1976d2
    u3();

    render(<StockIndicator stock={50} />);
    const highEl = screen.getByRole("status");
    expect(highEl.style.color).toBe("rgb(56, 142, 60)"); // #388e3c
  });

  it('has role="status" and aria-live="polite"', () => {
    render(<StockIndicator stock={10} />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
  });

  it("has correct aria-label matching the stock message", () => {
    render(<StockIndicator stock={3} showExact={true} />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("Only 3 left");
  });

  it("icons are aria-hidden", () => {
    render(<StockIndicator stock={0} />);
    const el = screen.getByRole("status");
    const iconSpan = el.querySelector('span[aria-hidden="true"]');
    expect(iconSpan).toBeTruthy();
  });

  it("custom thresholds change stock level boundaries", () => {
    // With custom thresholds low=10, medium=30: stock=8 should be "low"
    render(
      <StockIndicator
        stock={8}
        threshold={{ low: 10, medium: 30 }}
        showExact={true}
      />
    );
    expect(screen.getByText("Only 8 left")).toBeTruthy();
    expect(screen.getByRole("status").style.color).toBe("rgb(245, 124, 0)"); // #f57c00
  });

  it('negative stock shows "Out of stock"', () => {
    render(<StockIndicator stock={-5} />);
    expect(screen.getByText("Out of stock")).toBeTruthy();
    expect(screen.getByRole("status").style.color).toBe("rgb(211, 47, 47)"); // #d32f2f
  });

  it("uses bold weight (600) for low/out stock and normal (400) otherwise", () => {
    const { unmount: u1 } = render(<StockIndicator stock={0} />);
    expect(screen.getByRole("status").style.fontWeight).toBe("600");
    u1();

    const { unmount: u2 } = render(<StockIndicator stock={3} />);
    expect(screen.getByRole("status").style.fontWeight).toBe("600");
    u2();

    const { unmount: u3 } = render(<StockIndicator stock={10} />);
    expect(screen.getByRole("status").style.fontWeight).toBe("400");
    u3();

    render(<StockIndicator stock={50} />);
    expect(screen.getByRole("status").style.fontWeight).toBe("400");
  });
});

// ---------------------------------------------------------------------------
// LocationSelector tests
// ---------------------------------------------------------------------------

describe("LocationSelector", () => {
  const noop = jest.fn();

  afterEach(() => {
    noop.mockClear();
  });

  it('shows "Loading locations..." when loading', () => {
    render(
      <LocationSelector
        locations={[]}
        onLocationChange={noop}
        loading={true}
      />
    );
    expect(screen.getByText("Loading locations...")).toBeTruthy();
  });

  it('shows "No locations available" when locations array is empty', () => {
    render(
      <LocationSelector locations={[]} onLocationChange={noop} />
    );
    expect(screen.getByText("No locations available")).toBeTruthy();
  });

  it("renders select with correct options", () => {
    render(
      <LocationSelector
        locations={mockLocations as any}
        onLocationChange={noop}
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    // placeholder + 2 locations = 3 options
    expect(select.options.length).toBe(3);
    expect(select.options[1].textContent).toBe("Store A");
    expect(select.options[1].value).toBe("loc-1");
    expect(select.options[2].textContent).toBe("Store B");
    expect(select.options[2].value).toBe("loc-2");
  });

  it("shows placeholder as first disabled option", () => {
    render(
      <LocationSelector
        locations={mockLocations as any}
        onLocationChange={noop}
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const placeholder = select.options[0];
    expect(placeholder.textContent).toBe("Select a location");
    expect(placeholder.disabled).toBe(true);
    expect(placeholder.value).toBe("");
  });

  it("calls onLocationChange on selection", () => {
    render(
      <LocationSelector
        locations={mockLocations as any}
        onLocationChange={noop}
      />
    );
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "loc-2" } });
    expect(noop).toHaveBeenCalledWith("loc-2");
  });

  it("accepts custom placeholder text", () => {
    render(
      <LocationSelector
        locations={mockLocations as any}
        onLocationChange={noop}
        placeholder="Pick a store"
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.options[0].textContent).toBe("Pick a store");
  });

  it('falls back to "Location {id}" when no name attribute', () => {
    const noNameLocations = [
      { id: "xyz-123", type: "inventory_location" },
    ];
    render(
      <LocationSelector
        locations={noNameLocations as any}
        onLocationChange={noop}
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.options[1].textContent).toBe("Location xyz-123");
  });

  it("sets selected value from selectedLocationId prop", () => {
    render(
      <LocationSelector
        locations={mockLocations as any}
        selectedLocationId="loc-2"
        onLocationChange={noop}
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("loc-2");
  });
});

// ---------------------------------------------------------------------------
// MultiLocationStock tests
// ---------------------------------------------------------------------------

describe("MultiLocationStock", () => {
  const mockSetValue = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocations.mockReturnValue({
      locations: mockLocations,
      loading: false,
    });
    mockUseProductStock.mockReturnValue({
      stock: mockStock,
      loading: false,
      error: null,
    });
    mockUseFormContext.mockReturnValue({ setValue: mockSetValue });
  });

  it('shows "No product selected" without productId', () => {
    render(<MultiLocationStock />);
    expect(screen.getByText("No product selected")).toBeTruthy();
  });

  it("shows loading state when stock is loading", () => {
    mockUseProductStock.mockReturnValue({
      stock: null,
      loading: true,
      error: null,
    });
    render(<MultiLocationStock productId="prod-1" />);
    expect(screen.getByText("Loading stock information...")).toBeTruthy();
  });

  it("shows loading state when locations are loading", () => {
    mockUseLocations.mockReturnValue({
      locations: [],
      loading: true,
    });
    render(<MultiLocationStock productId="prod-1" />);
    expect(screen.getByText("Loading stock information...")).toBeTruthy();
  });

  it("shows error state with message", () => {
    mockUseProductStock.mockReturnValue({
      stock: null,
      loading: false,
      error: { message: "Network failure" },
    });
    render(<MultiLocationStock productId="prod-1" />);
    expect(
      screen.getByText("Error loading stock: Network failure")
    ).toBeTruthy();
  });

  it('shows "No stock information available" for null stock', () => {
    mockUseProductStock.mockReturnValue({
      stock: null,
      loading: false,
      error: null,
    });
    render(<MultiLocationStock productId="prod-1" />);
    expect(
      screen.getByText("No stock information available")
    ).toBeTruthy();
  });

  it('shows "No stock information available" for empty locations', () => {
    mockUseProductStock.mockReturnValue({
      stock: { ...mockStock, locations: [] },
      loading: false,
      error: null,
    });
    render(<MultiLocationStock productId="prod-1" />);
    expect(
      screen.getByText("No stock information available")
    ).toBeTruthy();
  });

  it("renders location list with stock indicators", () => {
    render(<MultiLocationStock productId="prod-1" />);
    // Each location should have a listitem
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);
    // Each location renders a StockIndicator with role="status"
    const statusElements = screen.getAllByRole("status");
    expect(statusElements.length).toBe(2);
  });

  it('shows "more locations" indicator when exceeding maxLocationsDisplay', () => {
    // 2 locations, max display 1
    render(
      <MultiLocationStock productId="prod-1" maxLocationsDisplay={1} />
    );
    // shouldShowMoreLocationsIndicator mock returns true when total > max and no selection
    expect(screen.getByText("+1 more locations")).toBeTruthy();
  });

  it('has role="region" and aria-label="Stock availability"', () => {
    render(<MultiLocationStock productId="prod-1" />);
    const region = screen.getByRole("region");
    expect(region.getAttribute("aria-label")).toBe("Stock availability");
  });

  it("location list has list and listitem roles", () => {
    render(<MultiLocationStock productId="prod-1" />);
    const list = screen.getByRole("list");
    expect(list).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);
  });

  it("shows stock summary when no location is selected", () => {
    render(<MultiLocationStock productId="prod-1" />);
    // createStockSummaryMessage mock returns: "{avail} available across {count} locations"
    expect(
      screen.getByText("25 available across 2 locations")
    ).toBeTruthy();
  });
});
