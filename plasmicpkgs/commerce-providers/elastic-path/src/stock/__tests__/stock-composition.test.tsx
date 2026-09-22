/**
 * @jest-environment jsdom
 *
 * The stock components compose as EPStockProvider > EPLocationPicker >
 * EPLocationField, with the provider itself doing the per-location repeat.
 * These tests pin that contract: no separate list component sits between the
 * provider and the picker.
 *
 * previewState="withLocations" drives the same repeat + DataProvider code as
 * the live path, against MOCK_STOCK_LOCATIONS, so no hook mocking is needed.
 */

import { render, screen } from "@testing-library/react";
import React from "react";
import { EPStockProvider } from "../EPStockProvider";
import { EPLocationPicker } from "../EPLocationPicker";
import { EPLocationField } from "../EPLocationField";
import { MOCK_STOCK_LOCATIONS } from "../../utils/design-time-data";

function renderTree(maxLocations?: number) {
  return render(
    <EPStockProvider previewState="withLocations" maxLocations={maxLocations}>
      <EPLocationPicker>
        <EPLocationField field="name" />
        <EPLocationField field="available" />
      </EPLocationPicker>
    </EPStockProvider>
  );
}

describe("stock component composition", () => {
  it("repeats the picker once per location without a list component", () => {
    renderTree();

    expect(screen.getAllByRole("radio")).toHaveLength(
      MOCK_STOCK_LOCATIONS.length
    );
  });

  it("gives each repeat its own location data", () => {
    renderTree();

    for (const location of MOCK_STOCK_LOCATIONS) {
      expect(screen.getByText(location.name)).toBeTruthy();
    }
  });

  it("disables out-of-stock locations", () => {
    renderTree();

    const outOfStock = MOCK_STOCK_LOCATIONS.filter((l) => !l.isInStock);
    expect(outOfStock.length).toBeGreaterThan(0);

    for (const location of outOfStock) {
      expect(
        screen.getByLabelText(location.name).getAttribute("aria-disabled")
      ).toBe("true");
    }
  });

  it("honours maxLocations on the provider", () => {
    renderTree(1);

    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByText(MOCK_STOCK_LOCATIONS[0].name)).toBeTruthy();
  });

  it("exposes exactly one roving focus target across the group", () => {
    renderTree();

    const focusable = screen
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);
  });
});
