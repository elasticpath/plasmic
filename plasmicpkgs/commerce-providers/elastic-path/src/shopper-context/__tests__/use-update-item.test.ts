/** @jest-environment jsdom */

import { renderHook, act } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";
import { useUpdateItem } from "../use-update-item";

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
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useUpdateItem", () => {
  it("sends PUT /api/cart/items/{id} with quantity after debounce", async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useUpdateItem(), {
      wrapper: swrWrapper,
    });

    act(() => {
      result.current("item-abc", 3);
    });

    // Before debounce fires, no PUT should exist
    const putCallBefore = mockFetch.mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "PUT"
    );
    expect(putCallBefore).toBeUndefined();

    // Advance past debounce (500ms)
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    const putCall = mockFetch.mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "PUT"
    );
    expect(putCall).toBeDefined();

    const [url, init] = putCall!;
    expect(url).toBe("/api/ep/cart/items/item-abc");
    expect(init.method).toBe("PUT");

    const body = JSON.parse(init.body as string);
    expect(body.quantity).toBe(3);
  });

  it("debounces rapid calls — only last call fires", async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useUpdateItem(), {
      wrapper: swrWrapper,
    });

    // Rapid calls: 1, 2, 3 — only 3 should fire
    act(() => {
      result.current("item-abc", 1);
    });
    act(() => {
      result.current("item-abc", 2);
    });
    act(() => {
      result.current("item-abc", 3);
    });

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    const putCalls = mockFetch.mock.calls.filter(
      ([, init]: [string, RequestInit]) => init?.method === "PUT"
    );
    // Only one PUT should have been made (the last one with quantity 3)
    expect(putCalls).toHaveLength(1);

    const body = JSON.parse(putCalls[0][1].body as string);
    expect(body.quantity).toBe(3);
  });

  it("URL-encodes itemId to prevent path injection", async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useUpdateItem(), {
      wrapper: swrWrapper,
    });

    act(() => {
      result.current("item/../admin", 1);
    });

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    const putCall = mockFetch.mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "PUT"
    );
    const [url] = putCall!;
    expect(url).toBe(
      `/api/ep/cart/items/${encodeURIComponent("item/../admin")}`
    );
  });

  it("handles quantity 0 (server removes item)", async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useUpdateItem(), {
      wrapper: swrWrapper,
    });

    act(() => {
      result.current("item-abc", 0);
    });

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    const putCall = mockFetch.mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "PUT"
    );
    expect(putCall).toBeDefined();

    const body = JSON.parse(putCall![1].body as string);
    expect(body.quantity).toBe(0);
  });
});
