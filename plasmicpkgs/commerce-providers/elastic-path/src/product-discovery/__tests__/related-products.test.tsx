/**
 * @jest-environment jsdom
 *
 * Tests for Phase 3 related products components.
 *
 * Why: EPRelatedProductsProvider and useRelatedProducts enable "You May Also
 * Like" / upsell / accessories sections on PDP pages. The hook must correctly
 * call the EP Custom Relationships API, normalize products, and cache with a
 * long deduping interval (relationships change infrequently). The provider
 * must expose both `productGridData` (for EPProductGrid reuse) and
 * `relatedProductsData` (for relationship-specific metadata). It must also
 * auto-detect the parent product ID from DataProvider context.
 *
 * Components are loaded via require() after jest.mock() so esbuild-hoisted
 * imports see mocked modules.
 */

import React from "react";

/* ---------- mock variables (declared before jest.mock) ---------- */
const mockGetByContextAllRelatedProducts = jest.fn();
const mockUseMutablePlasmicQueryData = jest.fn();
const mockUseCommerce = jest.fn();
const mockUsePlasmicCanvasContext = jest.fn();
const mockUseSelector = jest.fn();
const mockHandleAPIError = jest.fn().mockImplementation((err: unknown) => {
  return err instanceof Error ? err : new Error(String(err));
});

/* ---------- jest.mock calls ---------- */
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getByContextAllRelatedProducts: (...a: unknown[]) =>
    mockGetByContextAllRelatedProducts(...a),
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
  repeatedElement: (_idx: number, children: React.ReactNode) => children,
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

const { useRelatedProducts } = require("../use-related-products") as typeof import("../use-related-products");
const {
  EPRelatedProductsProvider,
  epRelatedProductsProviderMeta,
  registerEPRelatedProductsProvider,
} = require("../EPRelatedProductsProvider") as typeof import("../EPRelatedProductsProvider");
const {
  MOCK_RELATED_PRODUCTS,
  MOCK_RELATED_PRODUCT_GRID_DATA,
  MOCK_RELATED_PRODUCTS_DATA,
} = require("../design-time-data") as typeof import("../design-time-data");

import type { Product } from "../../types/product";
import { mockProduct } from "../../utils/design-time-data";

/* ---------- helpers ---------- */
const mockClient = { baseUrl: "https://api.test.com" };
const mockProvider = { locale: "en-US", client: mockClient };

function setupCommerce() {
  mockUseCommerce.mockReturnValue(mockProvider);
}

