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

const mockEpGetBaseProducts = jest.fn();

jest.mock("../../ep-server-functions/getBaseProducts", () => ({
  epGetBaseProducts: (...args: any[]) => mockEpGetBaseProducts(...args),
}));

jest.mock("../../shopper-context/EpCommerceContext", () => ({
  __esModule: true,
  useEpCommerce: () => ({ locale: "en-US" }),
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

function makeProduct(
  id: string,
  isParent: boolean,
  childProducts: any[] = []
) {
  return {
    id,
    attributes: { name: `Product ${id}`, base_product: isParent },
    relationships: isParent
      ? { children: { data: [{ id: `${id}-child1` }] } }
      : {},
    meta: {
      variation_matrix: isParent ? { red: `${id}-child1` } : undefined,
    },
    images: [],
    variations: isParent
      ? [
          {
            id: "color",
            name: "Color",
            options: [{ id: "red", name: "Red" }],
          },
        ]
      : [],
    childProducts,
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
    mockEpGetBaseProducts.mockResolvedValue({ p1: makeProduct("p1", true) });

    renderHook(() =>
      useParentProducts({ components: makeComponents(["p1"]) })
    );
    const result = await capturedFetcher!();

    expect(result["p1"].isParent).toBe(true);
    expect(result["p1"].variations).toHaveLength(1);
    expect(result["p1"].variationMatrix).toEqual({ red: "p1-child1" });
  });

  it("detects non-parent products", async () => {
    mockEpGetBaseProducts.mockResolvedValue({ s1: makeProduct("s1", false) });

    renderHook(() =>
      useParentProducts({ components: makeComponents(["s1"]) })
    );
    const result = await capturedFetcher!();

    expect(result["s1"].isParent).toBe(false);
    expect(result["s1"].variations).toEqual([]);
  });

  // -- Fetcher: child variations --

  it("carries each parent's children through", async () => {
    mockEpGetBaseProducts.mockResolvedValue({
      p1: makeProduct("p1", true, [
        {
          id: "child-1",
          name: "Child 1",
          sku: "C1-SKU",
          price: { formatted: "$10.00" },
          bundleExcluded: true,
          optionIds: [],
          images: [],
        },
      ]),
    });

    renderHook(() =>
      useParentProducts({ components: makeComponents(["p1"]) })
    );
    const result = await capturedFetcher!();

    expect(result["p1"].children).toEqual([
      {
        id: "child-1",
        name: "Child 1",
        sku: "C1-SKU",
        price: "$10.00",
        excluded: true,
      },
    ]);
    expect(result["p1"].loading).toBe(false);
  });

  it("asks the server function for every id in the key", async () => {
    mockEpGetBaseProducts.mockResolvedValue({});

    renderHook(() =>
      useParentProducts({ components: makeComponents(["b", "a"]) })
    );
    await capturedFetcher!();

    expect(mockEpGetBaseProducts).toHaveBeenCalledWith({
      productIds: ["a", "b"],
    });
  });

  // -- Fetcher: missing products --

  it("marks missing products as non-parent with error", async () => {
    mockEpGetBaseProducts.mockResolvedValue({});

    renderHook(() =>
      useParentProducts({ components: makeComponents(["missing"]) })
    );
    const result = await capturedFetcher!();

    expect(result["missing"].isParent).toBe(false);
    expect(result["missing"].error).toBeDefined();
    expect(result["missing"].error!.message).toContain("missing");
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
