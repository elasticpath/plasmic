/**
 * @jest-environment jsdom
 *
 * Tests for Phase 2 catalog search components.
 *
 * Why: These components wrap react-instantsearch to provide faceted search
 * via Elastic Path Catalog Search. Tests verify that:
 * - Design-time mock data renders correctly for all 9 components
 * - Component registration metadata matches the spec
 * - Data shapes (currentProduct, currentRefinement, etc.) are correct
 * - Mock data has correct structure and unique IDs
 * - refActions are properly exposed
 *
 * react-instantsearch hooks are mocked since they require an InstantSearch
 * context that depends on a real search backend.
 */

import React from "react";

/* ---------- mock variables (declared before jest.mock) ---------- */
const mockUsePlasmicCanvasContext = jest.fn();
const mockUseSelector = jest.fn();
const mockRepeatedElement = jest.fn(
  (_idx: number, children: React.ReactNode) => children
);
const mockUseCommerce = jest.fn();

/* ---------- mock react-instantsearch hooks ---------- */
const mockUseSearchBox = jest.fn().mockReturnValue({
  query: "leather",
  refine: jest.fn(),
  clear: jest.fn(),
});

const mockUseHits = jest.fn().mockReturnValue({
  hits: [],
});

const mockUseInstantSearch = jest.fn().mockReturnValue({
  indexUiState: {},
});

const mockUseRefinementList = jest.fn().mockReturnValue({
  items: [],
  refine: jest.fn(),
});

const mockUseHierarchicalMenu = jest.fn().mockReturnValue({
  items: [],
  refine: jest.fn(),
});

const mockUseRange = jest.fn().mockReturnValue({
  range: { min: 0, max: 500 },
  start: [0, 500],
  refine: jest.fn(),
  canRefine: true,
});

const mockUsePagination = jest.fn().mockReturnValue({
  currentRefinement: 0,
  nbPages: 4,
  pages: [0, 1, 2, 3],
  refine: jest.fn(),
  isFirstPage: true,
  isLastPage: false,
});

const mockUseStats = jest.fn().mockReturnValue({
  nbHits: 48,
  processingTimeMS: 12,
  query: "leather",
});

const mockUseSortBy = jest.fn().mockReturnValue({
  currentRefinement: "relevance",
  options: [
    { value: "relevance", label: "Most Relevant" },
    { value: "price:asc", label: "Price: Low to High" },
  ],
  refine: jest.fn(),
});

/* ---------- jest.mock calls ---------- */
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({
    children,
    name,
    data,
  }: {
    children: React.ReactNode;
    name: string;
    data: any;
  }) => (
    <div
      data-testid={`data-provider-${name}`}
      data-provider-data={JSON.stringify(data)}
    >
      {children}
    </div>
  ),
  useSelector: (...args: any[]) => mockUseSelector(...args),
  usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
  repeatedElement: (...args: any[]) => mockRepeatedElement(...args),
}));

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../../elastic-path", () => ({
  useCommerce: (...a: unknown[]) => mockUseCommerce(...a),
}));

jest.mock("../../utils/errorHandling", () => ({
  handleAPIError: jest.fn().mockImplementation((err: unknown) =>
    err instanceof Error ? err : new Error(String(err))
  ),
}));

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock("react-instantsearch", () => ({
  useSearchBox: (...a: unknown[]) => mockUseSearchBox(...a),
  useHits: (...a: unknown[]) => mockUseHits(...a),
  useInstantSearch: (...a: unknown[]) => mockUseInstantSearch(...a),
  useRefinementList: (...a: unknown[]) => mockUseRefinementList(...a),
  useHierarchicalMenu: (...a: unknown[]) => mockUseHierarchicalMenu(...a),
  useRange: (...a: unknown[]) => mockUseRange(...a),
  usePagination: (...a: unknown[]) => mockUsePagination(...a),
  useStats: (...a: unknown[]) => mockUseStats(...a),
  useSortBy: (...a: unknown[]) => mockUseSortBy(...a),
  InstantSearch: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="instantsearch">{children}</div>
  ),
  Configure: () => null,
}));

