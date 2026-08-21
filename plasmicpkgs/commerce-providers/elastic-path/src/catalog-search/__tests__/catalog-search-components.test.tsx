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

const mockUseMenu = jest.fn().mockReturnValue({
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

const mockUseClearRefinements = jest.fn().mockReturnValue({
  refine: jest.fn(),
  canRefine: true,
  hasRefinements: true,
  createURL: jest.fn(),
});

const mockUseCurrentRefinements = jest.fn().mockReturnValue({
  items: [],
  canRefine: false,
  refine: jest.fn(),
  createURL: jest.fn(),
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

jest.mock("../../shopper-context/EpCommerceContext", () => ({
  useEpCommerce: (...a: unknown[]) => mockUseCommerce(...a),
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
  useMenu: (...a: unknown[]) => mockUseMenu(...a),
  useHierarchicalMenu: (...a: unknown[]) => mockUseHierarchicalMenu(...a),
  useRange: (...a: unknown[]) => mockUseRange(...a),
  usePagination: (...a: unknown[]) => mockUsePagination(...a),
  useStats: (...a: unknown[]) => mockUseStats(...a),
  useSortBy: (...a: unknown[]) => mockUseSortBy(...a),
  useClearRefinements: (...a: unknown[]) => mockUseClearRefinements(...a),
  useCurrentRefinements: (...a: unknown[]) => mockUseCurrentRefinements(...a),
  InstantSearch: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="instantsearch">{children}</div>
  ),
  // Render props so tests can assert what the provider configures
  // (hitsPerPage, the base `filters`, …).
  Configure: (props: Record<string, unknown>) => (
    <div data-testid="configure" data-configure={JSON.stringify(props)} />
  ),
}));

jest.mock("@elasticpath/catalog-search-instantsearch-adapter", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    searchClient: { search: jest.fn(), searchForFacetValues: jest.fn() },
  })),
}));

/* ---------- code under test (after mocks) ---------- */
import { fireEvent, render } from "@testing-library/react";
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

const {
  EPClearRefinements,
  epClearRefinementsMeta,
  registerEPClearRefinements,
} = require("../EPClearRefinements") as typeof import("../EPClearRefinements");

const {
  EPCurrentRefinements,
  epCurrentRefinementsMeta,
  registerEPCurrentRefinements,
} = require("../EPCurrentRefinements") as typeof import("../EPCurrentRefinements");

const {
  EPSearchEmpty,
  epSearchEmptyMeta,
  registerEPSearchEmpty,
} = require("../EPSearchEmpty") as typeof import("../EPSearchEmpty");

/* ---------- helpers ---------- */
const mockClient = { baseUrl: "https://api.test.com" };
const mockProvider = { locale: "en-US", client: mockClient };

