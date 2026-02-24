/**
 * @jest-environment jsdom
 */

// Tests for the SWR-based useStock and useProductStock hooks.
// Verifies query key construction (sorted, stable), fetcher logic (multi-product
// fetching, per-product error degradation, locationIds passthrough), and the
// useProductStock convenience wrapper.

import { renderHook } from "@testing-library/react";

// --- Mocks (must come before require() of code under test) ---------------
// NOTE: esbuild hoists `import` to require() at the top, BEFORE jest.mock
// calls. Use require() for modules whose deps need mocking so they load
// AFTER mocks are registered.

let capturedQueryKey: any = null;
let capturedFetcher: (() => Promise<any>) | null = null;
let capturedOptions: any = null;
const mockMutate = jest.fn();

jest.mock("@plasmicapp/query", () => ({
  useMutablePlasmicQueryData: jest.fn(
    (key: any, fetcher: any, options: any) => {
      capturedQueryKey = key;
      capturedFetcher = key ? fetcher : null;
      capturedOptions = options;
      return {
        data: undefined,
        error: undefined,
        isLoading: !!key,
        mutate: mockMutate,
      };
    }
  ),
}));

const mockGetStock = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getStock: (...args: any[]) => mockGetStock(...args),
}));

const mockClient = { baseUrl: "https://test.epcc.io" };
jest.mock("../../elastic-path", () => ({
  __esModule: true,
  useCommerce: () => ({
    providerRef: { current: { client: mockClient } },
  }),
}));

const mockCreateProductStock = jest.fn();
jest.mock("../utils/stockCalculations", () => ({
  createProductStock: (...args: any[]) => mockCreateProductStock(...args),
}));

jest.mock("../../utils/errorHandling", () => ({
  handleAPIError: (_err: unknown, _ctx: string) => ({
    message: "handled error",
  }),
}));

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Import under test AFTER mocks — require() is not hoisted by esbuild
const { useStock, useProductStock } =
  require("../use-stock") as typeof import("../use-stock");

// --- Helpers -------------------------------------------------------------

function makeStockResponse(
  productId: string,
  available = 10,
  allocated = 2,
  total = 12
) {
  return {
    data: {
      data: {
        attributes: {
          locations: {
            "warehouse-1": { available, allocated, total },
          },
        },
      },
    },
  };
}

function makeProductStock(productId: string) {
  return {
    productId,
    locations: [],
    totalAvailable: 10,
    totalAllocated: 2,
    totalStock: 12,
  };
}

// --- Tests ---------------------------------------------------------------