/* ---------- useRelatedProducts hook tests ---------- */
describe("useRelatedProducts", () => {
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
      useRelatedProducts({
        productId: "prod-123",
        relationshipSlug: "CRP_related_products",
      })
    );

    expect(result.current.products).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should pass null query key when productId is missing", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    renderHook(() =>
      useRelatedProducts({
        relationshipSlug: "CRP_related_products",
      })
    );

    expect(mockUseMutablePlasmicQueryData).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      expect.any(Object)
    );
  });

  it("should pass null query key when relationshipSlug is missing", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    renderHook(() =>
      useRelatedProducts({
        productId: "prod-123",
      })
    );

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
      useRelatedProducts({
        productId: "prod-456",
        relationshipSlug: "CRP_upsell",
        limit: 8,
        locale: "fr-FR",
      })
    );

    expect(mockUseMutablePlasmicQueryData).toHaveBeenCalledWith(
      ["ep-related-products", "prod-456", "CRP_upsell", 8, "fr-FR"],
      expect.any(Function),
      expect.objectContaining({ revalidateOnFocus: false })
    );
  });

  it("should use long deduping interval since relationships change infrequently", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    renderHook(() =>
      useRelatedProducts({
        productId: "prod-123",
        relationshipSlug: "CRP_related_products",
      })
    );

    const swrOptions = mockUseMutablePlasmicQueryData.mock.calls[0][2];
    // SWR_DEDUPING_INTERVAL_LONG = 5 * 60 * 1000 = 300000
    expect(swrOptions.dedupingInterval).toBe(300000);
  });

  it("should report loading state", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
      mutate: jest.fn(),
    });

    const { result } = renderHook(() =>
      useRelatedProducts({
        productId: "prod-123",
        relationshipSlug: "CRP_related_products",
      })
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.products).toEqual([]);
  });

  it("should return products and totalCount from fetched data", () => {
    const mockProducts: Product[] = [
      mockProduct({
  id: "rp1",
  name: "Related Product 1",
  description: "desc",
  amount: 2500,
  currency: "USD",
}),
    ];

    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: mockProducts, totalCount: 3 },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { result } = renderHook(() =>
      useRelatedProducts({
        productId: "prod-123",
        relationshipSlug: "CRP_related_products",
      })
    );

    expect(result.current.products).toHaveLength(1);
    expect(result.current.products[0].attributes?.name).toBe("Related Product 1");
    expect(result.current.totalCount).toBe(3);
    expect(result.current.isLoading).toBe(false);
  });

  it("should return error when fetch fails", () => {
    const testError = new Error("Relationship not found");
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: testError,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { result } = renderHook(() =>
      useRelatedProducts({
        productId: "prod-123",
        relationshipSlug: "CRP_related_products",
      })
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
      useRelatedProducts({
        productId: "prod-123",
        relationshipSlug: "CRP_related_products",
      })
    );

    result.current.refetch();
    expect(mockMutate).toHaveBeenCalled();
  });

  it("should call getByContextAllRelatedProducts with correct params in fetcher", async () => {
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

    mockGetByContextAllRelatedProducts.mockResolvedValue({
      data: {
        data: [
          {
            id: "rp-0",
            attributes: { name: "RP0", slug: "rp0", description: "" },
            meta: {
              display_price: { without_tax: { amount: 500, currency: "USD" } },
            },
            relationships: {},
          },
        ],
        included: { main_images: [], files: [] },
        meta: { results: { total: BigInt(3) } },
      },
    });

    renderHook(() =>
      useRelatedProducts({
        productId: "prod-abc",
        relationshipSlug: "CRP_accessories",
        limit: 6,
      })
    );

    expect(capturedFetcher).not.toBeNull();
    await capturedFetcher!();

    const callArgs = mockGetByContextAllRelatedProducts.mock.calls[0][0];
    expect(callArgs.client).toBe(mockClient);
    expect(callArgs.path.product_id).toBe("prod-abc");
    expect(callArgs.path.custom_relationship_slug).toBe("CRP_accessories");
    expect(callArgs.query["page[limit]"]).toBe(BigInt(6));
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

    mockGetByContextAllRelatedProducts.mockResolvedValue({
      data: {
        data: [
          {
            id: "rp-0",
            attributes: { name: "P", slug: "p", description: "" },
            meta: {
              display_price: { without_tax: { amount: 100, currency: "USD" } },
            },
            relationships: {},
          },
        ],
        included: { main_images: [], files: [] },
        meta: { results: { total: BigInt(7) } },
      },
    });

    renderHook(() =>
      useRelatedProducts({
        productId: "prod-123",
        relationshipSlug: "CRP_related_products",
        limit: 4,
      })
    );

    const result = await capturedFetcher!();

    expect(result.totalCount).toBe(7);
    expect(typeof result.totalCount).toBe("number");
  });

  it("should use default limit of 4", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    renderHook(() =>
      useRelatedProducts({
        productId: "prod-123",
        relationshipSlug: "CRP_related_products",
      })
    );

    expect(mockUseMutablePlasmicQueryData).toHaveBeenCalledWith(
      ["ep-related-products", "prod-123", "CRP_related_products", 4, ""],
      expect.any(Function),
      expect.any(Object)
    );
  });
});