function setupCommerce() {
  mockUseCommerce.mockReturnValue(mockProvider);
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
      expect(product.attributes?.name).toBeTruthy();
      expect(product.attributes?.slug).toBeTruthy();
      expect(
        typeof product.meta?.display_price?.without_tax?.float_price
      ).toBe("number");
      expect(product.meta?.display_price?.without_tax?.currency).toBe("USD");
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

  function getConfigureProps(container: HTMLElement) {
    const el = container.querySelector('[data-testid="configure"]');
    expect(el).not.toBeNull();
    return JSON.parse(el!.getAttribute("data-configure") || "{}");
  }

  it("passes baseFilter to Configure as `filters` at runtime", () => {
    // `filters` rides through the adapter's _adaptFilters, which always joins
    // it with facet refinements — adapter-level filter_by would be dropped as
    // soon as a facet is refined.
    const { container } = render(
      <EPCatalogSearchProvider baseFilter="meta.product_types:!=child">
        <div>children</div>
      </EPCatalogSearchProvider>
    );

    const props = getConfigureProps(container);
    expect(props.filters).toBe("meta.product_types:!=child");
    expect(props.hitsPerPage).toBe(12);
  });

  it("omits `filters` from Configure when baseFilter is empty", () => {
    const { container } = render(
      <EPCatalogSearchProvider>
        <div>children</div>
      </EPCatalogSearchProvider>
    );

    const props = getConfigureProps(container);
    expect(props).not.toHaveProperty("filters");
  });

  it("forwards highlightFullFields to the adapter's search parameters", () => {
    const AdapterMock = (
      require("@elasticpath/catalog-search-instantsearch-adapter") as {
        default: jest.Mock;
      }
    ).default;

    render(
      <EPCatalogSearchProvider highlightFullFields="name,description">
        <div>children</div>
      </EPCatalogSearchProvider>
    );

    expect(AdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalSearchParameters: expect.objectContaining({
          highlight_full_fields: "name,description",
        }),
      })
    );
  });

  it("does not send highlight_full_fields when unset", () => {
    const AdapterMock = (
      require("@elasticpath/catalog-search-instantsearch-adapter") as {
        default: jest.Mock;
      }
    ).default;

    render(
      <EPCatalogSearchProvider>
        <div>children</div>
      </EPCatalogSearchProvider>
    );

    const args = AdapterMock.mock.calls[0][0];
    expect(args.additionalSearchParameters).not.toHaveProperty(
      "highlight_full_fields"
    );
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
    expect(data.attributes.name).toContain("Sample");
    expect(data.meta.display_price.without_tax.formatted).toBeTruthy();
    expect(data.meta.display_price.without_tax.currency).toBe("USD");
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
    expect(data.meta.display_price.without_tax.currency).toBe("GBP");
    expect(data.meta.display_price.without_tax.float_price).toBe(29.99);
    expect(data.attributes.name).toBe("British Product");
  });

  /** Render one EP catalog-search shaped hit and return the normalized currentProduct. */
  function renderHitAndGetCurrentProduct(
    hit: Record<string, unknown>,
    props: { productPathPrefix?: string } = {}
  ) {
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    mockUseSelector.mockReturnValue(undefined);
    mockUseHits.mockReturnValue({ hits: [hit] });

    const { container } = render(
      <EPSearchHits {...props}>
        <div>child</div>
      </EPSearchHits>
    );
    const providerEl = container.querySelector(
      '[data-testid="data-provider-currentProduct"]'
    );
    expect(providerEl).not.toBeNull();
    return JSON.parse(providerEl!.getAttribute("data-provider-data") || "{}");
  }

  /** Same render, returning the search-side facts published as `currentHit`. */
  function renderHitAndGetSearchMeta(
    hit: Record<string, unknown>,
    props: { productPathPrefix?: string } = {}
  ) {
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    mockUseSelector.mockReturnValue(undefined);
    mockUseHits.mockReturnValue({ hits: [hit] });

    const { container } = render(
      <EPSearchHits {...props}>
        <div>child</div>
      </EPSearchHits>
    );
    const providerEl = container.querySelector(
      '[data-testid="data-provider-currentHit"]'
    );
    expect(providerEl).not.toBeNull();
    return JSON.parse(providerEl!.getAttribute("data-provider-data") || "{}");
  }

  // The adapter spreads the EP search document onto the hit, so attributes
  // (incl. extensions) live under hit.attributes.
  const EP_HIT = {
    objectID: "ep-hit-1",
    attributes: {
      name: "Sample Product",
      slug: "sample-product",
      sku: "sample-sku-001",
      description: "A sample product description for testing.",
      extensions: {
        "products(specs)": {
          reference: "SP-001",
          product_kind: "standard",
          lifecycle_status: "Published",
        },
      },
    },
  };

  it("carries template extensions where the product page reads them", () => {
    const data = renderHitAndGetCurrentProduct(EP_HIT);

    expect(
      data.attributes.extensions["products(specs)"].lifecycle_status
    ).toBe("Published");
    expect(
      data.attributes.extensions["products(specs)"].product_kind
    ).toBe("standard");
  });

  it("builds path from productPathPrefix (trailing slash tolerated)", () => {
    const withPrefix = renderHitAndGetSearchMeta(EP_HIT, {
      productPathPrefix: "/products/",
    });
    expect(withPrefix.path).toBe("/products/sample-product");

    const withDefault = renderHitAndGetSearchMeta(EP_HIT);
    expect(withDefault.path).toBe("/product/sample-product");
  });

  it("recovers bare-keyed EP highlights from the raw Typesense hit", () => {
    // EP keys highlights by the bare query_by names while the document nests
    // fields under attributes — the adapter's document-driven walk drops
    // them, so the normalizer reads _rawTypesenseHit.highlight directly.
    const data = renderHitAndGetSearchMeta({
      ...EP_HIT,
      _highlightResult: {
        attributes: {
          name: { value: "Sample Product", matchLevel: "none" },
        },
      },
      _rawTypesenseHit: {
        highlight: {
          name: { value: "Sample <mark>Product</mark>" },
          description: {
            snippet: "a <mark>sample</mark> description",
          },
        },
      },
    });

    expect(data.highlightedName).toBe("Sample <mark>Product</mark>");
    expect(data.snippetedDescription).toBe(
      "a <mark>sample</mark> description"
    );
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
    expect(data.meta.display_price.without_tax.currency).toBe("USD");
  });
});

/* ================================================================
 * EPRefinementList tests
 * ================================================================ */
