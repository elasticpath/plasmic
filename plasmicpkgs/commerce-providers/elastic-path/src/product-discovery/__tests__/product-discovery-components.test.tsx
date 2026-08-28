/**
 * @jest-environment jsdom
 *
 * Tests for Phase 1 product discovery components.
 *
 * Why: These components form the foundation of product listing in Plasmic
 * Studio. The hook (useProductList) must correctly paginate, normalize, and
 * cache. The provider (EPProductListProvider) must expose pagination state
 * and actions. The grid (EPProductGrid) must iterate products and expose
 * per-product data with formatted prices.
 *
 * Components are loaded via require() after jest.mock() so esbuild-hoisted
 * imports see mocked modules.
 */

import React from "react";

/* ---------- mock variables (declared before jest.mock) ---------- */
const mockGetByContextAllProducts = jest.fn();
const mockGetByContextProductsForNode = jest.fn();
const mockUseMutablePlasmicQueryData = jest.fn();
const mockUseCommerce = jest.fn();
const mockUsePlasmicCanvasContext = jest.fn();
const mockUseSelector = jest.fn();
const mockRepeatedElement = jest.fn(
  (_idx: number, children: React.ReactNode) => children
);
const mockHandleAPIError = jest.fn().mockImplementation((err: unknown) => {
  return err instanceof Error ? err : new Error(String(err));
});

/* ---------- jest.mock calls ---------- */
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getByContextAllProducts: (...a: unknown[]) =>
    mockGetByContextAllProducts(...a),
  getByContextProductsForNode: (...a: unknown[]) =>
    mockGetByContextProductsForNode(...a),
}));

jest.mock("@plasmicapp/query", () => ({
  useMutablePlasmicQueryData: (...a: unknown[]) =>
    mockUseMutablePlasmicQueryData(...a),
}));

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
  handleAPIError: (...a: unknown[]) => mockHandleAPIError(...a),
}));

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

/* ---------- code under test (after mocks) ---------- */
import { render } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

const { useProductList } = require("../use-product-list") as typeof import("../use-product-list");
const { EPProductGrid, epProductGridMeta } =
  require("../EPProductGrid") as typeof import("../EPProductGrid");
const { epProductListProviderMeta, registerEPProductListProvider } =
  require("../EPProductListProvider") as typeof import("../EPProductListProvider");
const { registerEPProductGrid } =
  require("../EPProductGrid") as typeof import("../EPProductGrid");
const { MOCK_PRODUCTS, MOCK_PRODUCT_GRID_DATA } =
  require("../design-time-data") as typeof import("../design-time-data");

import type { Product } from "../../types/product";
import { mockProduct } from "../../utils/design-time-data";

/* ---------- helpers ---------- */
const mockClient = { baseUrl: "https://api.test.com" };
const mockProvider = { locale: "en-US", client: mockClient };

function setupCommerce() {
  mockUseCommerce.mockReturnValue(mockProvider);
}