jest.mock("@elasticpath/catalog-search-instantsearch-adapter", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    searchClient: { search: jest.fn(), searchForFacetValues: jest.fn() },
  })),
}));

/* ---------- code under test (after mocks) ---------- */
import { render } from "@testing-library/react";
import { describeHeadlessStylingContract } from "./headless-styling-contract";

function setEditorMode(inEditor: boolean) {
  if (inEditor) {
    mockUsePlasmicCanvasContext.mockReturnValue({});
  } else {
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  }
}

const {
  MOCK_SEARCH_PRODUCTS,
  MOCK_CATALOG_SEARCH_DATA,
  MOCK_REFINEMENT_ITEMS,
  MOCK_CATEGORY_ITEMS,
  MOCK_RANGE_DATA,
  MOCK_SEARCH_PAGINATION_DATA,
  MOCK_SEARCH_STATS_DATA,
  MOCK_SORT_BY_DATA,
} = require("../design-time-data") as typeof import("../design-time-data");

const {
  EPCatalogSearchProvider,
  epCatalogSearchProviderMeta,
  registerEPCatalogSearchProvider,
} = require("../EPCatalogSearchProvider") as typeof import("../EPCatalogSearchProvider");

const { EPSearchBox, epSearchBoxMeta, registerEPSearchBox } =
  require("../EPSearchBox") as typeof import("../EPSearchBox");

const { EPSearchHits, epSearchHitsMeta, registerEPSearchHits } =
  require("../EPSearchHits") as typeof import("../EPSearchHits");

const { EPRefinementList, epRefinementListMeta, registerEPRefinementList } =
  require("../EPRefinementList") as typeof import("../EPRefinementList");

const {
  EPHierarchicalMenu,
  epHierarchicalMenuMeta,
  registerEPHierarchicalMenu,
} = require("../EPHierarchicalMenu") as typeof import("../EPHierarchicalMenu");

const { EPRangeFilter, epRangeFilterMeta, registerEPRangeFilter } =
  require("../EPRangeFilter") as typeof import("../EPRangeFilter");

const {
  EPSearchPagination,
  epSearchPaginationMeta,
  registerEPSearchPagination,
} = require("../EPSearchPagination") as typeof import("../EPSearchPagination");

const { EPSearchStats, epSearchStatsMeta, registerEPSearchStats } =
  require("../EPSearchStats") as typeof import("../EPSearchStats");

const { EPSearchSortBy, epSearchSortByMeta, registerEPSearchSortBy } =
  require("../EPSearchSortBy") as typeof import("../EPSearchSortBy");

/* ---------- helpers ---------- */
const mockClient = { baseUrl: "https://api.test.com" };
const mockProvider = { locale: "en-US", client: mockClient };

function setupCommerce() {
  mockUseCommerce.mockReturnValue({
    providerRef: { current: mockProvider },
  });
}

/* ================================================================
 * Design-time data tests
 * ================================================================ */