/* ---------- EPRelatedProductsProvider tests ---------- */
describe("EPRelatedProductsProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(null);
    mockUseSelector.mockReturnValue(undefined);
    setupCommerce();
  });

  it("should render mock data in editor with auto preview state", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPRelatedProductsProvider>
        <div data-testid="child">Child content</div>
      </EPRelatedProductsProvider>
    );

    // Should render productGridData DataProvider with mock data
    const gridDataProvider = container.querySelector(
      '[data-testid="data-provider-productGridData"]'
    );
    expect(gridDataProvider).not.toBeNull();

    // Should render relatedProductsData DataProvider
    const relatedDataProvider = container.querySelector(
      '[data-testid="data-provider-relatedProductsData"]'
    );
    expect(relatedDataProvider).not.toBeNull();
  });

  it("should show loading content when previewState is loading in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { getByText } = render(
      <EPRelatedProductsProvider
        previewState="loading"
        loadingContent={<div>Loading...</div>}
      >
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    expect(getByText("Loading...")).toBeTruthy();
  });

  it("should show error content when previewState is error in editor", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { getByText } = render(
      <EPRelatedProductsProvider
        previewState="error"
        errorContent={<div>Error occurred</div>}
      >
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    expect(getByText("Error occurred")).toBeTruthy();
  });

  it("should show empty content with empty productGridData when previewState is empty", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container, getByText } = render(
      <EPRelatedProductsProvider
        previewState="empty"
        emptyContent={<div>No related products</div>}
      >
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    expect(getByText("No related products")).toBeTruthy();

    const gridDataProvider = container.querySelector(
      '[data-testid="data-provider-productGridData"]'
    );
    const data = JSON.parse(
      gridDataProvider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.products).toEqual([]);
    expect(data.totalCount).toBe(0);
    expect(data.isEmpty).toBe(true);
  });

  it("should show mock data when previewState is withData", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(null);

    const { container } = render(
      <EPRelatedProductsProvider previewState="withData">
        <div data-testid="child">Child</div>
      </EPRelatedProductsProvider>
    );

    const gridDataProvider = container.querySelector(
      '[data-testid="data-provider-productGridData"]'
    );
    const data = JSON.parse(
      gridDataProvider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.products).toHaveLength(4);
    expect(data.totalCount).toBe(4);
  });

  it("should read product ID from parent currentProduct context", () => {
    // Simulate parent DataProvider providing currentProduct
    mockUseSelector.mockImplementation((name: string) => {
      if (name === "currentProduct") return { id: "parent-prod-id" };
      return undefined;
    });

    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: [], totalCount: 0 },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    render(
      <EPRelatedProductsProvider>
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    // The hook should have been called with the parent product ID
    const queryKey = mockUseMutablePlasmicQueryData.mock.calls[0]?.[0];
    if (queryKey) {
      expect(queryKey[1]).toBe("parent-prod-id");
    }
  });

  it("should prefer productId prop over parent context", () => {
    mockUseSelector.mockImplementation((name: string) => {
      if (name === "currentProduct") return { id: "context-prod" };
      return undefined;
    });

    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: [], totalCount: 0 },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    render(
      <EPRelatedProductsProvider productId="explicit-prod">
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    const queryKey = mockUseMutablePlasmicQueryData.mock.calls[0]?.[0];
    if (queryKey) {
      expect(queryKey[1]).toBe("explicit-prod");
    }
  });

  it("should render loading content when data is loading", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
      mutate: jest.fn(),
    });

    const { getByText } = render(
      <EPRelatedProductsProvider
        productId="prod-123"
        loadingContent={<div>Fetching...</div>}
      >
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    expect(getByText("Fetching...")).toBeTruthy();
  });

  it("should render error content when error occurs", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: null,
      error: new Error("API Error"),
      isLoading: false,
      mutate: jest.fn(),
    });

    const { getByText } = render(
      <EPRelatedProductsProvider
        productId="prod-123"
        errorContent={<div>Something went wrong</div>}
      >
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    expect(getByText("Something went wrong")).toBeTruthy();
  });

  it("should render empty content when no products found", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: [], totalCount: 0 },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { getByText } = render(
      <EPRelatedProductsProvider
        productId="prod-123"
        emptyContent={<div>No related items</div>}
      >
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    expect(getByText("No related items")).toBeTruthy();
  });

  it("should render children with productGridData when products are available", () => {
    const testProducts: Product[] = [
      mockProduct({
  id: "rp-1",
  name: "Related 1",
  description: "",
  amount: 3000,
  currency: "USD",
}),
      mockProduct({
  id: "rp-2",
  name: "Related 2",
  description: "",
  amount: 4000,
  currency: "USD",
}),
    ];

    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: testProducts, totalCount: 2 },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { container, getByText } = render(
      <EPRelatedProductsProvider productId="prod-123">
        <div>Products loaded</div>
      </EPRelatedProductsProvider>
    );

    expect(getByText("Products loaded")).toBeTruthy();

    const gridDataProvider = container.querySelector(
      '[data-testid="data-provider-productGridData"]'
    );
    const data = JSON.parse(
      gridDataProvider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.products).toHaveLength(2);
    expect(data.totalCount).toBe(2);
    expect(data.hasNextPage).toBe(false);
    expect(data.hasPreviousPage).toBe(false);
    expect(data.isEmpty).toBe(false);
  });

  it("should expose relatedProductsData with relationship metadata", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: [{ id: "rp-1" }], totalCount: 1 },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { container } = render(
      <EPRelatedProductsProvider
        productId="prod-123"
        relationshipSlug="CRP_upsell"
        relationshipName="Upsell Products"
      >
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    const relatedProvider = container.querySelector(
      '[data-testid="data-provider-relatedProductsData"]'
    );
    const data = JSON.parse(
      relatedProvider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.relationshipSlug).toBe("CRP_upsell");
    expect(data.relationshipName).toBe("Upsell Products");
    expect(data.isLoading).toBe(false);
    expect(data.isEmpty).toBe(false);
  });

  it("should default relationshipName to 'Related Products'", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: [{ id: "rp-1" }], totalCount: 1 },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { container } = render(
      <EPRelatedProductsProvider productId="prod-123">
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    const relatedProvider = container.querySelector(
      '[data-testid="data-provider-relatedProductsData"]'
    );
    const data = JSON.parse(
      relatedProvider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.relationshipName).toBe("Related Products");
  });

  it("should use default relationshipSlug of CRP_related_products", () => {
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: { products: [{ id: "rp-1" }], totalCount: 1 },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    });

    const { container } = render(
      <EPRelatedProductsProvider productId="prod-123">
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    const relatedProvider = container.querySelector(
      '[data-testid="data-provider-relatedProductsData"]'
    );
    const data = JSON.parse(
      relatedProvider!.getAttribute("data-provider-data") || "{}"
    );
    expect(data.relationshipSlug).toBe("CRP_related_products");
  });

  it("should apply className to wrapper div", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});

    const { container } = render(
      <EPRelatedProductsProvider className="my-class" previewState="withData">
        <div>Child</div>
      </EPRelatedProductsProvider>
    );

    const wrapper = container.querySelector(".my-class");
    expect(wrapper).not.toBeNull();
  });
});