describe("EPRefinementList — empty slot", () => {
  // The registered slot default was the literal text "Filter Value" and "(0)",
  // so a designer dropping the facet in saw the same fake row for every value.
  // The component deliberately pre-renders nothing interactive (the click is
  // wired via $ctx.currentRefinement.toggle()), so the default is text only.
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    mockUseRefinementList.mockReturnValue({
      items: [
        { value: "leather", label: "Leather", count: 12, isRefined: false },
        { value: "suede", label: "Suede", count: 8, isRefined: true },
      ],
      refine: jest.fn(),
    });
  });

  it("renders each value's real label", () => {
    const { container } = render(<EPRefinementList attribute="material" />);

    const labels = Array.from(
      container.querySelectorAll("[data-ep-refinement-label]")
    ).map((n) => n.textContent);
    expect(labels).toEqual(["Leather", "Suede"]);
  });

  it("shows each value's real count, not (0)", () => {
    const { container } = render(<EPRefinementList attribute="material" />);

    const counts = Array.from(
      container.querySelectorAll("[data-ep-refinement-count]")
    ).map((n) => n.textContent);
    expect(counts).toEqual(["12", "8"]);
  });

  it("marks which value is refined", () => {
    const { container } = render(<EPRefinementList attribute="material" />);

    const refined = container.querySelectorAll("[data-ep-refinement][data-refined]");
    expect(refined).toHaveLength(1);
    expect(refined[0].textContent).toContain("Suede");
  });

  it("pre-renders nothing interactive — the click is the designer's to wire", () => {
    // Both this component and EPHierarchicalMenu expose `toggle` on the item
    // data specifically so they do NOT have to pre-render a button or <a>.
    // The default honours that: real values, no affordance invented for them.
    const refine = jest.fn();
    mockUseRefinementList.mockReturnValue({
      items: [{ value: "leather", label: "Leather", count: 12, isRefined: false }],
      refine,
    });

    const { container } = render(<EPRefinementList attribute="material" />);

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[role=button]")).toBeNull();
    expect(container.querySelector("[role=checkbox]")).toBeNull();

    fireEvent.click(container.querySelector("[data-ep-refinement]")!);
    expect(refine).not.toHaveBeenCalled();
  });

  it("still exposes toggle on the item data for that wiring", () => {
    const refine = jest.fn();
    mockUseRefinementList.mockReturnValue({
      items: [{ value: "leather", label: "Leather", count: 12, isRefined: false }],
      refine,
    });

    const { container } = render(
      <EPRefinementList attribute="material">
        <span>x</span>
      </EPRefinementList>
    );

    const dp = container.querySelector(
      '[data-testid="data-provider-currentRefinement"]'
    );
    expect(dp).toBeTruthy();
  });

  it("leaves the slot content alone when there is any", () => {
    const { container } = render(
      <EPRefinementList attribute="material">
        <span data-testid="mine">mine</span>
      </EPRefinementList>
    );

    expect(container.querySelectorAll("[data-ep-refinement]")).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="mine"]')).toHaveLength(2);
  });

  it("does the same in single-select mode", () => {
    // singleSelect swaps in InstantSearch's menu widget — a separate render
    // path, so it needs the default too or radio-style facets stay blank.
    mockUseMenu.mockReturnValue({
      items: [
        { value: "leather", label: "Leather", count: 12, isRefined: true },
      ],
      refine: jest.fn(),
    });

    const { container } = render(
      <EPRefinementList attribute="material" singleSelect />
    );

    expect(
      container.querySelector("[data-ep-refinement-label]")?.textContent
    ).toBe("Leather");
    expect(
      container.querySelector("[data-ep-refinement-count]")?.textContent
    ).toBe("12");
    expect(container.querySelector("[data-ep-refinement][data-refined]")).toBeTruthy();
  });

  it("shows the default on the Studio canvas too", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(<EPRefinementList attribute="material" />);

    const labels = Array.from(
      container.querySelectorAll("[data-ep-refinement-label]")
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0].textContent).not.toBe("Filter Value");
  });
});

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

  it("uses useMenu (replace semantics) when singleSelect — radio-style facets", () => {
    mockUseMenu.mockReturnValue({
      items: [
        { value: "type-a", label: "type-a", count: 39, isRefined: true },
        { value: "type-b", label: "type-b", count: 1, isRefined: false },
      ],
      refine: jest.fn(),
    });

    const { container } = render(
      <EPRefinementList
        attribute="extensions.products(specs).product_kind"
        singleSelect
      >
        <div>child</div>
      </EPRefinementList>
    );

    expect(mockUseMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        attribute: "extensions.products(specs).product_kind",
      })
    );
    expect(mockUseRefinementList).not.toHaveBeenCalled();

    // Same per-item shape as the multi-select path
    const providerEl = container.querySelector(
      '[data-testid="data-provider-currentRefinement"]'
    );
    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.value).toBe("type-a");
    expect(data.count).toBe(39);
    expect(data.isRefined).toBe(true);

    expect(
      container.querySelector("[data-single-select]")
    ).not.toBeNull();
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
describe("EPHierarchicalMenu — empty slot", () => {
  // Same defect and same constraint as EPRefinementList: the registered default
  // was the literal text "Category" and "(0)", and the component deliberately
  // pre-renders nothing interactive (the click is wired via
  // $ctx.currentCategory.refine()).
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    mockUseHierarchicalMenu.mockReturnValue({
      items: [
        {
          value: "shoes",
          label: "Shoes",
          count: 24,
          isRefined: true,
          data: [
            { value: "shoes > sandals", label: "Sandals", count: 6, isRefined: false, data: null },
          ],
        },
      ],
      refine: jest.fn(),
    });
  });

  it("renders each category's real label and count", () => {
    const { container } = render(<EPHierarchicalMenu attributes="categories" />);

    const labels = Array.from(
      container.querySelectorAll("[data-ep-category-label]")
    ).map((n) => n.textContent);
    expect(labels).toEqual(["Shoes", "Sandals"]);

    const counts = Array.from(
      container.querySelectorAll("[data-ep-category-count]")
    ).map((n) => n.textContent);
    expect(counts).toEqual(["24", "6"]);
  });

  it("carries the nesting depth so a design can indent", () => {
    const { container } = render(<EPHierarchicalMenu attributes="categories" />);

    const depths = Array.from(
      container.querySelectorAll("[data-ep-category]")
    ).map((n) => n.getAttribute("data-depth"));
    expect(depths).toEqual(["0", "1"]);
  });

  it("marks the refined category", () => {
    const { container } = render(<EPHierarchicalMenu attributes="categories" />);

    const refined = container.querySelectorAll("[data-ep-category][data-refined]");
    expect(refined).toHaveLength(1);
    expect(refined[0].textContent).toContain("Shoes");
  });

  it("pre-renders nothing interactive", () => {
    const refine = jest.fn();
    mockUseHierarchicalMenu.mockReturnValue({
      items: [{ value: "shoes", label: "Shoes", count: 24, isRefined: false, data: null }],
      refine,
    });

    const { container } = render(<EPHierarchicalMenu attributes="categories" />);

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[role=button]")).toBeNull();

    fireEvent.click(container.querySelector("[data-ep-category]")!);
    expect(refine).not.toHaveBeenCalled();
  });

  it("leaves the slot content alone when there is any", () => {
    const { container } = render(
      <EPHierarchicalMenu attributes="categories">
        <span data-testid="mine">mine</span>
      </EPHierarchicalMenu>
    );

    expect(container.querySelectorAll("[data-ep-category]")).toHaveLength(0);
  });
});

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
 * EPClearRefinements tests
 * ================================================================ */
