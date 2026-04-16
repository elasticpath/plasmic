/** @jest-environment jsdom */

import React from "react";
import { renderHook, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import { ShopperContext } from "../../shopper-context/ShopperContext";
import { useCart } from "../../shopper-context/use-cart";
import { useAddItem } from "../../shopper-context/use-add-item";
import { useRemoveItem } from "../../shopper-context/use-remove-item";
import { useUpdateItem } from "../../shopper-context/use-update-item";

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: [], meta: {} }),
    text: () => Promise.resolve("{}"),
  });
});

function wrapper(basePath?: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      SWRConfig,
      { value: { dedupingInterval: 0, provider: () => new Map() } },
      React.createElement(
        ShopperContext,
        { cartId: "cart-123", basePath },
        children
      )
    );
  };
}

describe("basePath alignment", () => {
  it("useCart uses default /api/ep basePath", async () => {
    const { result, unmount } = renderHook(() => useCart(), {
      wrapper: wrapper(),
    });

    // Wait for SWR to fire
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const fetchUrl = mockFetch.mock.calls[0]?.[0];
    expect(fetchUrl).toBe("/api/ep/cart");
    unmount();
  });

  it("useCart uses custom basePath from ShopperContext", async () => {
    const { result, unmount } = renderHook(() => useCart(), {
      wrapper: wrapper("/api/store"),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const fetchUrl = mockFetch.mock.calls[0]?.[0];
    expect(fetchUrl).toBe("/api/store/cart");
    unmount();
  });
});