/* ---------- Design-time data tests ---------- */
describe("related products design-time data", () => {
  it("should have 4 distinct mock related products", () => {
    expect(MOCK_RELATED_PRODUCTS).toHaveLength(4);
  });

  it("should have valid product shapes", () => {
    for (const product of MOCK_RELATED_PRODUCTS) {
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

  it("all mock related product IDs should be unique", () => {
    const ids = MOCK_RELATED_PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mock related products should be distinct from listing mock products", () => {
    const { MOCK_PRODUCTS } = require("../design-time-data");
    const listingIds = new Set(MOCK_PRODUCTS.map((p: any) => p.id));
    for (const rp of MOCK_RELATED_PRODUCTS) {
      expect(listingIds.has(rp.id)).toBe(false);
    }
  });

  it("MOCK_RELATED_PRODUCT_GRID_DATA should have correct shape", () => {
    expect(MOCK_RELATED_PRODUCT_GRID_DATA.products).toBe(MOCK_RELATED_PRODUCTS);
    expect(MOCK_RELATED_PRODUCT_GRID_DATA.totalCount).toBe(4);
    expect(MOCK_RELATED_PRODUCT_GRID_DATA.pageSize).toBe(4);
    expect(MOCK_RELATED_PRODUCT_GRID_DATA.totalPages).toBe(1);
    expect(MOCK_RELATED_PRODUCT_GRID_DATA.hasNextPage).toBe(false);
    expect(MOCK_RELATED_PRODUCT_GRID_DATA.isEmpty).toBe(false);
  });

  it("MOCK_RELATED_PRODUCTS_DATA should have relationship metadata", () => {
    expect(MOCK_RELATED_PRODUCTS_DATA.products).toBe(MOCK_RELATED_PRODUCTS);
    expect(MOCK_RELATED_PRODUCTS_DATA.totalCount).toBe(4);
    expect(MOCK_RELATED_PRODUCTS_DATA.relationshipSlug).toBe("CRP_related_products");
    expect(MOCK_RELATED_PRODUCTS_DATA.relationshipName).toBe("Related Products");
    expect(MOCK_RELATED_PRODUCTS_DATA.isLoading).toBe(false);
    expect(MOCK_RELATED_PRODUCTS_DATA.isEmpty).toBe(false);
  });
});

/* ---------- Registration tests ---------- */
describe("EPRelatedProductsProvider registration", () => {
  it("should export registerEPRelatedProductsProvider", () => {
    expect(typeof registerEPRelatedProductsProvider).toBe("function");
  });

  it("should have correct component meta", () => {
    expect(epRelatedProductsProviderMeta.name).toBe(
      "plasmic-commerce-ep-related-products-provider"
    );
    expect(epRelatedProductsProviderMeta.providesData).toBe(true);
    expect(epRelatedProductsProviderMeta.importName).toBe(
      "EPRelatedProductsProvider"
    );
  });

  it("should have relationshipSlug prop with default value", () => {
    const props = epRelatedProductsProviderMeta.props as any;
    expect(props.relationshipSlug).toBeDefined();
    expect(props.relationshipSlug.defaultValue).toBe("CRP_related_products");
  });

  it("should have relationshipName prop with default value", () => {
    const props = epRelatedProductsProviderMeta.props as any;
    expect(props.relationshipName).toBeDefined();
    expect(props.relationshipName.defaultValue).toBe("Related Products");
  });

  it("should have limit prop with default value of 4", () => {
    const props = epRelatedProductsProviderMeta.props as any;
    expect(props.limit).toBeDefined();
    expect(props.limit.defaultValue).toBe(4);
  });

  it("should have previewState prop with advanced flag", () => {
    const props = epRelatedProductsProviderMeta.props as any;
    expect(props.previewState).toBeDefined();
    expect(props.previewState.advanced).toBe(true);
  });

  it("should have default slot content using EPProductGrid", () => {
    const props = epRelatedProductsProviderMeta.props as any;
    expect(props.children.defaultValue).toEqual([
      {
        type: "component",
        name: "plasmic-commerce-ep-product-grid",
      },
    ]);
  });

  it("should not have parentComponentName restriction (D5)", () => {
    expect(
      (epRelatedProductsProviderMeta as any).parentComponentName
    ).toBeUndefined();
  });
});
