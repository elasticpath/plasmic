/**
 * @jest-environment jsdom
 *
 * EP Product Grid reads `productGridData`, which only EP Product List
 * Provider and EP Related Products Provider supply. Placed inside EP Catalog
 * Search Provider instead, it has nothing to render, so it must say so.
 */

import { PlasmicCanvasContext } from "@plasmicapp/host";
import { render, screen } from "@testing-library/react";
import React from "react";

const mockUseProductList = jest.fn();
const mockUseRelatedProducts = jest.fn();

jest.mock("../use-product-list", () => ({
  useProductList: (...a: unknown[]) => mockUseProductList(...a),
}));

jest.mock("../use-related-products", () => ({
  useRelatedProducts: (...a: unknown[]) => mockUseRelatedProducts(...a),
}));

jest.mock("react-instantsearch", () => ({
  Configure: () => null,
  useInstantSearch: () => ({ status: "idle", error: undefined }),
  useInstantSearchContext: () => ({ refresh: () => {} }),
  useRSCContext: () => ({}),
  useSearchBox: () => ({ query: "", refine: () => {}, clear: () => {} }),
}));

jest.mock("react-instantsearch-nextjs", () => ({
  InstantSearchNext: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("@elasticpath/catalog-search-instantsearch-adapter", () => ({
  __esModule: true,
  default: class {
    searchClient = { search: () => Promise.resolve({ results: [] }) };
  },
}));

const { EPProductGrid } =
  require("../EPProductGrid") as typeof import("../EPProductGrid");
const { EPProductListProvider } =
  require("../EPProductListProvider") as typeof import("../EPProductListProvider");
const { EPRelatedProductsProvider } =
  require("../EPRelatedProductsProvider") as typeof import("../EPRelatedProductsProvider");
const { EPCatalogSearchProvider } =
  require("../../catalog-search/EPCatalogSearchProvider") as typeof import("../../catalog-search/EPCatalogSearchProvider");

const product = (id: string) => ({
  id,
  type: "product",
  attributes: { name: id },
  images: [],
  variations: [],
  childProducts: [],
});

const grid = (
  <EPProductGrid>
    <span data-testid="card" />
  </EPProductGrid>
);

let warn: jest.SpyInstance;

function gridWarnings() {
  return warn.mock.calls.filter((args) =>
    String(args[0]).includes("EP Product Grid")
  );
}

beforeEach(() => {
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  mockUseProductList.mockReturnValue({
    products: [product("list-1"), product("list-2")],
    totalCount: 2,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  });
  mockUseRelatedProducts.mockReturnValue({
    products: [product("related-1")],
    totalCount: 1,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  });
});

afterEach(() => {
  warn.mockRestore();
});

describe("EP Product Grid inside EP Catalog Search Provider", () => {
  it("warns that the search provider does not supply its products and names EP Search Hits", () => {
    render(<EPCatalogSearchProvider>{grid}</EPCatalogSearchProvider>);

    expect(gridWarnings()).toHaveLength(1);
    const message = String(gridWarnings()[0][0]);
    expect(message).toContain("EP Catalog Search Provider");
    expect(message).toContain("EP Search Hits");
    expect(screen.queryAllByTestId("card")).toHaveLength(0);
  });

  it("warns once per mount, not on every render", () => {
    const { rerender } = render(
      <EPCatalogSearchProvider>{grid}</EPCatalogSearchProvider>
    );
    rerender(<EPCatalogSearchProvider hitsPerPage={24}>{grid}</EPCatalogSearchProvider>);
    rerender(<EPCatalogSearchProvider hitsPerPage={48}>{grid}</EPCatalogSearchProvider>);

    expect(gridWarnings()).toHaveLength(1);
  });

  it("warns once under StrictMode's double-invoked effects", () => {
    render(
      <React.StrictMode>
        <EPCatalogSearchProvider>{grid}</EPCatalogSearchProvider>
      </React.StrictMode>
    );

    expect(gridWarnings()).toHaveLength(1);
  });
});

const productListSources: Array<[string, React.ReactElement, number]> = [
  [
    "EP Product List Provider",
    <EPProductListProvider key="list">{grid}</EPProductListProvider>,
    2,
  ],
  [
    "EP Related Products Provider",
    <EPRelatedProductsProvider key="related" productId="p-1">
      {grid}
    </EPRelatedProductsProvider>,
    1,
  ],
];

describe("EP Product Grid inside a product-list source", () => {
  it.each(productListSources)(
    "renders %s's products without warning",
    (_name, tree, cards) => {
      render(tree);

      expect(gridWarnings()).toHaveLength(0);
      expect(screen.getAllByTestId("card")).toHaveLength(cards);
    }
  );

  it.each(productListSources)(
    "does not warn when %s sits inside EP Catalog Search Provider",
    (_name, tree, cards) => {
      render(<EPCatalogSearchProvider>{tree}</EPCatalogSearchProvider>);

      expect(gridWarnings()).toHaveLength(0);
      expect(screen.getAllByTestId("card")).toHaveLength(cards);
    }
  );

  it("does not warn outside any provider", () => {
    render(grid);

    expect(gridWarnings()).toHaveLength(0);
  });
});

describe("EP Product Grid on the Studio canvas", () => {
  const canvas = { componentName: null, globalVariants: {}, interactive: false };

  function onCanvas(tree: React.ReactElement) {
    return render(
      <PlasmicCanvasContext.Provider value={canvas}>
        {tree}
      </PlasmicCanvasContext.Provider>
    );
  }

  it.each([undefined, "withData"] as const)(
    "shows the mismatch inside EP Catalog Search Provider instead of sample products (previewState %s)",
    (previewState) => {
      onCanvas(
        <EPCatalogSearchProvider>
          <EPProductGrid previewState={previewState}>
            <span data-testid="card" />
          </EPProductGrid>
        </EPCatalogSearchProvider>
      );

      expect(screen.queryAllByTestId("card")).toHaveLength(0);
      expect(
        screen.getByText(/EP Catalog Search Provider/).textContent
      ).toContain("EP Search Hits");
      expect(gridWarnings()).toHaveLength(1);
    }
  );

  it("shows sample products when a product-list provider sits inside EP Catalog Search Provider", () => {
    onCanvas(
      <EPCatalogSearchProvider>
        <EPProductListProvider>{grid}</EPProductListProvider>
      </EPCatalogSearchProvider>
    );

    expect(screen.getAllByTestId("card").length).toBeGreaterThan(0);
    expect(screen.queryByText(/EP Search Hits/)).toBeNull();
    expect(gridWarnings()).toHaveLength(0);
  });
});