describe("design-time-data", () => {
  it("should have 6 mock search products", () => {
    expect(MOCK_SEARCH_PRODUCTS).toHaveLength(6);
  });

  it("should have unique product IDs", () => {
    const ids = MOCK_SEARCH_PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should have distinct IDs from product-discovery mocks", () => {
    for (const product of MOCK_SEARCH_PRODUCTS) {
      expect(product.id).toMatch(/^sample-cs-/);
    }
  });

  it("should have valid product shapes", () => {
    for (const product of MOCK_SEARCH_PRODUCTS) {
      expect(product.id).toBeTruthy();
      expect(product.name).toBeTruthy();
      expect(product.slug).toBeTruthy();
      expect(product.path).toMatch(/^\//);
      expect(typeof product.price.value).toBe("number");
      expect(product.price.currencyCode).toBe("USD");
      expect(product.images.length).toBeGreaterThan(0);
    }
  });

  it("should have valid MOCK_CATALOG_SEARCH_DATA", () => {
    expect(MOCK_CATALOG_SEARCH_DATA.isSearchActive).toBe(true);
    expect(MOCK_CATALOG_SEARCH_DATA.query).toBe("leather");
    expect(MOCK_CATALOG_SEARCH_DATA.currencyCode).toBe("USD");
  });

  it("should have valid MOCK_REFINEMENT_ITEMS", () => {
    expect(MOCK_REFINEMENT_ITEMS.length).toBeGreaterThan(0);
    for (const item of MOCK_REFINEMENT_ITEMS) {
      expect(item.value).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(typeof item.count).toBe("number");
      expect(typeof item.isRefined).toBe("boolean");
    }
  });

  it("should have valid MOCK_CATEGORY_ITEMS", () => {
    expect(MOCK_CATEGORY_ITEMS.length).toBeGreaterThan(0);
    for (const item of MOCK_CATEGORY_ITEMS) {
      expect(item.value).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(typeof item.count).toBe("number");
      expect(typeof item.depth).toBe("number");
      expect(typeof item.hasChildren).toBe("boolean");
    }
  });

  it("should have valid MOCK_RANGE_DATA", () => {
    expect(MOCK_RANGE_DATA.min).toBeLessThan(MOCK_RANGE_DATA.max);
    expect(MOCK_RANGE_DATA.currentMin).toBeGreaterThanOrEqual(
      MOCK_RANGE_DATA.min
    );
    expect(MOCK_RANGE_DATA.currentMax).toBeLessThanOrEqual(
      MOCK_RANGE_DATA.max
    );
    expect(MOCK_RANGE_DATA.canRefine).toBe(true);
  });

  it("should have valid MOCK_SEARCH_PAGINATION_DATA", () => {
    expect(MOCK_SEARCH_PAGINATION_DATA.currentPage).toBe(0);
    expect(MOCK_SEARCH_PAGINATION_DATA.totalPages).toBe(4);
    expect(MOCK_SEARCH_PAGINATION_DATA.hasNext).toBe(true);
    expect(MOCK_SEARCH_PAGINATION_DATA.hasPrev).toBe(false);
    expect(MOCK_SEARCH_PAGINATION_DATA.pages).toEqual([0, 1, 2, 3]);
  });

  it("should have valid MOCK_SEARCH_STATS_DATA", () => {
    expect(MOCK_SEARCH_STATS_DATA.nbHits).toBe(48);
    expect(MOCK_SEARCH_STATS_DATA.query).toBe("leather");
    expect(MOCK_SEARCH_STATS_DATA.processingTimeMS).toBe(12);
    expect(MOCK_SEARCH_STATS_DATA.summary).toContain("48");
    expect(MOCK_SEARCH_STATS_DATA.summary).toContain("leather");
  });

  it("should have valid MOCK_SORT_BY_DATA", () => {
    expect(MOCK_SORT_BY_DATA.currentValue).toBe("relevance");
    expect(MOCK_SORT_BY_DATA.options.length).toBeGreaterThan(0);
    for (const opt of MOCK_SORT_BY_DATA.options) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
  });
});

/* ================================================================
 * EPCatalogSearchProvider tests
 * ================================================================ */
describe("EPCatalogSearchProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommerce();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("should render mock data in editor (auto previewState)", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPCatalogSearchProvider>
        <div data-testid="child">Search content</div>
      </EPCatalogSearchProvider>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-catalogSearchData"]'
    );
    expect(provider).not.toBeNull();

    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.isSearchActive).toBe(true);
    expect(data.query).toBe("leather");
    expect(data.currencyCode).toBe("USD");
  });

  it("should render loading state in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPCatalogSearchProvider previewState="loading">
        <div>children</div>
      </EPCatalogSearchProvider>
    );

    expect(container.textContent).toContain("Loading");
  });

  it("should render error state in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPCatalogSearchProvider
        previewState="error"
        errorContent={<div>Custom error</div>}
      >
        <div>children</div>
      </EPCatalogSearchProvider>
    );

    expect(container.textContent).toContain("Custom error");
  });

  it("should render empty state in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPCatalogSearchProvider previewState="empty">
        <div>children</div>
      </EPCatalogSearchProvider>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-catalogSearchData"]'
    );
    expect(provider).not.toBeNull();

    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.isSearchActive).toBe(false);
    expect(data.query).toBe("");
  });
});