describe("EPClearRefinements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("publishes clearRefinementsData and triggers refine() on default child click", () => {
    const refine = jest.fn();
    mockUseClearRefinements.mockReturnValue({
      refine,
      canRefine: true,
      hasRefinements: true,
      createURL: jest.fn(),
    });

    const { container, getByText } = render(
      <EPClearRefinements>
        <button>Clear all</button>
      </EPClearRefinements>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-clearRefinementsData"]'
    );
    expect(provider).not.toBeNull();
    const data = JSON.parse(
      provider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.canRefine).toBe(true);

    require("react-dom/test-utils").act(() => {
      getByText("Clear all").click();
    });
    expect(refine).toHaveBeenCalledTimes(1);
  });

  it("renders null when no refinements are active (canRefine=false)", () => {
    mockUseClearRefinements.mockReturnValue({
      refine: jest.fn(),
      canRefine: false,
      hasRefinements: false,
      createURL: jest.fn(),
    });

    const { container } = render(
      <EPClearRefinements>
        <button>Clear all</button>
      </EPClearRefinements>
    );

    expect(container.querySelector("[data-ep-clear-refinements]")).toBeNull();
  });

  it("composes designer-supplied onClick before the injected one (via bubble)", () => {
    const calls: string[] = [];
    const refine = jest.fn(() => calls.push("refine"));
    mockUseClearRefinements.mockReturnValue({
      refine,
      canRefine: true,
      hasRefinements: true,
      createURL: jest.fn(),
    });

    const designerClick = () => calls.push("designer");

    const { getByText } = render(
      <EPClearRefinements>
        <button onClick={designerClick}>Reset</button>
      </EPClearRefinements>
    );

    require("react-dom/test-utils").act(() => {
      getByText("Reset").click();
    });
    expect(calls).toEqual(["designer", "refine"]);
  });

  it("fail-open: multi-element children render unchanged but ctx is still published", () => {
    mockUseClearRefinements.mockReturnValue({
      refine: jest.fn(),
      canRefine: true,
      hasRefinements: true,
      createURL: jest.fn(),
    });

    const { container } = render(
      <EPClearRefinements>
        <span>a</span>
        <span>b</span>
      </EPClearRefinements>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-clearRefinementsData"]'
    );
    expect(provider).not.toBeNull();
    expect(container.textContent).toContain("a");
    expect(container.textContent).toContain("b");
  });

  it("renders mock data in editor without invoking the hook", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    const refine = jest.fn();
    mockUseClearRefinements.mockReturnValue({
      refine,
      canRefine: true,
      hasRefinements: true,
      createURL: jest.fn(),
    });

    const { container } = render(
      <EPClearRefinements>
        <button>Clear all</button>
      </EPClearRefinements>
    );

    const provider = container.querySelector(
      '[data-testid="data-provider-clearRefinementsData"]'
    );
    expect(provider).not.toBeNull();
    expect(mockUseClearRefinements).not.toHaveBeenCalled();
  });

  it("clear() ref-action triggers refine for non-child elements", () => {
    const refine = jest.fn();
    mockUseClearRefinements.mockReturnValue({
      refine,
      canRefine: true,
      hasRefinements: true,
      createURL: jest.fn(),
    });

    const ref = React.createRef<{ clear: () => void }>();
    render(
      <EPClearRefinements ref={ref}>
        <button>Clear all</button>
      </EPClearRefinements>
    );

    require("react-dom/test-utils").act(() => {
      ref.current!.clear();
    });
    expect(refine).toHaveBeenCalledTimes(1);
  });
});

