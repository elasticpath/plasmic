/**
 * @jest-environment jsdom
 */

// Tests for the SWR-based useBundleOptionProducts hook.
// Verifies query key construction (including parent product child IDs),
// fetcher batch logic, and disabled-state handling.

import { renderHook } from "@testing-library/react";
import type { ComponentProduct } from "../types";

// --- Mocks (must come before require() of code under test) ---------------
// NOTE: esbuild hoists `import` to require() at the top, BEFORE jest.mock.
// Use require() for modules whose deps need mocking.

let capturedQueryKey: any = null;
let capturedFetcher: (() => Promise<any>) | null = null;
const mockMutate = jest.fn();

jest.mock("@plasmicapp/query", () => ({
  useMutablePlasmicQueryData: jest.fn((key: any, fetcher: any) => {
    capturedQueryKey = key;
    capturedFetcher = key ? fetcher : null;
    return {
      data: undefined,
      error: undefined,
      isLoading: !!key,
      mutate: mockMutate,
    };
  }),
}));

const mockGetByContextAllProducts = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getByContextAllProducts: (...args: any[]) =>
    mockGetByContextAllProducts(...args),
}));

const mockClient = { baseUrl: "https://test.epcc.io" };
jest.mock("../../shopper-context/EpCommerceContext", () => ({
  __esModule: true,
  useEpCommerce: () => ({ client: mockClient }),
}));

// Import under test AFTER mocks — require() is not hoisted by esbuild
const { useBundleOptionProducts } =
  require("../use-bundle-option-products") as typeof import("../use-bundle-option-products");

// --- Helpers -------------------------------------------------------------

function makeComponents(
  optionIds: string[]
): Record<string, ComponentProduct> {
  return {
    comp1: {
      name: "Component 1",
      options: optionIds.map((id) => ({
        id,
        type: "product" as const,
        quantity: 1,
      })),
      min: 1,
      max: 1,
      sort_order: 1,
    },
  };
}

function makeApiProduct(id: string) {
  return {
    id,
    attributes: {
      name: `Product ${id}`,
      description: `Desc ${id}`,
      sku: `SKU-${id}`,
    },
    relationships: { main_image: { data: { id: `img-${id}` } } },
    meta: { display_price: { without_tax: { formatted: `$${id}` } } },
  };
}

// --- Tests ---------------------------------------------------------------

describe("useBundleOptionProducts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedQueryKey = null;
    capturedFetcher = null;
  });

  // -- Query key construction --

  it("sets query key to null when disabled", () => {
    renderHook(() =>
      useBundleOptionProducts({
        components: makeComponents(["a"]),
        enabled: false,
      })
    );
    expect(capturedQueryKey).toBeNull();
  });

  it("sets query key to null when no product options exist", () => {
    renderHook(() =>
      useBundleOptionProducts({
        components: { c: { name: "Empty", options: [] } },
      })
    );
    expect(capturedQueryKey).toBeNull();
  });

  it("constructs a sorted, stable query key from option IDs", () => {
    renderHook(() =>
      useBundleOptionProducts({ components: makeComponents(["z", "a", "m"]) })
    );
    expect(capturedQueryKey).toEqual([
      "ep-bundle-option-products",
      "a,m,z",
    ]);
  });

  it("includes child product IDs from parent products in the query key", () => {
    const parentProducts = {
      p1: { children: [{ id: "child-a" }, { id: "child-b" }] },
    };
    renderHook(() =>
      useBundleOptionProducts({
        components: makeComponents(["p1"]),
        parentProducts,
      })
    );
    expect(capturedQueryKey).toEqual([
      "ep-bundle-option-products",
      "child-a,child-b,p1",
    ]);
  });

  it("deduplicates IDs across direct options and parent children", () => {
    const parentProducts = {
      p1: { children: [{ id: "p1" }] },
    };
    renderHook(() =>
      useBundleOptionProducts({
        components: makeComponents(["p1"]),
        parentProducts,
      })
    );
    expect(capturedQueryKey).toEqual(["ep-bundle-option-products", "p1"]);
  });

  // -- Fetcher: product mapping --

  it("maps API response to OptionProduct shape", async () => {
    const apiProduct = makeApiProduct("prod-1");
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [apiProduct] },
    });

    renderHook(() =>
      useBundleOptionProducts({ components: makeComponents(["prod-1"]) })
    );
    const result = await capturedFetcher!();

    expect(result["prod-1"]).toEqual({
      id: "prod-1",
      name: "Product prod-1",
      description: "Desc prod-1",
      image: "img-prod-1",
      price: "$prod-1",
      sku: "SKU-prod-1",
    });
  });

  // -- Fetcher: batch processing --

  it("batch-fetches products in groups of 100", async () => {
    const ids = Array.from(
      { length: 150 },
      (_, i) => `id-${String(i).padStart(3, "0")}`
    );
    mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });

    renderHook(() =>
      useBundleOptionProducts({ components: makeComponents(ids) })
    );
    await capturedFetcher!();

    expect(mockGetByContextAllProducts).toHaveBeenCalledTimes(2);
  });

  it("returns empty map when API returns no products", async () => {
    mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });

    renderHook(() =>
      useBundleOptionProducts({ components: makeComponents(["missing"]) })
    );
    const result = await capturedFetcher!();

    expect(result).toEqual({});
  });

  // -- Fetcher: error handling --

  it("returns partial results when one batch fails", async () => {
    const successProduct = makeApiProduct("good");
    mockGetByContextAllProducts
      .mockResolvedValueOnce({ data: { data: [successProduct] } })
      .mockRejectedValueOnce(new Error("Network error"));

    const ids = [
      "good",
      ...Array.from({ length: 100 }, (_, i) => `bad-${i}`),
    ];
    renderHook(() =>
      useBundleOptionProducts({ components: makeComponents(ids) })
    );
    const result = await capturedFetcher!();

    expect(result["good"]).toBeDefined();
    expect(Object.keys(result)).toHaveLength(1);
  });

  // -- Return shape --

  it("returns loading=true when query key is active", () => {
    const { result } = renderHook(() =>
      useBundleOptionProducts({ components: makeComponents(["a"]) })
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("exposes a refetch function", () => {
    const { result } = renderHook(() =>
      useBundleOptionProducts({ components: makeComponents(["a"]) })
    );
    result.current.refetch();
    expect(mockMutate).toHaveBeenCalled();
  });
});