/* ---------- useProductList hook tests ---------- */
describe("useProductList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommerce();
  });

  it("should return empty state when no client is available", () => {
    mockUseCommerce.mockReturnValue(null);
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { result } = renderHook(() =>
      useProductList({ page: 0, pageSize: 12 })
    );

    expect(result.current.products).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should pass null query key when client is unavailable", () => {
    mockUseCommerce.mockReturnValue(null);
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    renderHook(() => useProductList({ page: 0, pageSize: 12 }));

    expect(mockUseMutablePlasmicQueryData).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      expect.any(Object)
    );
  });

  it("should build correct query key with all parameters", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
      mutate: jest.fn(),
    });

    renderHook(() =>
      useProductList({
        categoryId: "cat-123",
        search: "jacket",
        sort: "price-asc",
        page: 2,
        pageSize: 24,
        locale: "fr-FR",
      })
    );

    expect(mockUseMutablePlasmicQueryData).toHaveBeenCalledWith(
      ["ep-product-list", "cat-123", "jacket", "price-asc", 2, 24, "fr-FR"],
      expect.any(Function),
      expect.objectContaining({ revalidateOnFocus: false })
    );
  });

  it("should report loading state", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
      mutate: jest.fn(),
    });

    const { result } = renderHook(() =>
      useProductList({ page: 0, pageSize: 12 })
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.products).toEqual([]);
  });

  it("should return products and totalCount from fetched data", () => {
    const mockProducts: Product[] = [
      mockProduct({
  id: "p1",
  name: "Test Product",
  description: "desc",
  amount: 1000,
  currency: "USD",
}),
    ];

    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: mockProducts, totalCount: 42 },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { result } = renderHook(() =>
      useProductList({ page: 0, pageSize: 12 })
    );

    expect(result.current.products).toHaveLength(1);
    expect(result.current.products[0].attributes?.name).toBe("Test Product");
    expect(result.current.totalCount).toBe(42);
    expect(result.current.isLoading).toBe(false);
  });

  it("should return error when fetch fails", () => {
    const testError = new Error("Network failure");
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: testError,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { result } = renderHook(() =>
      useProductList({ page: 0, pageSize: 12 })
    );

    expect(result.current.error).toBe(testError);
    expect(result.current.products).toEqual([]);
  });

  it("should expose refetch function via mutate", () => {
    const mockMutate = jest.fn();
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: [], totalCount: 0 },
      error: null,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() =>
      useProductList({ page: 0, pageSize: 12 })
    );

    result.current.refetch();
    expect(mockMutate).toHaveBeenCalled();
  });

  it("should call getByContextAllProducts with BigInt pagination params in fetcher", async () => {
    let capturedFetcher: Function | null = null;
    mockUseMutablePlasmicQueryData.mockImplementation(
      (_key: unknown, fetcher: Function) => {
        capturedFetcher = fetcher;
        return {
          data: null,
          error: null,
          isLoading: false,
          mutate: jest.fn(),
        };
      }
    );

    mockGetByContextAllProducts.mockResolvedValue({
      data: {
        data: [
          {
            id: "prod-0",
            attributes: { name: "P0", slug: "p0", description: "" },
            meta: {
              display_price: { without_tax: { amount: 1000, currency: "USD" } },
            },
            relationships: {},
          },
        ],
        included: { main_images: [], files: [] },
        meta: { results: { total: BigInt(48) } },
      },
    });

    renderHook(() => useProductList({ page: 1, pageSize: 12 }));

    expect(capturedFetcher).not.toBeNull();
    await capturedFetcher!();

    const callArgs = mockGetByContextAllProducts.mock.calls[0][0];
    expect(callArgs.client).toBe(mockClient);
    expect(callArgs.query["page[limit]"]).toBe(BigInt(12));
    expect(callArgs.query["page[offset]"]).toBe(BigInt(12));
    expect(callArgs.query.include).toEqual([
      "main_image",
      "files",
      "component_products",
    ]);
  });

  it("should pass search filter to the API", async () => {
    let capturedFetcher: Function | null = null;
    mockUseMutablePlasmicQueryData.mockImplementation(
      (_key: unknown, fetcher: Function) => {
        capturedFetcher = fetcher;
        return {
          data: null,
          error: null,
          isLoading: false,
          mutate: jest.fn(),
        };
      }
    );

    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [], included: {}, meta: { results: { total: BigInt(0) } } },
    });

    renderHook(() =>
      useProductList({ search: "jacket", page: 0, pageSize: 12 })
    );

    await capturedFetcher!();

    const callArgs = mockGetByContextAllProducts.mock.calls[0][0];
    expect(callArgs.query.filter).toContain("eq(name,jacket)");
  });

  it("should pass category filter to the API", async () => {
    let capturedFetcher: Function | null = null;
    mockUseMutablePlasmicQueryData.mockImplementation(
      (_key: unknown, fetcher: Function) => {
        capturedFetcher = fetcher;
        return {
          data: null,
          error: null,
          isLoading: false,
          mutate: jest.fn(),
        };
      }
    );

    mockGetByContextProductsForNode.mockResolvedValue({
      data: { data: [], included: {}, meta: { results: { total: BigInt(0) } } },
    });

    renderHook(() =>
      useProductList({ categoryId: "cat-123", page: 0, pageSize: 12 })
    );

    await capturedFetcher!();

    // Elastic Path has no filterable category key — a categoryId is a node ID
    // and selects the node's products endpoint.
    expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
    const callArgs = mockGetByContextProductsForNode.mock.calls[0][0];
    expect(callArgs.path).toEqual({ node_id: "cat-123" });
    expect(callArgs.query.filter).toBeUndefined();
  });

  it("should convert BigInt total count from API response", async () => {
    let capturedFetcher: Function | null = null;
    mockUseMutablePlasmicQueryData.mockImplementation(
      (_key: unknown, fetcher: Function) => {
        capturedFetcher = fetcher;
        return {
          data: null,
          error: null,
          isLoading: false,
          mutate: jest.fn(),
        };
      }
    );

    mockGetByContextAllProducts.mockResolvedValue({
      data: {
        data: [
          {
            id: "prod-0",
            attributes: { name: "P", slug: "p", description: "" },
            meta: {
              display_price: { without_tax: { amount: 100, currency: "USD" } },
            },
            relationships: {},
          },
        ],
        included: { main_images: [], files: [] },
        meta: { results: { total: BigInt(99) } },
      },
    });

    renderHook(() => useProductList({ page: 0, pageSize: 12 }));

    const result = await capturedFetcher!();

    expect(result.totalCount).toBe(99);
    expect(typeof result.totalCount).toBe("number");
  });
});