/* ================================================================
 * EPCurrentRefinements tests
 * ================================================================ */
describe("EPCurrentRefinements — empty slot", () => {
  // The default was a nicely shaped chip with the hardcoded text
  // "Brand: Leather" — the affordance was right, the content was fiction.
  // Unlike the facet lists, the row already carries onClick={chip.refine}, so
  // the chip is interactive by design and the "×" means something.
  const refineOne = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    mockUseCurrentRefinements.mockReturnValue({
      items: [
        {
          attribute: "material",
          label: "Material",
          refinements: [
            { attribute: "material", type: "disjunctive", value: "leather", label: "Leather" },
          ],
          refine: refineOne,
        },
      ],
      canRefine: true,
      refine: jest.fn(),
      createURL: jest.fn(),
    });
  });

  it("names the refinement actually applied", () => {
    const { container } = render(<EPCurrentRefinements />);

    const chip = container.querySelector("[data-ep-refinement-chip]");
    expect(chip?.textContent).toContain("Material");
    expect(chip?.textContent).toContain("Leather");
    expect(chip?.textContent).not.toContain("Brand");
  });

  it("offers a way to remove it", () => {
    const { container } = render(<EPCurrentRefinements />);

    expect(
      container.querySelector("[data-ep-refinement-chip-remove]")
    ).toBeTruthy();
  });

  it("removes that refinement when clicked", () => {
    const { container } = render(<EPCurrentRefinements />);

    fireEvent.click(container.querySelector("[data-ep-refinement-chip]")!);

    expect(refineOne).toHaveBeenCalledTimes(1);
  });

  it("leaves the slot content alone when there is any", () => {
    const { container } = render(
      <EPCurrentRefinements>
        <span data-testid="mine">mine</span>
      </EPCurrentRefinements>
    );

    expect(container.querySelectorAll("[data-ep-refinement-chip]")).toHaveLength(0);
  });

  // Studio materialises a slot's defaultValue on insert, so any default at all
  // makes `children` truthy on a fresh instance and the chip above is dead code.
  it("ships no slot default, so a fresh instance reaches the chip", () => {
    const slot = (epCurrentRefinementsMeta.props as any).children;

    expect(slot.defaultValue).toBeUndefined();
    expect(slot.hidePlaceholder).toBe(true);
  });
});

