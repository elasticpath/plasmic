/** @jest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";
import { useCart } from "../use-cart";
import { ShopperContext } from "../ShopperContext";

// ---------------------------------------------------------------------------
// jest.mock doesn't hoist with this project's esbuild transform.
// Instead, mock global.fetch directly (matching useShopperFetch.test.ts pattern).
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

/** SWRConfig wrapper isolating cache between tests. */
function swrWrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    children
  );
}

function swrWrapperWithCartId(cartId: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      SWRConfig,
      { value: { dedupingInterval: 0, provider: () => new Map() } },
      React.createElement(ShopperContext, { cartId }, children)
    );
  };
}

function mockFetchSuccess(data: any) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchError(message: string) {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 500,
    text: () => Promise.resolve(message),
  });
}

const SAMPLE_CART_DATA = {
  items: [
    {
      id: "item-1",
      type: "cart_item",
      product_id: "prod-1",
      name: "Test Candle",
      description: "A test candle",
      sku: "TC-001",
      slug: "test-candle",
      quantity: 2,
      meta: {
        display_price: {
          with_tax: {
            unit: { amount: 3800, formatted: "$38.00", currency: "USD" },
            value: { amount: 7600, formatted: "$76.00", currency: "USD" },
          },
          without_tax: {
            unit: { amount: 3500, formatted: "$35.00", currency: "USD" },
            value: { amount: 7000, formatted: "$70.00", currency: "USD" },
          },
        },
      },
    },
  ],
  meta: {
    display_price: {
      with_tax: { amount: 7600, formatted: "$76.00", currency: "USD" },
      without_tax: { amount: 7000, formatted: "$70.00", currency: "USD" },
      tax: { amount: 600, formatted: "$6.00", currency: "USD" },
    },
  },
};

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCart", () => {
  it("fetches from /api/cart and returns data", async () => {
    mockFetchSuccess(SAMPLE_CART_DATA);

    const { result } = renderHook(() => useCart(), { wrapper: swrWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // useShopperFetch calls fetch with the path as first arg
    expect(mockFetch).toHaveBeenCalled();
    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toBe("/api/cart");

    expect(result.current.data).toEqual(SAMPLE_CART_DATA);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns isLoading true initially before data arrives", () => {
    // Never resolve
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useCart(), { wrapper: swrWrapper });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isEmpty).toBe(true);
  });

  it("returns error when fetch responds with non-ok status", async () => {
    mockFetchError("Internal Server Error");

    const { result } = renderHook(() => useCart(), { wrapper: swrWrapper });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error!.message).toContain("Internal Server Error");
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("reports isEmpty when cart has no items", async () => {
    mockFetchSuccess({ items: [], meta: null });

    const { result } = renderHook(() => useCart(), { wrapper: swrWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isEmpty).toBe(true);
  });

  it("works with cartId override (different SWR cache key)", async () => {
    mockFetchSuccess(SAMPLE_CART_DATA);

    const { result } = renderHook(() => useCart(), {
      wrapper: swrWrapperWithCartId("cart-abc"),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(SAMPLE_CART_DATA);

    // Verify X-Shopper-Context header was sent (cartId override present)
    const fetchInit = mockFetch.mock.calls[0][1];
    const headers = new Headers(fetchInit.headers);
    const contextHeader = headers.get("X-Shopper-Context");
    expect(contextHeader).toBeTruthy();
    expect(JSON.parse(contextHeader!)).toEqual({ cartId: "cart-abc" });
  });

  it("exposes mutate function", async () => {
    mockFetchSuccess(SAMPLE_CART_DATA);

    const { result } = renderHook(() => useCart(), { wrapper: swrWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.mutate).toBe("function");
  });
});
