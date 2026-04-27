/** @jest-environment jsdom */
import React from "react";
import { renderHook } from "@testing-library/react";
import { useShopperFetch } from "../useShopperFetch";
import { ShopperContext } from "../ShopperContext";

// Mock global fetch
const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function wrapper(overrides: Record<string, string> = {}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(ShopperContext, overrides, children);
  };
}

describe("useShopperFetch", () => {
  it("attaches X-Shopper-Context header when overrides are present", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });

    const { result } = renderHook(() => useShopperFetch(), {
      wrapper: wrapper({ cartId: "cart-abc" }),
    });

    await result.current("/api/cart");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/cart");

    const headers = new Headers(init.headers);
    const headerValue = headers.get("X-Shopper-Context");
    expect(headerValue).toBeTruthy();
    const parsed = JSON.parse(headerValue!);
    expect(parsed.cartId).toBe("cart-abc");
  });

  it("omits X-Shopper-Context header when no overrides", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });

    const { result } = renderHook(() => useShopperFetch(), {
      wrapper: wrapper(),
    });

    await result.current("/api/cart");

    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.has("X-Shopper-Context")).toBe(false);
  });

  it("sets Content-Type to application/json by default", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useShopperFetch(), {
      wrapper: wrapper(),
    });

    await result.current("/api/cart");

    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("preserves existing Content-Type header", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useShopperFetch(), {
      wrapper: wrapper(),
    });

    await result.current("/api/cart", {
      headers: { "Content-Type": "text/plain" },
    });

    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("text/plain");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const { result } = renderHook(() => useShopperFetch(), {
      wrapper: wrapper(),
    });

    await expect(result.current("/api/cart")).rejects.toThrow(
      "Internal Server Error"
    );
  });

  it("uses credentials: same-origin", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useShopperFetch(), {
      wrapper: wrapper(),
    });

    await result.current("/api/cart");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.credentials).toBe("same-origin");
  });
});
