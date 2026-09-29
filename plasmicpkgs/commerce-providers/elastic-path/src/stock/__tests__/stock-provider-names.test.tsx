/**
 * @jest-environment jsdom
 *
 * EPStockProvider's live path shows each location's name, not its slug. The
 * stock response keys locations by slug only; epGetStock resolves the names
 * server-side, so the provider reads them off the stock and makes no second
 * read for the locations list.
 */

import React from "react";

const mockCallEpProxy = jest.fn();
jest.mock("../../ep-server-functions/proxy-fetch", () => ({
  shouldUseProxy: () => true,
  callEpProxy: (...a: unknown[]) => mockCallEpProxy(...a),
}));

jest.mock("../../shopper-context/EpCommerceContext", () => ({
  __esModule: true,
  useEpCommerce: () => ({ locale: "en-US" }),
}));

import { render, screen } from "@testing-library/react";
import { DataProvider } from "@plasmicapp/host";
import { PlasmicQueryDataProvider } from "@plasmicapp/query";

const { EPStockProvider } =
  require("../EPStockProvider") as typeof import("../EPStockProvider");
const { EPLocationPicker } =
  require("../EPLocationPicker") as typeof import("../EPLocationPicker");
const { EPLocationField } =
  require("../EPLocationField") as typeof import("../EPLocationField");

const location = (
  productId: string,
  slug: string,
  name: string,
  available: number
) => ({
  location: {
    id: slug,
    type: "inventory_location",
    attributes: { name, slug },
  },
  stock: { productId, available, allocated: 0, total: available },
});

// epGetStock's result as the proxy route returns it, names already resolved.
beforeEach(() => {
  mockCallEpProxy.mockReset();
  mockCallEpProxy.mockImplementation(
    (fn: string, { productIds }: { productIds: string[] }) => {
      if (fn !== "getStock") return Promise.resolve(null);
      const [productId] = productIds;
      return Promise.resolve({
        [productId]: {
          productId,
          locations: [
            location(productId, "east-dc", "East Distribution Centre", 10),
            location(productId, "main-warehouse", "Main Warehouse", 3),
          ],
          totalAvailable: 13,
          totalAllocated: 0,
          totalStock: 13,
        },
      });
    }
  );
});

// A fresh query cache per render, so each test sees every read it causes.
function renderProvider(productId: string) {
  return render(
    <PlasmicQueryDataProvider provider={() => new Map()}>
      <DataProvider name="currentProduct" data={{ id: productId }}>
        <EPStockProvider>
          <EPLocationPicker>
            <EPLocationField field="name" />
          </EPLocationPicker>
        </EPStockProvider>
      </DataProvider>
    </PlasmicQueryDataProvider>
  );
}

describe("EPStockProvider location names", () => {
  it("shows the name epGetStock resolved, not the slug", async () => {
    renderProvider("p1");

    expect(await screen.findByText("East Distribution Centre")).toBeTruthy();
    expect(screen.getByText("Main Warehouse")).toBeTruthy();
    expect(screen.queryByText("east-dc")).toBeNull();
  });

  it("reads stock through the server and makes no locations read", async () => {
    renderProvider("p1");
    await screen.findByText("East Distribution Centre");

    expect(mockCallEpProxy).toHaveBeenCalledWith(
      "getStock",
      { productIds: ["p1"], locationIds: undefined },
      null
    );
    expect(mockCallEpProxy.mock.calls.map(([fn]) => fn)).not.toContain(
      "getLocations"
    );
  });
});