/* ================================================================
 * EPSearchBox tests — provider with no DOM (PRD #308)
 * ================================================================ */
describe("EPSearchBox", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("provides searchFieldData with mock shape in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPSearchBox>
        <div>child</div>
      </EPSearchBox>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-searchFieldData"]'
    );
    expect(provider).not.toBeNull();
    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.value).toBe("leather");
    expect(data.displayValue).toBe("leather");
    expect(data.isEmpty).toBe(false);
  });

  it("does not render mock chrome (no input or button in DOM) in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPSearchBox>
        <div data-testid="user-content">user content</div>
      </EPSearchBox>
    );

    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('[data-testid="user-content"]')).not.toBeNull();
  });

  it("setValue ref-action updates searchFieldData.value at runtime", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    mockUseSearchBox.mockReturnValue({
      query: "",
      refine: jest.fn(),
      clear: jest.fn(),
    });

    const ref = React.createRef<{
      setValue: (v: string) => void;
      clear: () => void;
    }>();

    const { container, rerender } = render(
      <EPSearchBox ref={ref}>
        <div>child</div>
      </EPSearchBox>
    );

    require("react-dom/test-utils").act(() => {
      ref.current!.setValue("boots");
    });

    rerender(
      <EPSearchBox ref={ref}>
        <div>child</div>
      </EPSearchBox>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-searchFieldData"]'
    );
    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.value).toBe("boots");
    expect(data.isEmpty).toBe(false);
  });

  it("setValue debounces refine() by debounceMs", () => {
    jest.useFakeTimers();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    const refine = jest.fn();
    mockUseSearchBox.mockReturnValue({
      query: "",
      refine,
      clear: jest.fn(),
    });

    const ref = React.createRef<{
      setValue: (v: string) => void;
      clear: () => void;
    }>();

    render(
      <EPSearchBox ref={ref} debounceMs={250}>
        <div>child</div>
      </EPSearchBox>
    );

    require("react-dom/test-utils").act(() => {
      ref.current!.setValue("hat");
    });

    expect(refine).not.toHaveBeenCalled();

    require("react-dom/test-utils").act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(refine).toHaveBeenCalledTimes(1);
    expect(refine).toHaveBeenCalledWith("hat");

    jest.useRealTimers();
  });

  it("clear ref-action resets value and calls useSearchBox().clear()", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    const refine = jest.fn();
    const clear = jest.fn();
    mockUseSearchBox.mockReturnValue({
      query: "boots",
      refine,
      clear,
    });

    const ref = React.createRef<{
      setValue: (v: string) => void;
      clear: () => void;
    }>();

    const { container, rerender } = render(
      <EPSearchBox ref={ref}>
        <div>child</div>
      </EPSearchBox>
    );

    require("react-dom/test-utils").act(() => {
      ref.current!.setValue("boots");
    });

    require("react-dom/test-utils").act(() => {
      ref.current!.clear();
    });

    rerender(
      <EPSearchBox ref={ref}>
        <div>child</div>
      </EPSearchBox>
    );

    expect(clear).toHaveBeenCalledTimes(1);

    const provider = container.querySelector(
      '[data-testid="data-provider-searchFieldData"]'
    );
    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.value).toBe("");
    expect(data.isEmpty).toBe(true);
  });

  it("displayValue reflects the refined query (diverges from in-flight value during debounce)", () => {
    jest.useFakeTimers();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    mockUseSearchBox.mockReturnValue({
      query: "leather",
      refine: jest.fn(),
      clear: jest.fn(),
    });

    const ref = React.createRef<{
      setValue: (v: string) => void;
      clear: () => void;
    }>();

    const { container, rerender } = render(
      <EPSearchBox ref={ref} debounceMs={250}>
        <div>child</div>
      </EPSearchBox>
    );

    // User typed but debounce hasn't fired yet — displayValue still equals the
    // last refined query, value reflects the new keystroke.
    require("react-dom/test-utils").act(() => {
      ref.current!.setValue("leath");
    });

    rerender(
      <EPSearchBox ref={ref} debounceMs={250}>
        <div>child</div>
      </EPSearchBox>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-searchFieldData"]'
    );
    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.value).toBe("leath");
    expect(data.displayValue).toBe("leather");

    jest.useRealTimers();
  });

  it("previewState='withData' forces mock outside the editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(null);

    const { container } = render(
      <EPSearchBox previewState="withData">
        <div>child</div>
      </EPSearchBox>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-searchFieldData"]'
    );
    expect(provider).not.toBeNull();
    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.value).toBe("leather");
  });

  it("meta exposes setValue and clear refActions and providesData", () => {
    expect(epSearchBoxMeta.providesData).toBe(true);
    expect(epSearchBoxMeta.refActions!.setValue).toBeDefined();
    expect(epSearchBoxMeta.refActions!.setValue.argTypes).toEqual([
      { name: "value", type: "string" },
    ]);
    expect(epSearchBoxMeta.refActions!.clear).toBeDefined();
    expect(epSearchBoxMeta.refActions!.clear.argTypes).toEqual([]);
  });

});

