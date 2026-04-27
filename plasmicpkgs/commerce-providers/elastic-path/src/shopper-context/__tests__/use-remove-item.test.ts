/** @jest-environment jsdom */

import { renderHook, act } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";
import { useRemoveItem } from "../use-remove-item";

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

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

describe("useRemoveItem", () => {
  it("sends DELETE /api/cart/items/{id}", async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useRemoveItem(), {
      wrapper: swrWrapper,
    });

    await act(async () => {
      await result.current("item-abc");
    });

    const deleteCall = mockFetch.mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "DELETE"
    );
    expect(deleteCall).toBeDefined();

    const [url, init] = deleteCall!;
    expect(url).toBe("/api/ep/cart/items/item-abc");
    expect(init.method).toBe("DELETE");
  });

  it("URL-encodes itemId to prevent path injection", async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useRemoveItem(), {
      wrapper: swrWrapper,
    });

    await act(async () => {
      await result.current("item/../../secret");
    });

    const deleteCall = mockFetch.mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "DELETE"
    );
    const [url] = deleteCall!;
    expect(url).toBe(
      `/api/ep/cart/items/${encodeURIComponent("item/../../secret")}`
    );
    // Must not contain raw slashes from the item ID
    expect(url).not.toContain("item/../../secret");
  });

  it("triggers cart refetch after successful removal", async () => {
    mockFetchSuccess({ items: [], meta: null });

    const { result } = renderHook(() => useRemoveItem(), {
      wrapper: swrWrapper,
    });

    await act(async () => {
      await result.current("item-abc");
    });

    // After DELETE, mutate() triggers refetch of /api/cart
    const allCalls = mockFetch.mock.calls;
    const deleteIndex = allCalls.findIndex(
      ([, init]: [string, RequestInit]) => init?.method === "DELETE"
    );
    // There should be fetch calls after the DELETE (the mutate refetch)
    expect(allCalls.length).toBeGreaterThan(deleteIndex + 1);
  });
});