describe("EPCurrentRefinements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("returns null when no refinements are active", () => {
    mockUseCurrentRefinements.mockReturnValue({
      items: [],
      canRefine: false,
      refine: jest.fn(),
      createURL: jest.fn(),
    });

    const { container } = render(
      <EPCurrentRefinements>
        <div>chip</div>
      </EPCurrentRefinements>
    );

    expect(
      container.querySelector("[data-ep-current-refinements]")
    ).toBeNull();
  });

  it("flattens items into one chip per refinement and publishes per-iteration ctx", () => {
    const refine = jest.fn();
    mockUseCurrentRefinements.mockReturnValue({
      items: [
        {
          attribute: "brand",
          label: "Brand",
          refinements: [
            { attribute: "brand", type: "facet", value: "leather", label: "Leather" },
            { attribute: "brand", type: "facet", value: "canvas", label: "Canvas" },
          ],
          refine,
        },
        {
          attribute: "price.USD.float_price",
          label: "Price",
          refinements: [
            {
              attribute: "price.USD.float_price",
              type: "numeric",
              value: 25,
              label: "25",
              operator: ">=",
            },
          ],
          refine,
        },
      ],
      canRefine: true,
      refine,
      createURL: jest.fn(),
    });

    const { container } = render(
      <EPCurrentRefinements>
        <div>chip</div>
      </EPCurrentRefinements>
    );

    const items = container.querySelectorAll('[role="listitem"]');
    expect(items).toHaveLength(3);

    const chipProviders = container.querySelectorAll(
      '[data-testid="data-provider-currentRefinementChip"]'
    );
    expect(chipProviders).toHaveLength(3);
    const first = JSON.parse(
      chipProviders[0].getAttribute("data-provider-data") || "{}"
    );
    expect(first.attribute).toBe("brand");
    expect(first.attributeLabel).toBe("Brand");
    expect(first.type).toBe("facet");
    expect(first.value).toBe("leather");
    expect(first.label).toBe("Leather");

    const numeric = JSON.parse(
      chipProviders[2].getAttribute("data-provider-data") || "{}"
    );
    expect(numeric.type).toBe("numeric");
    expect(numeric.operator).toBe(">=");
    expect(numeric.value).toBe(25);
  });

  it("clicking a chip triggers refine bound to that specific refinement", () => {
    const refineBrand = jest.fn();
    const refinePrice = jest.fn();
    mockUseCurrentRefinements.mockReturnValue({
      items: [
        {
          attribute: "brand",
          label: "Brand",
          refinements: [
            { attribute: "brand", type: "facet", value: "leather", label: "Leather" },
          ],
          refine: refineBrand,
        },
        {
          attribute: "price.USD.float_price",
          label: "Price",
          refinements: [
            {
              attribute: "price.USD.float_price",
              type: "numeric",
              value: 25,
              label: "25",
              operator: ">=",
            },
          ],
          refine: refinePrice,
        },
      ],
      canRefine: true,
      refine: jest.fn(),
      createURL: jest.fn(),
    });

    const { container } = render(
      <EPCurrentRefinements>
        <button>×</button>
      </EPCurrentRefinements>
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);

    require("react-dom/test-utils").act(() => {
      (buttons[1] as HTMLButtonElement).click();
    });

    expect(refineBrand).not.toHaveBeenCalled();
    expect(refinePrice).toHaveBeenCalledTimes(1);
    const arg = refinePrice.mock.calls[0][0];
    expect(arg.attribute).toBe("price.USD.float_price");
    expect(arg.value).toBe(25);
  });

  it("composes designer-supplied onClick before injected refine", () => {
    const calls: string[] = [];
    const refine = jest.fn(() => calls.push("refine"));
    mockUseCurrentRefinements.mockReturnValue({
      items: [
        {
          attribute: "brand",
          label: "Brand",
          refinements: [
            { attribute: "brand", type: "facet", value: "leather", label: "Leather" },
          ],
          refine,
        },
      ],
      canRefine: true,
      refine,
      createURL: jest.fn(),
    });

    const designerClick = () => calls.push("designer");

    const { container } = render(
      <EPCurrentRefinements>
        <button onClick={designerClick}>×</button>
      </EPCurrentRefinements>
    );

    require("react-dom/test-utils").act(() => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });
    expect(calls).toEqual(["designer", "refine"]);
  });

  it("renders mock chips in editor without invoking the hook", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    const { container } = render(
      <EPCurrentRefinements>
        <div>chip</div>
      </EPCurrentRefinements>
    );

    const items = container.querySelectorAll('[role="listitem"]');
    expect(items.length).toBeGreaterThan(0);
    expect(mockUseCurrentRefinements).not.toHaveBeenCalled();
  });

  it("fail-open: multi-element repeated child renders without crashing, ctx still published", () => {
    mockUseCurrentRefinements.mockReturnValue({
      items: [
        {
          attribute: "brand",
          label: "Brand",
          refinements: [
            { attribute: "brand", type: "facet", value: "leather", label: "Leather" },
          ],
          refine: jest.fn(),
        },
      ],
      canRefine: true,
      refine: jest.fn(),
      createURL: jest.fn(),
    });

    const { container } = render(
      <EPCurrentRefinements>
        <span>a</span>
        <span>b</span>
      </EPCurrentRefinements>
    );

    const chipProviders = container.querySelectorAll(
      '[data-testid="data-provider-currentRefinementChip"]'
    );
    expect(chipProviders).toHaveLength(1);
    expect(container.textContent).toContain("a");
    expect(container.textContent).toContain("b");
  });
});

/* ================================================================
 * EPSearchEmpty — no-results state
 * ================================================================ */