describe("useStock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedQueryKey = null;
    capturedFetcher = null;
    capturedOptions = null;
  });

  // -- Loading state --

  it("returns loading=true initially when query key is active", () => {
    const { result } = renderHook(() =>
      useStock({ productIds: ["prod-1"] })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.productStock).toEqual({});
  });

  // -- Query key construction --

  it("sets query key to null when disabled", () => {
    renderHook(() =>
      useStock({ productIds: ["prod-1"], enabled: false })
    );

    expect(capturedQueryKey).toBeNull();
  });

  it("sets query key to null when productIds is empty", () => {
    renderHook(() => useStock({ productIds: [] }));

    expect(capturedQueryKey).toBeNull();
  });

  it("constructs a sorted, stable query key from productIds", () => {
    renderHook(() =>
      useStock({ productIds: ["zzz-product", "aaa-product", "mmm-product"] })
    );

    expect(capturedQueryKey).toEqual([
      "ep-stock",
      "aaa-product,mmm-product,zzz-product",
      "",
    ]);
  });

  it("includes sorted locationIds in the query key", () => {
    renderHook(() =>
      useStock({
        productIds: ["prod-1"],
        locationIds: ["store-z", "store-a", "store-m"],
      })
    );

    expect(capturedQueryKey).toEqual([
      "ep-stock",
      "prod-1",
      "store-a,store-m,store-z",
    ]);
  });

  it("uses empty string for locationKey when no locationIds provided", () => {
    renderHook(() => useStock({ productIds: ["prod-1"] }));

    expect(capturedQueryKey).toEqual(["ep-stock", "prod-1", ""]);
  });

  // -- Fetcher: multi-product --

  it("fetches stock for each product ID in parallel", async () => {
    mockGetStock
      .mockResolvedValueOnce(makeStockResponse("prod-1"))
      .mockResolvedValueOnce(makeStockResponse("prod-2"));
    mockCreateProductStock
      .mockReturnValueOnce(makeProductStock("prod-1"))
      .mockReturnValueOnce(makeProductStock("prod-2"));

    renderHook(() =>
      useStock({ productIds: ["prod-1", "prod-2"] })
    );
    const result = await capturedFetcher!();

    expect(mockGetStock).toHaveBeenCalledTimes(2);
    expect(mockGetStock).toHaveBeenCalledWith({
      client: mockClient,
      path: { product_uuid: "prod-1" },
    });
    expect(mockGetStock).toHaveBeenCalledWith({
      client: mockClient,
      path: { product_uuid: "prod-2" },
    });
    expect(result).toHaveProperty("prod-1");
    expect(result).toHaveProperty("prod-2");
  });

  it("builds the stockMap keyed by productId", async () => {
    mockGetStock.mockResolvedValue(makeStockResponse("prod-1"));
    const expectedStock = makeProductStock("prod-1");
    mockCreateProductStock.mockReturnValue(expectedStock);

    renderHook(() => useStock({ productIds: ["prod-1"] }));
    const result = await capturedFetcher!();

    expect(result["prod-1"]).toEqual(expectedStock);
  });

  // -- Fetcher: graceful per-product error degradation --

  it("returns empty stock for a product when its API call fails", async () => {
    mockGetStock.mockRejectedValue(new Error("Product not found"));

    renderHook(() => useStock({ productIds: ["bad-prod"] }));
    const result = await capturedFetcher!();

    expect(result["bad-prod"]).toEqual({
      productId: "bad-prod",
      locations: [],
      totalStock: 0,
      totalAllocated: 0,
      totalAvailable: 0,
    });
  });

  it("returns partial results when one of multiple products fails", async () => {
    mockGetStock
      .mockResolvedValueOnce(makeStockResponse("prod-good"))
      .mockRejectedValueOnce(new Error("Not found"));
    const goodStock = makeProductStock("prod-good");
    mockCreateProductStock.mockReturnValueOnce(goodStock);

    renderHook(() =>
      useStock({ productIds: ["prod-good", "prod-bad"] })
    );
    const result = await capturedFetcher!();

    expect(result["prod-good"]).toEqual(goodStock);
    expect(result["prod-bad"]).toEqual({
      productId: "prod-bad",
      locations: [],
      totalStock: 0,
      totalAllocated: 0,
      totalAvailable: 0,
    });
  });

  it("does not throw when all products fail", async () => {
    mockGetStock.mockRejectedValue(new Error("API down"));

    renderHook(() =>
      useStock({ productIds: ["p1", "p2"] })
    );

    await expect(capturedFetcher!()).resolves.not.toThrow();
    const result = await capturedFetcher!();
    expect(result["p1"].totalStock).toBe(0);
    expect(result["p2"].totalStock).toBe(0);
  });

  // -- Fetcher: locationIds passthrough --

  it("passes locationIds to createProductStock", async () => {
    const locationIds = ["store-a", "store-b"];
    mockGetStock.mockResolvedValue(makeStockResponse("prod-1"));
    mockCreateProductStock.mockReturnValue(makeProductStock("prod-1"));

    renderHook(() =>
      useStock({ productIds: ["prod-1"], locationIds })
    );
    await capturedFetcher!();

    expect(mockCreateProductStock).toHaveBeenCalledWith(
      "prod-1",
      expect.anything(),
      locationIds
    );
  });

  it("passes undefined locationIds when not provided", async () => {
    mockGetStock.mockResolvedValue(makeStockResponse("prod-1"));
    mockCreateProductStock.mockReturnValue(makeProductStock("prod-1"));

    renderHook(() => useStock({ productIds: ["prod-1"] }));
    await capturedFetcher!();

    expect(mockCreateProductStock).toHaveBeenCalledWith(
      "prod-1",
      expect.anything(),
      undefined
    );
  });

  // -- SWR options --

  it("configures SWR with 60 second dedupingInterval", () => {
    renderHook(() => useStock({ productIds: ["prod-1"] }));

    expect(capturedOptions).toMatchObject({
      revalidateOnFocus: false,
      dedupingInterval: 60 * 1000,
    });
  });

  // -- refetch --

  it("refetch triggers SWR mutate", () => {
    const { result } = renderHook(() =>
      useStock({ productIds: ["prod-1"] })
    );

    result.current.refetch();

    expect(mockMutate).toHaveBeenCalled();
  });

  // -- Error state propagation --

  it("propagates SWR error to returned error field", () => {
    const swrError = new Error("SWR fetch failed");
    const { useMutablePlasmicQueryData } = require("@plasmicapp/query");
    (useMutablePlasmicQueryData as jest.Mock).mockReturnValueOnce({
      data: undefined,
      error: swrError,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() =>
      useStock({ productIds: ["prod-1"] })
    );

    expect(result.current.error).toBe(swrError);
    expect(result.current.loading).toBe(false);
  });

  it("returns empty productStock map when SWR returns no data", () => {
    const { useMutablePlasmicQueryData } = require("@plasmicapp/query");
    (useMutablePlasmicQueryData as jest.Mock).mockReturnValueOnce({
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() =>
      useStock({ productIds: ["prod-1"] })
    );

    expect(result.current.productStock).toEqual({});
  });
});