/* ================================================================
 * EPSearchHits tests
 * ================================================================ */
describe("EPSearchHits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("should render mock products in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPSearchHits>
        <div data-testid="card">Product Card</div>
      </EPSearchHits>
    );

    const listItems = container.querySelectorAll('[role="listitem"]');
    expect(listItems.length).toBe(MOCK_SEARCH_PRODUCTS.length);
  });

  it("should expose currentProduct with formatted price in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPSearchHits>
        <div>child</div>
      </EPSearchHits>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-currentProduct"]'
    );
    expect(providerEl).not.toBeNull();

    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.id).toBe("sample-cs-001");
    expect(data.name).toContain("Sample");
    expect(data.price.formatted).toBeTruthy();
    expect(data.price.currencyCode).toBe("USD");
  });

  it("should expose currentProductIndex in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPSearchHits>
        <div>child</div>
      </EPSearchHits>
    );

    const indexProviders = container.querySelectorAll(
      '[data-testid="data-provider-currentProductIndex"]'
    );
    expect(indexProviders.length).toBe(MOCK_SEARCH_PRODUCTS.length);
    expect(
      JSON.parse(
        indexProviders[0].getAttribute("data-provider-data") || "null"
      )
    ).toBe(0);
  });

  it("should read currencyCode from parent catalogSearchData context at runtime", () => {
    // Runtime mode (not in editor)
    mockUsePlasmicCanvasContext.mockReturnValue(null);

    // Parent EPCatalogSearchProvider exposes catalogSearchData with currencyCode
    mockUseSelector.mockImplementation((name: string) => {
      if (name === "catalogSearchData") return { currencyCode: "GBP" };
      return undefined;
    });

    mockUseHits.mockReturnValue({
      hits: [
        {
          objectID: "hit-gbp-1",
          ep_name: "British Product",
          ep_slug: "british-product",
          ep_sku: "BP-001",
          ep_description: "A product priced in GBP",
          ep_price: { GBP: { float_price: 29.99 } },
          ep_main_image_url: "https://example.com/img.png",
        },
      ],
    });

    const { container } = render(
      <EPSearchHits>
        <div>child</div>
      </EPSearchHits>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-currentProduct"]'
    );
    expect(providerEl).not.toBeNull();

    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.price.currencyCode).toBe("GBP");
    expect(data.price.value).toBe(29.99);
    expect(data.name).toBe("British Product");
  });

  it("should fall back to USD when catalogSearchData has no currencyCode", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    mockUseSelector.mockReturnValue(undefined);

    mockUseHits.mockReturnValue({
      hits: [
        {
          objectID: "hit-usd-1",
          ep_name: "Default Currency Product",
          ep_slug: "default-product",
          ep_price: { USD: { float_price: 19.99 } },
        },
      ],
    });

    const { container } = render(
      <EPSearchHits>
        <div>child</div>
      </EPSearchHits>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-currentProduct"]'
    );
    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.price.currencyCode).toBe("USD");
  });
});

/* ================================================================
 * EPRefinementList tests
 * ================================================================ */