/* ---------- EPProductGrid tests ---------- */
describe("EPProductGrid", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
  });

  it("should render nothing when no products and not in editor", () => {
    mockUseSelector.mockReturnValue({ products: [] });

    const { container } = render(
      <EPProductGrid>
        <div>child</div>
      </EPProductGrid>
    );

    expect(container.innerHTML).toBe("");
  });

  it("should render mock data in editor when no real data", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    mockUseSelector.mockReturnValue(undefined);

    const { container } = render(
      <EPProductGrid>
        <div data-testid="card">Product Card</div>
      </EPProductGrid>
    );

    const listItems = container.querySelectorAll('[role="listitem"]');
    expect(listItems.length).toBe(MOCK_PRODUCTS.length);
  });

  it("should render products from parent DataProvider", () => {
    const testProducts: Product[] = [
      mockProduct({
  id: "test-1",
  name: "Test Product 1",
  description: "desc",
  amount: 2999,
  currency: "USD",
}),
      mockProduct({
  id: "test-2",
  name: "Test Product 2",
  description: "desc",
  amount: 4999,
  currency: "USD",
}),
    ];

    mockUseSelector.mockReturnValue({ products: testProducts });

    const { container } = render(
      <EPProductGrid>
        <div data-testid="card">Product Card</div>
      </EPProductGrid>
    );

    const listItems = container.querySelectorAll('[role="listitem"]');
    expect(listItems.length).toBe(2);
  });

  it("publishes the Elastic Path product as currentProduct", () => {
    const testProducts: Product[] = [
      mockProduct({
  id: "price-test",
  name: "Price Test Product",
  description: "Testing price formatting",
  amount: 2999,
  currency: "USD",
  images: [{ url: "https://example.com/img.png", alt: "test" }],
}),
    ];

    mockUseSelector.mockReturnValue({ products: testProducts });

    const { container } = render(
      <EPProductGrid>
        <div>child</div>
      </EPProductGrid>
    );

    const providerEl = container.querySelector(
      '[data-testid="data-provider-currentProduct"]'
    );
    expect(providerEl).not.toBeNull();

    const data = JSON.parse(
      providerEl!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.id).toBe("price-test");
    expect(data.attributes.name).toBe("Price Test Product");
    expect(data.meta.display_price.without_tax).toEqual({
      amount: 2999,
      currency: "USD",
      float_price: 29.99,
      formatted: "$29.99",
    });
  });

  it("should expose currentProductIndex via DataProvider", () => {
    const testProducts: Product[] = [
      mockProduct({
  id: "idx-0",
  name: "First",
  description: "",
  amount: 1000,
  currency: "USD",
}),
      mockProduct({
  id: "idx-1",
  name: "Second",
  description: "",
  amount: 2000,
  currency: "USD",
}),
    ];

    mockUseSelector.mockReturnValue({ products: testProducts });

    const { container } = render(
      <EPProductGrid>
        <div>child</div>
      </EPProductGrid>
    );

    const indexProviders = container.querySelectorAll(
      '[data-testid="data-provider-currentProductIndex"]'
    );
    expect(indexProviders.length).toBe(2);
    expect(
      JSON.parse(indexProviders[0].getAttribute("data-provider-data") || "null")
    ).toBe(0);
    expect(
      JSON.parse(indexProviders[1].getAttribute("data-provider-data") || "null")
    ).toBe(1);
  });

  it("should use withData previewState to force mock products", () => {
    mockUseSelector.mockReturnValue(undefined);
    mockUsePlasmicCanvasContext.mockReturnValue(null);

    const { container } = render(
      <EPProductGrid previewState="withData">
        <div>child</div>
      </EPProductGrid>
    );

    const listItems = container.querySelectorAll('[role="listitem"]');
    expect(listItems.length).toBe(MOCK_PRODUCTS.length);
  });
});

