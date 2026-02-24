/**
 * @jest-environment jsdom
 */

// Tests for the SWR-based useParentProducts hook.
// Verifies query key construction, fetcher logic (parent detection, child fetching,
// batch processing), and disabled-state handling.

import { renderHook } from "@testing-library/react";
import type { ComponentProduct } from "../types";

// --- Mocks (must come before require() of code under test) ---------------
// NOTE: esbuild hoists `import` to require() at the top, BEFORE jest.mock
// calls. Use require() for modules whose deps need mocking so they load
// AFTER mocks are registered.

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
const mockGetByContextChildProducts = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getByContextAllProducts: (...args: any[]) =>
    mockGetByContextAllProducts(...args),
  getByContextChildProducts: (...args: any[]) =>
    mockGetByContextChildProducts(...args),
}));

const mockClient = { baseUrl: "https://test.epcc.io" };
jest.mock("../../elastic-path", () => ({
  __esModule: true,
  useCommerce: () => ({
    providerRef: { current: { client: mockClient } },
  }),
}));

// Import under test AFTER mocks — require() is not hoisted by esbuild
const { useParentProducts } =
  require("../use-parent-products") as typeof import("../use-parent-products");

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

function makeProduct(id: string, isParent: boolean) {
  return {
    id,
    attributes: { name: `Product ${id}`, base_product: isParent },
    relationships: isParent
      ? { children: { data: [{ id: `${id}-child1` }] } }
      : {},
    meta: {
      variations: isParent
        ? [
            {
              id: "color",
              name: "Color",
              options: [{ id: "red", name: "Red" }],
            },
          ]
        : [],
      variation_matrix: isParent ? { red: `${id}-child1` } : undefined,
    },
  };
}

// --- Tests ---------------------------------------------------------------

describe("useParentProducts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedQueryKey = null;
    capturedFetcher = null;
  });

  // -- Query key construction --

  it("sets query key to null when disabled", () => {
    renderHook(() =>
      useParentProducts({ components: makeComponents(["a"]), enabled: false })
    );
    expect(capturedQueryKey).toBeNull();
  });

  it("sets query key to null when components have no options", () => {
    renderHook(() =>
      useParentProducts({
        components: { comp1: { name: "Empty", options: [] } },
      })
    );
    expect(capturedQueryKey).toBeNull();
  });

  it("constructs a sorted, stable query key from component option IDs", () => {
    renderHook(() =>
      useParentProducts({
        components: makeComponents(["z-id", "a-id", "m-id"]),
      })
    );
    expect(capturedQueryKey).toEqual([
      "ep-parent-products",
      "a-id,m-id,z-id",
    ]);
  });

  it("deduplicates product IDs in the query key", () => {
    const components: Record<string, ComponentProduct> = {
      comp1: {
        name: "C1",
        options: [
          { id: "dup", type: "product", quantity: 1 },
          { id: "dup", type: "product", quantity: 1 },
        ],
      },
    };
    renderHook(() => useParentProducts({ components }));
    expect(capturedQueryKey).toEqual(["ep-parent-products", "dup"]);
  });

  // -- Fetcher: parent detection --

  it("detects parent products via base_product attribute", async () => {
    const parentProd = makeProduct("p1", true);
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [parentProd] },
    });
    mockGetByContextChildProducts.mockResolvedValue({
      data: { data: [] },
    });

    renderHook(() =>
      useParentProducts({ components: makeComponents(["p1"]) })
    );
    const result = await capturedFetcher!();

    expect(result["p1"].isParent).toBe(true);
    expect(result["p1"].variations).toHaveLength(1);
    expect(result["p1"].variationMatrix).toEqual({ red: "p1-child1" });
  });

  it("detects non-parent products", async () => {
    const simpleProd = makeProduct("s1", false);
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [simpleProd] },
    });

    renderHook(() =>
      useParentProducts({ components: makeComponents(["s1"]) })
    );
    const result = await capturedFetcher!();

    expect(result["s1"].isParent).toBe(false);
    expect(result["s1"].variations).toEqual([]);
  });

  // -- Fetcher: child fetching --

  it("fetches children for parent products", async () => {
    const parentProd = makeProduct("p1", true);
    const childProd = {
      id: "child-1",
      attributes: { name: "Child 1", sku: "C1-SKU" },
      meta: { display_price: { without_tax: { formatted: "$10.00" } } },
    };

    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [parentProd] },
    });
    mockGetByContextChildProducts.mockResolvedValue({
      data: { data: [childProd] },
    });

    renderHook(() =>
      useParentProducts({ components: makeComponents(["p1"]) })
    );
    const result = await capturedFetcher!();

    expect(mockGetByContextChildProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        client: mockClient,
        path: { product_id: "p1" },
      })
    );
    expect(result["p1"].children).toEqual([
      expect.objectContaining({
        id: "child-1",
        name: "Child 1",
        sku: "C1-SKU",
        price: "$10.00",
      }),
    ]);
    expect(result["p1"].loading).toBe(false);
  });

  it("does not fetch children for non-parent products", async () => {
    const simpleProd = makeProduct("s1", false);
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [simpleProd] },
    });

    renderHook(() =>
      useParentProducts({ components: makeComponents(["s1"]) })
    );
    await capturedFetcher!();

    expect(mockGetByContextChildProducts).not.toHaveBeenCalled();
  });

  // -- Fetcher: missing products --

  it("marks missing products as non-parent with error", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [] },
    });

    renderHook(() =>
      useParentProducts({ components: makeComponents(["missing"]) })
    );
    const result = await capturedFetcher!();

    expect(result["missing"].isParent).toBe(false);
    expect(result["missing"].error).toBeDefined();
    expect(result["missing"].error!.message).toContain("missing");
  });

  // -- Fetcher: batch processing --

  it("batch-fetches products when there are more than 100 IDs", async () => {
    const ids = Array.from(
      { length: 150 },
      (_, i) => `id-${String(i).padStart(3, "0")}`
    );
    mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });

    renderHook(() =>
      useParentProducts({ components: makeComponents(ids) })
    );
    await capturedFetcher!();

    expect(mockGetByContextAllProducts).toHaveBeenCalledTimes(2);
  });

  // -- Fetcher: error handling --

  it("handles child fetch errors gracefully", async () => {
    const parentProd = makeProduct("p1", true);
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [parentProd] },
    });
    mockGetByContextChildProducts.mockRejectedValue(
      new Error("Network error")
    );

    renderHook(() =>
      useParentProducts({ components: makeComponents(["p1"]) })
    );
    const result = await capturedFetcher!();

    expect(result["p1"].isParent).toBe(true);
    expect(result["p1"].children).toEqual([]);
    expect(result["p1"].error).toBeDefined();
  });

  // -- Return shape --

  it("returns loading=true when query key is active", () => {
    const { result } = renderHook(() =>
      useParentProducts({ components: makeComponents(["p1"]) })
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("exposes a refetch function", () => {
    const { result } = renderHook(() =>
      useParentProducts({ components: makeComponents(["p1"]) })
    );
    result.current.refetch();
    expect(mockMutate).toHaveBeenCalled();
  });
});