describe("EPRefinementList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("should render mock refinement items in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPRefinementList attribute="brand">
        <div data-testid="item">Item</div>
      </EPRefinementList>
    );

    const listItems = container.querySelectorAll('[role="listitem"]');
    expect(listItems.length).toBe(MOCK_REFINEMENT_ITEMS.length);
  });

  it("should expose currentRefinement data in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPRefinementList attribute="brand">
        <div>child</div>
      </EPRefinementList>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-currentRefinement"]'
    );
    expect(providerEl).not.toBeNull();

    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.value).toBeTruthy();
    expect(data.label).toBeTruthy();
    expect(typeof data.count).toBe("number");
    expect(typeof data.isRefined).toBe("boolean");
  });

  it("should expose currentRefinementIndex in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPRefinementList attribute="brand">
        <div>child</div>
      </EPRefinementList>
    );

    const indexProviders = container.querySelectorAll(
      '[data-testid="data-provider-currentRefinementIndex"]'
    );
    expect(indexProviders.length).toBe(MOCK_REFINEMENT_ITEMS.length);
  });
});

/* ================================================================
 * EPHierarchicalMenu tests
 * ================================================================ */
describe("EPHierarchicalMenu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("should render mock category items in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPHierarchicalMenu>
        <div data-testid="item">Category</div>
      </EPHierarchicalMenu>
    );

    const listItems = container.querySelectorAll('[role="listitem"]');
    expect(listItems.length).toBe(MOCK_CATEGORY_ITEMS.length);
  });

  it("should expose currentCategory data with depth info in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPHierarchicalMenu>
        <div>child</div>
      </EPHierarchicalMenu>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-currentCategory"]'
    );
    expect(providerEl).not.toBeNull();

    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.value).toBeTruthy();
    expect(data.label).toBeTruthy();
    expect(typeof data.depth).toBe("number");
    expect(typeof data.hasChildren).toBe("boolean");
  });
});

/* ================================================================
 * EPRangeFilter tests
 * ================================================================ */
describe("EPRangeFilter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("should render mock range data in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPRangeFilter attribute="price.USD.float_price">
        <div>Range UI</div>
      </EPRangeFilter>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-rangeData"]'
    );
    expect(providerEl).not.toBeNull();

    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.min).toBe(0);
    expect(data.max).toBe(500);
    expect(data.currentMin).toBe(25);
    expect(data.currentMax).toBe(250);
    expect(data.canRefine).toBe(true);
  });
});

/* ================================================================
 * EPSearchPagination tests
 * ================================================================ */
describe("EPSearchPagination", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("should render mock pagination data in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPSearchPagination>
        <div>Pagination UI</div>
      </EPSearchPagination>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-searchPaginationData"]'
    );
    expect(providerEl).not.toBeNull();

    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.currentPage).toBe(0);
    expect(data.totalPages).toBe(4);
    expect(data.hasNext).toBe(true);
    expect(data.hasPrev).toBe(false);
    expect(data.pages).toEqual([0, 1, 2, 3]);
  });
});

/* ================================================================
 * EPSearchStats tests
 * ================================================================ */
describe("EPSearchStats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("should render mock stats data in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPSearchStats>
        <div>Stats</div>
      </EPSearchStats>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-searchStatsData"]'
    );
    expect(providerEl).not.toBeNull();

    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.nbHits).toBe(48);
    expect(data.query).toBe("leather");
    expect(data.processingTimeMS).toBe(12);
    expect(data.summary).toContain("48");
  });
});

/* ================================================================
 * EPSearchSortBy tests
 * ================================================================ */
describe("EPSearchSortBy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("should render mock sort data in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPSearchSortBy>
        <div>Sort UI</div>
      </EPSearchSortBy>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-sortByData"]'
    );
    expect(providerEl).not.toBeNull();

    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.currentValue).toBe("relevance");
    expect(data.options.length).toBeGreaterThan(0);
  });
});

/* ================================================================
 * Component registration tests
 * ================================================================ */