describe("EPSearchEmpty", () => {
  it("meta enforces parentComponentName, name, importName", () => {
    expect(epSearchEmptyMeta.name).toBe("plasmic-commerce-ep-search-empty");
    expect(epSearchEmptyMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
    expect(epSearchEmptyMeta.importName).toBe("EPSearchEmpty");
  });

  it("runtime renders nothing when results === null (initial / pre-response)", () => {
    setEditorMode(false);
    mockUseInstantSearch.mockReturnValue({ results: null });

    const { container } = render(
      <EPSearchEmpty>
        <div data-testid="empty-content">empty</div>
      </EPSearchEmpty>
    );

    expect(
      container.querySelector('[data-testid="empty-content"]')
    ).toBeNull();
    expect(container.querySelector("[data-ep-search-empty]")).toBeNull();
  });

  it("runtime renders nothing when results.nbHits > 0", () => {
    setEditorMode(false);
    mockUseInstantSearch.mockReturnValue({ results: { nbHits: 5 } });

    const { container } = render(
      <EPSearchEmpty>
        <div data-testid="empty-content">empty</div>
      </EPSearchEmpty>
    );

    expect(
      container.querySelector('[data-testid="empty-content"]')
    ).toBeNull();
  });

  it("runtime renders the wrapper + slot when results !== null && nbHits === 0", () => {
    setEditorMode(false);
    mockUseInstantSearch.mockReturnValue({ results: { nbHits: 0 } });

    const { container } = render(
      <EPSearchEmpty>
        <div data-testid="empty-content">empty</div>
      </EPSearchEmpty>
    );

    expect(
      container.querySelector('[data-testid="empty-content"]')
    ).not.toBeNull();
    expect(container.querySelector("[data-ep-search-empty]")).not.toBeNull();
  });

  it("wrapper carries role='status' for assistive-tech announcement", () => {
    setEditorMode(false);
    mockUseInstantSearch.mockReturnValue({ results: { nbHits: 0 } });

    const { container } = render(
      <EPSearchEmpty>
        <div>empty</div>
      </EPSearchEmpty>
    );

    const wrapper = container.querySelector("[data-ep-search-empty]");
    expect(wrapper?.getAttribute("role")).toBe("status");
  });

  it("editor mode renders the slot unconditionally (auto + inEditor)", () => {
    setEditorMode(true);
    // Even with results === null, the editor branch should render so
    // designers see their layout.
    mockUseInstantSearch.mockReturnValue({ results: null });

    const { container } = render(
      <EPSearchEmpty>
        <div data-testid="empty-content">empty</div>
      </EPSearchEmpty>
    );

    expect(
      container.querySelector('[data-testid="empty-content"]')
    ).not.toBeNull();
    expect(container.querySelector("[data-ep-search-empty]")).not.toBeNull();
  });

  it("editor branch does not call useInstantSearch (Mock + Inner split keeps the hook out of canvas)", () => {
    setEditorMode(true);
    mockUseInstantSearch.mockClear();

    render(
      <EPSearchEmpty>
        <div>empty</div>
      </EPSearchEmpty>
    );

    expect(mockUseInstantSearch).not.toHaveBeenCalled();
  });

  it("previewState='withData' forces the wrapper to render at runtime regardless of result count", () => {
    setEditorMode(false);
    mockUseInstantSearch.mockReturnValue({ results: { nbHits: 12 } });

    const { container } = render(
      <EPSearchEmpty previewState="withData">
        <div data-testid="empty-content">empty</div>
      </EPSearchEmpty>
    );

    expect(
      container.querySelector('[data-testid="empty-content"]')
    ).not.toBeNull();
    expect(container.querySelector("[data-ep-search-empty]")).not.toBeNull();
  });

  it("results flipping from non-zero to zero mounts Empty (regression: live filtering into nothing)", () => {
    setEditorMode(false);
    mockUseInstantSearch.mockReturnValue({ results: { nbHits: 5 } });

    const { container, rerender } = render(
      <EPSearchEmpty>
        <div data-testid="empty-content">empty</div>
      </EPSearchEmpty>
    );

    expect(
      container.querySelector('[data-testid="empty-content"]')
    ).toBeNull();

    mockUseInstantSearch.mockReturnValue({ results: { nbHits: 0 } });
    rerender(
      <EPSearchEmpty>
        <div data-testid="empty-content">empty</div>
      </EPSearchEmpty>
    );

    expect(
      container.querySelector('[data-testid="empty-content"]')
    ).not.toBeNull();
  });

  it("results flipping from zero to non-zero unmounts Empty cleanly", () => {
    setEditorMode(false);
    mockUseInstantSearch.mockReturnValue({ results: { nbHits: 0 } });

    const { container, rerender } = render(
      <EPSearchEmpty>
        <div data-testid="empty-content">empty</div>
      </EPSearchEmpty>
    );

    expect(
      container.querySelector('[data-testid="empty-content"]')
    ).not.toBeNull();

    mockUseInstantSearch.mockReturnValue({ results: { nbHits: 5 } });
    rerender(
      <EPSearchEmpty>
        <div data-testid="empty-content">empty</div>
      </EPSearchEmpty>
    );

    expect(
      container.querySelector('[data-testid="empty-content"]')
    ).toBeNull();
    expect(container.querySelector("[data-ep-search-empty]")).toBeNull();
  });

  it("default slot tree ships heading + body copy with correct tags", () => {
    const slot = (epSearchEmptyMeta.props as any).children.defaultValue;
    expect(Array.isArray(slot)).toBe(true);
    const vbox = slot[0];
    expect(vbox.type).toBe("vbox");
    const [heading, body] = vbox.children;
    expect(heading.tag).toBe("h2");
    expect(heading.value).toBe("No results found");
    expect(body.tag).toBe("p");
    expect(body.value).toBe(
      "Try clearing your filters or searching for something else."
    );
  });

  it("registerEPSearchEmpty calls registerComponent", () => {
    const registerComponent = require("@plasmicapp/host/registerComponent")
      .default;
    registerComponent.mockClear();
    registerEPSearchEmpty();
    expect(registerComponent).toHaveBeenCalledWith(
      EPSearchEmpty,
      epSearchEmptyMeta
    );
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

  it("EPSearchSortBy items default uses ergonomic field/direction shape", () => {
    const items = (epSearchSortByMeta.props as any).items.defaultValue;
    expect(items[0]).toEqual({ label: "Most Relevant" });
    expect(items[1]).toEqual({
      field: "price.USD.float_price",
      direction: "asc",
      label: "Price: Low to High",
    });
    expect(items.every((i: any) => "label" in i)).toBe(true);
  });

  it("EPSearchSortBy meta has indexName prop with default 'search'", () => {
    const meta = (epSearchSortByMeta.props as any).indexName;
    expect(meta).toBeDefined();
    expect(meta.defaultValue).toBe("search");
  });

  it("EPClearRefinements meta exposes name, parent, providesData, refActions", () => {
    expect(typeof registerEPClearRefinements).toBe("function");
    expect(epClearRefinementsMeta.name).toBe(
      "plasmic-commerce-ep-clear-refinements"
    );
    expect(epClearRefinementsMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
    expect(epClearRefinementsMeta.providesData).toBe(true);
    expect(epClearRefinementsMeta.refActions!.clear).toBeDefined();
  });

  it("EPCurrentRefinements meta exposes name, parent, providesData", () => {
    expect(typeof registerEPCurrentRefinements).toBe("function");
    expect(epCurrentRefinementsMeta.name).toBe(
      "plasmic-commerce-ep-current-refinements"
    );
    expect(epCurrentRefinementsMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-catalog-search-provider"
    );
    expect(epCurrentRefinementsMeta.providesData).toBe(true);
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

describeHeadlessStylingContract({
  componentName: "EPClearRefinements",
  leafSelector: "[data-ep-clear-refinements]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPClearRefinements className={className}>
      <button>Clear all</button>
    </EPClearRefinements>
  ),
  renderAtRuntime: ({ className }) => {
    mockUseClearRefinements.mockReturnValue({
      refine: jest.fn(),
      canRefine: true,
      hasRefinements: true,
      createURL: jest.fn(),
    });
    return (
      <EPClearRefinements className={className}>
        <button>Clear all</button>
      </EPClearRefinements>
    );
  },
});

describeHeadlessStylingContract({
  componentName: "EPCurrentRefinements",
  leafSelector: "[data-ep-current-refinements]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPCurrentRefinements className={className}>
      <div>chip</div>
    </EPCurrentRefinements>
  ),
  renderAtRuntime: ({ className }) => {
    mockUseCurrentRefinements.mockReturnValue({
      items: [
        {
          attribute: "brand",
          label: "Brand",
          refinements: [
            { attribute: "brand", type: "facet", value: "leather", label: "Leather" },
          ],
          refine: jest.fn(),
        },
      ],
      canRefine: true,
      refine: jest.fn(),
      createURL: jest.fn(),
    });
    return (
      <EPCurrentRefinements className={className}>
        <div>chip</div>
      </EPCurrentRefinements>
    );
  },
});

describeHeadlessStylingContract({
  componentName: "EPSearchEmpty",
  leafSelector: "[data-ep-search-empty]",
  setEditorMode,
  renderInEditor: ({ className }) => (
    <EPSearchEmpty className={className}>
      <div>empty</div>
    </EPSearchEmpty>
  ),
  renderAtRuntime: ({ className }) => {
    mockUseInstantSearch.mockReturnValue({ results: { nbHits: 0 } });
    return (
      <EPSearchEmpty className={className}>
        <div>empty</div>
      </EPSearchEmpty>
    );
  },
});
