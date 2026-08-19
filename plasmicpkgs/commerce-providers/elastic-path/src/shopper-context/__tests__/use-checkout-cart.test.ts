/** @jest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";
import { useCheckoutCart } from "../use-checkout-cart";

// ---------------------------------------------------------------------------
// Integration test: mock global.fetch, let real SWR + useCart + useCheckoutCart
// run. This tests the full normalization pipeline from raw EP response shape
// to flattened CheckoutCartData. jest.mock doesn't hoist with esbuild.
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function swrWrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    children
  );
}

/** Raw EP cart API response shape — what GET /api/cart returns. */
const RAW_CART_RESPONSE = {
  items: [
    {
      id: "item-1",
      type: "cart_item",
      product_id: "prod-candle",
      name: "Ember Glow Soy Candle",
      description: "A warm soy candle",
      sku: "EW-EMB-001",
      slug: "ember-glow",
      quantity: 2,
      image: { href: "https://example.com/candle.jpg" },
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
    {
      id: "item-2",
      type: "cart_item",
      product_id: "prod-diffuser",
      name: "Midnight Wick Reed Diffuser",
      description: "A reed diffuser",
      sku: "EW-MID-002",
      slug: "midnight-wick",
      quantity: 1,
      // No image — tests null fallback
      meta: {
        display_price: {
          with_tax: {
            unit: { amount: 2400, formatted: "$24.00", currency: "USD" },
            value: { amount: 2400, formatted: "$24.00", currency: "USD" },
          },
          without_tax: {
            unit: { amount: 2200, formatted: "$22.00", currency: "USD" },
            value: { amount: 2200, formatted: "$22.00", currency: "USD" },
          },
        },
      },
    },
  ],
  meta: {
    display_price: {
      with_tax: { amount: 10825, formatted: "$108.25", currency: "USD" },
      without_tax: { amount: 10000, formatted: "$100.00", currency: "USD" },
      tax: { amount: 825, formatted: "$8.25", currency: "USD" },
    },
  },
};

function mockFetchSuccess(data: any) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCheckoutCart", () => {
  it("returns null when cart fetch has no data yet", () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // Never resolves

    const { result } = renderHook(() => useCheckoutCart(), {
      wrapper: swrWrapper,
    });

    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("returns an empty cart, not null, when the shopper has no items", async () => {
    // An empty cart used to be indistinguishable from one that had not loaded,
    // which is how an empty cart rendered "Loading cart…".
    mockFetchSuccess({ items: [], meta: null });

    const { result } = renderHook(() => useCheckoutCart(), {
      wrapper: swrWrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    expect(result.current.data!.items).toEqual([]);
    expect(result.current.data!.itemCount).toBe(0);
  });

  it("normalizes cart items with flattened price fields", async () => {
    mockFetchSuccess(RAW_CART_RESPONSE);

    const { result } = renderHook(() => useCheckoutCart(), {
      wrapper: swrWrapper,
    });

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    const data = result.current.data!;
    expect(data.items).toHaveLength(2);

    // First item — Elastic Path's line, verbatim, with the decimal filled in
    expect(data.items[0]).toMatchObject({
      id: "item-1",
      product_id: "prod-candle",
      name: "Ember Glow Soy Candle",
      sku: "EW-EMB-001",
      quantity: 2,
      image: { href: "https://example.com/candle.jpg" },
    });
    expect(data.items[0].meta?.display_price?.with_tax?.unit).toMatchObject({
      amount: 3800,
      formatted: "$38.00",
      float_price: 38,
    });

    expect(data.items[1].image).toBeUndefined();
    expect(data.items[1].product_id).toBe("prod-diffuser");
  });

  it("computes correct totals from cart meta", async () => {
    mockFetchSuccess(RAW_CART_RESPONSE);

    const { result } = renderHook(() => useCheckoutCart(), {
      wrapper: swrWrapper,
    });

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    const data = result.current.data!;
    const price = data.meta?.display_price;
    expect(price?.without_tax).toMatchObject({
      amount: 10000,
      formatted: "$100.00",
      float_price: 100,
    });
    expect(price?.tax).toMatchObject({ amount: 825, formatted: "$8.25" });
    expect(price?.with_tax).toMatchObject({
      amount: 10825,
      formatted: "$108.25",
    });
    expect(price?.without_tax?.currency).toBe("USD");
  });

  it("computes itemCount as sum of quantities", async () => {
    mockFetchSuccess(RAW_CART_RESPONSE);

    const { result } = renderHook(() => useCheckoutCart(), {
      wrapper: swrWrapper,
    });

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    // 2 (candle) + 1 (diffuser) = 3
    expect(result.current.data!.itemCount).toBe(3);
  });

  it("reports error when fetch fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server Error"),
    });

    const { result } = renderHook(() => useCheckoutCart(), {
      wrapper: swrWrapper,
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeNull();
  });
});