describe("component registration", () => {
  it("should export all registration functions", () => {
    expect(typeof registerEPCatalogSearchProvider).toBe("function");
    expect(typeof registerEPSearchBox).toBe("function");
    expect(typeof registerEPSearchHits).toBe("function");
    expect(typeof registerEPRefinementList).toBe("function");
    expect(typeof registerEPHierarchicalMenu).toBe("function");
    expect(typeof registerEPRangeFilter).toBe("function");
    expect(typeof registerEPSearchPagination).toBe("function");
    expect(typeof registerEPSearchStats).toBe("function");
    expect(typeof registerEPSearchSortBy).toBe("function");
  });

  it("EPCatalogSearchProvider meta should have correct name", () => {
    expect(epCatalogSearchProviderMeta.name).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
    expect(epCatalogSearchProviderMeta.providesData).toBe(true);
    expect(epCatalogSearchProviderMeta.importName).toBe(
      "EPCatalogSearchProvider"
    );
  });

  it("EPSearchBox meta should have correct parentComponentName", () => {
    expect(epSearchBoxMeta.name).toBe("plasmic-commerce-ep-search-box");
    expect(epSearchBoxMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
  });

  it("EPSearchHits meta should have correct name and parentComponentName", () => {
    expect(epSearchHitsMeta.name).toBe("plasmic-commerce-ep-search-hits");
    expect(epSearchHitsMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
    expect(epSearchHitsMeta.providesData).toBe(true);
  });

  it("EPRefinementList meta should have correct name and refActions", () => {
    expect(epRefinementListMeta.name).toBe(
      "plasmic-commerce-ep-refinement-list"
    );
    expect(epRefinementListMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
    expect(epRefinementListMeta.providesData).toBe(true);
    expect(epRefinementListMeta.refActions!.toggleRefinement).toBeDefined();
  });

  it("EPHierarchicalMenu meta should have correct name and refActions", () => {
    expect(epHierarchicalMenuMeta.name).toBe(
      "plasmic-commerce-ep-hierarchical-menu"
    );
    expect(epHierarchicalMenuMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
    expect(epHierarchicalMenuMeta.refActions!.refineCategory).toBeDefined();
  });

  it("EPRangeFilter meta should have correct name and refActions", () => {
    expect(epRangeFilterMeta.name).toBe("plasmic-commerce-ep-range-filter");
    expect(epRangeFilterMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
    expect(epRangeFilterMeta.refActions!.setRange).toBeDefined();
  });

  it("EPSearchPagination meta should have correct name and refActions", () => {
    expect(epSearchPaginationMeta.name).toBe(
      "plasmic-commerce-ep-search-pagination"
    );
    expect(epSearchPaginationMeta.refActions!.goToPage).toBeDefined();
    expect(epSearchPaginationMeta.refActions!.nextPage).toBeDefined();
    expect(epSearchPaginationMeta.refActions!.prevPage).toBeDefined();
  });

  it("EPSearchPagination default slot ships hbox of [button, text, button]", () => {
    const slot = (epSearchPaginationMeta.props as any).children;
    expect(slot.type).toBe("slot");
    const defaultValue = Array.isArray(slot.defaultValue)
      ? slot.defaultValue[0]
      : slot.defaultValue;
    expect(defaultValue.type).toBe("hbox");
    const kids = defaultValue.children as any[];
    expect(kids).toHaveLength(3);
    expect(kids[0].type).toBe("button");
    expect(kids[1].type).toBe("text");
    expect(kids[2].type).toBe("button");
  });

  it("EPSearchStats meta should have correct name", () => {
    expect(epSearchStatsMeta.name).toBe("plasmic-commerce-ep-search-stats");
    expect(epSearchStatsMeta.providesData).toBe(true);
  });

  it("EPSearchSortBy meta should have correct name and refActions", () => {
    expect(epSearchSortByMeta.name).toBe(
      "plasmic-commerce-ep-search-sort-by"
    );
    expect(epSearchSortByMeta.refActions!.setSort).toBeDefined();
  });
});

/* ================================================================
 * Headless styling contract — applied to every catalog-search component.
 * ================================================================ */

describeHeadlessStylingContract({
  componentName: "EPCatalogSearchProvider",
  leafSelector: "[data-ep-catalog-search-provider]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPCatalogSearchProvider className={className}>
      <div>child</div>
    </EPCatalogSearchProvider>
  ),
  renderAtRuntime: ({ className }) => {
    setupCommerce();
    return (
      <EPCatalogSearchProvider className={className}>
        <div>child</div>
      </EPCatalogSearchProvider>
    );
  },
});

describeHeadlessStylingContract({
  componentName: "EPSearchHits",
  leafSelector: "[data-ep-search-hits]",
  setEditorMode,
  // gridStyle is the documented layout-property workaround for Plasmic's
  // className-strip on display/grid CSS (see EPSearchHits.tsx). The contract
  // already permits inline layout properties; appearance properties are
  // checked. No allow-list entry is needed because nothing in the allow-list
  // list (border, font, color, background) is set inline by EPSearchHits.
  renderInEditor: ({ className }) => (
    <EPSearchHits className={className}>
      <div>card</div>
    </EPSearchHits>
  ),
  renderAtRuntime: ({ className }) => {
    mockUseHits.mockReturnValue({
      hits: [
        {
          objectID: "ep-test-hit-1",
          ep_name: "Test Product",
          ep_slug: "test-product",
          ep_price: { USD: { float_price: 9.99 } },
        },
      ],
    });
    return (
      <EPSearchHits className={className}>
        <div>card</div>
      </EPSearchHits>
    );
  },
});

describeHeadlessStylingContract({
  componentName: "EPRefinementList",
  leafSelector: "[data-ep-refinement-list]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPRefinementList attribute="brand" className={className}>
      <div>row</div>
    </EPRefinementList>
  ),
  renderAtRuntime: ({ className }) => {
    mockUseRefinementList.mockReturnValue({
      items: [
        { value: "acme", label: "Acme", count: 3, isRefined: false },
      ],
      refine: jest.fn(),
    });
    return (
      <EPRefinementList attribute="brand" className={className}>
        <div>row</div>
      </EPRefinementList>
    );
  },
});

describeHeadlessStylingContract({
  componentName: "EPHierarchicalMenu",
  leafSelector: "[data-ep-hierarchical-menu]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPHierarchicalMenu className={className}>
      <div>row</div>
    </EPHierarchicalMenu>
  ),
  renderAtRuntime: ({ className }) => {
    mockUseHierarchicalMenu.mockReturnValue({
      items: [
        {
          value: "boots",
          label: "Boots",
          count: 5,
          isRefined: false,
          data: [],
        },
      ],
      refine: jest.fn(),
    });
    return (
      <EPHierarchicalMenu className={className}>
        <div>row</div>
      </EPHierarchicalMenu>
    );
  },
});

describeHeadlessStylingContract({
  componentName: "EPRangeFilter",
  leafSelector: "[data-ep-range-filter]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPRangeFilter attribute="price.USD.float_price" className={className}>
      <div>range</div>
    </EPRangeFilter>
  ),
  renderAtRuntime: ({ className }) => (
    <EPRangeFilter attribute="price.USD.float_price" className={className}>
      <div>range</div>
    </EPRangeFilter>
  ),
});

describeHeadlessStylingContract({
  componentName: "EPSearchPagination",
  leafSelector: "[data-ep-search-pagination]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPSearchPagination className={className}>
      <div>page</div>
    </EPSearchPagination>
  ),
  renderAtRuntime: ({ className }) => (
    <EPSearchPagination className={className}>
      <div>page</div>
    </EPSearchPagination>
  ),
});

describeHeadlessStylingContract({
  componentName: "EPSearchStats",
  leafSelector: "[data-ep-search-stats]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPSearchStats className={className}>
      <div>stats</div>
    </EPSearchStats>
  ),
  renderAtRuntime: ({ className }) => (
    <EPSearchStats className={className}>
      <div>stats</div>
    </EPSearchStats>
  ),
});

describeHeadlessStylingContract({
  componentName: "EPSearchSortBy",
  leafSelector: "[data-ep-search-sort-by]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPSearchSortBy className={className}>
      <div>sort</div>
    </EPSearchSortBy>
  ),
  renderAtRuntime: ({ className }) => (
    <EPSearchSortBy className={className}>
      <div>sort</div>
    </EPSearchSortBy>
  ),
});