// --- useProductStock tests -----------------------------------------------

describe("useProductStock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedQueryKey = null;
    capturedFetcher = null;
  });

  it("wraps useStock and returns single product stock from the map", () => {
    const stockEntry = makeProductStock("prod-123");
    const { useMutablePlasmicQueryData } = require("@plasmicapp/query");
    (useMutablePlasmicQueryData as jest.Mock).mockReturnValueOnce({
      data: { "prod-123": stockEntry },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() =>
      useProductStock("prod-123")
    );

    expect(result.current.stock).toEqual(stockEntry);
  });

  it("returns null stock when productId is not in the stock map", () => {
    const { useMutablePlasmicQueryData } = require("@plasmicapp/query");
    (useMutablePlasmicQueryData as jest.Mock).mockReturnValueOnce({
      data: {},
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() =>
      useProductStock("prod-missing")
    );

    expect(result.current.stock).toBeNull();
  });

  it("passes a single-element productIds array to useStock", () => {
    renderHook(() => useProductStock("prod-abc"));

    // The query key will be ["ep-stock", "prod-abc", ""]
    expect(capturedQueryKey).toEqual(["ep-stock", "prod-abc", ""]);
  });

  it("sets query key to null when productId is an empty string", () => {
    renderHook(() => useProductStock(""));

    expect(capturedQueryKey).toBeNull();
  });

  it("sets query key to null when enabled=false", () => {
    renderHook(() => useProductStock("prod-123", undefined, false));

    expect(capturedQueryKey).toBeNull();
  });

  it("passes locationIds through to useStock query key", () => {
    renderHook(() =>
      useProductStock("prod-123", ["loc-b", "loc-a"])
    );

    expect(capturedQueryKey).toEqual([
      "ep-stock",
      "prod-123",
      "loc-a,loc-b",
    ]);
  });

  it("exposes loading and error from the underlying useStock call", () => {
    const swrError = new Error("Fetch failed");
    const { useMutablePlasmicQueryData } = require("@plasmicapp/query");
    (useMutablePlasmicQueryData as jest.Mock).mockReturnValueOnce({
      data: undefined,
      error: swrError,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() =>
      useProductStock("prod-123")
    );

    expect(result.current.error).toBe(swrError);
    expect(result.current.loading).toBe(false);
  });

  it("refetch triggers SWR mutate", () => {
    const { result } = renderHook(() =>
      useProductStock("prod-123")
    );

    result.current.refetch();

    expect(mockMutate).toHaveBeenCalled();
  });
});
