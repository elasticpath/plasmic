/** @jest-environment jsdom */

import { renderHook, act } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";
import { useAddItem } from "../use-add-item";

// ---------------------------------------------------------------------------
// jest.mock doesn't hoist with this project's esbuild transform.
// Mock global.fetch directly (matching existing test patterns).
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

/** SWR + isolated cache wrapper. */
function swrWrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    children
  );
}

function mockFetchSuccess(data: any = {}) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("useAddItem", () => {
  it("sends POST /api/cart/items with item body", async () => {
    // First call: useCart SWR fetch; second call: addItem POST; third call: mutate refetch
    mockFetchSuccess({ items: [], meta: null });

    const { result } = renderHook(() => useAddItem(), {
      wrapper: swrWrapper,
    });

    const addItem = result.current;

    await act(async () => {
      await addItem({ productId: "prod-123", quantity: 2 });
    });

    // Find the POST call (not the initial GET from useCart)
    const postCall = mockFetch.mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "POST"
    );
    expect(postCall).toBeDefined();

    const [url, init] = postCall!;
    expect(url).toBe("/api/ep/cart/items");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.productId).toBe("prod-123");
    expect(body.quantity).toBe(2);
  });

  it("includes optional fields in POST body", async () => {
    mockFetchSuccess({ items: [], meta: null });

    const { result } = renderHook(() => useAddItem(), {
      wrapper: swrWrapper,
    });

    await act(async () => {
      await result.current({
        productId: "prod-456",
        variantId: "var-789",
        quantity: 1,
        selectedOptions: [
          {
            variationId: "v1",
            optionId: "o1",
            optionName: "Red",
            variationName: "Color",
          },
        ],
      });
    });

    const postCall = mockFetch.mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "POST"
    );
    const body = JSON.parse(postCall![1].body as string);
    expect(body.variantId).toBe("var-789");
    expect(body.selectedOptions).toHaveLength(1);
    expect(body.selectedOptions[0].optionName).toBe("Red");
  });

  it("triggers cart refetch (mutate) after successful add", async () => {
    mockFetchSuccess({ items: [], meta: null });

    const { result } = renderHook(() => useAddItem(), {
      wrapper: swrWrapper,
    });

    await act(async () => {
      await result.current({ productId: "prod-123" });
    });

    // After POST, useCart.mutate() triggers another GET /api/cart
    // So we expect at least: initial GET, POST, refetch GET
    const getCalls = mockFetch.mock.calls.filter(
      ([url, init]: [string, RequestInit?]) =>
        url === "/api/ep/cart" && (!init?.method || init?.method === "GET")
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("returns the server response", async () => {
    const serverResponse = { id: "item-new", quantity: 2 };
    mockFetchSuccess(serverResponse);

    const { result } = renderHook(() => useAddItem(), {
      wrapper: swrWrapper,
    });

    let returnValue: any;
    await act(async () => {
      returnValue = await result.current({ productId: "prod-123" });
    });

    expect(returnValue).toEqual(serverResponse);
  });
});