/* ---------- Design-time data tests ---------- */
describe("design-time-data", () => {
  it("should have 6 mock products", () => {
    expect(MOCK_PRODUCTS).toHaveLength(6);
  });

  it("should have valid product shapes", () => {
    for (const product of MOCK_PRODUCTS) {
      expect(product.id).toBeTruthy();
      expect(product.attributes?.name).toBeTruthy();
      expect(product.attributes?.slug).toBeTruthy();
            expect(typeof product.meta?.display_price?.without_tax?.float_price).toBe(
        "number"
      );
      expect(product.meta?.display_price?.without_tax?.currency).toBe("USD");
      expect(product.images.length).toBeGreaterThan(0);
    }
  });

  it("should have valid MOCK_PRODUCT_GRID_DATA", () => {
    expect(MOCK_PRODUCT_GRID_DATA.products).toBe(MOCK_PRODUCTS);
    expect(MOCK_PRODUCT_GRID_DATA.totalCount).toBe(48);
    expect(MOCK_PRODUCT_GRID_DATA.currentPage).toBe(0);
    expect(MOCK_PRODUCT_GRID_DATA.totalPages).toBe(4);
    expect(MOCK_PRODUCT_GRID_DATA.pageSize).toBe(12);
    expect(MOCK_PRODUCT_GRID_DATA.hasNextPage).toBe(true);
    expect(MOCK_PRODUCT_GRID_DATA.hasPreviousPage).toBe(false);
    expect(MOCK_PRODUCT_GRID_DATA.isEmpty).toBe(false);
    expect(MOCK_PRODUCT_GRID_DATA.summary).toContain("48");
  });

  it("all mock product IDs should be unique", () => {
    const ids = MOCK_PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ---------- Registration tests ---------- */
describe("component registration", () => {
  it("should export registerEPProductGrid", () => {
    expect(typeof registerEPProductGrid).toBe("function");
  });

  it("should export registerEPProductListProvider", () => {
    expect(typeof registerEPProductListProvider).toBe("function");
  });

  it("EPProductGrid meta should have correct name and providesData", () => {
    expect(epProductGridMeta.name).toBe("plasmic-commerce-ep-product-grid");
    expect(epProductGridMeta.providesData).toBe(true);
    expect(epProductGridMeta.importName).toBe("EPProductGrid");
  });

  it("EPProductListProvider meta should have correct name and refActions", () => {
    expect(epProductListProviderMeta.name).toBe(
      "plasmic-commerce-ep-product-list-provider"
    );
    expect(epProductListProviderMeta.providesData).toBe(true);
    expect(epProductListProviderMeta.refActions).toBeDefined();
    expect(epProductListProviderMeta.refActions!.setSort).toBeDefined();
    expect(epProductListProviderMeta.refActions!.goToPage).toBeDefined();
    expect(epProductListProviderMeta.refActions!.nextPage).toBeDefined();
    expect(epProductListProviderMeta.refActions!.prevPage).toBeDefined();
    expect(epProductListProviderMeta.refActions!.loadMore).toBeDefined();
  });
});
