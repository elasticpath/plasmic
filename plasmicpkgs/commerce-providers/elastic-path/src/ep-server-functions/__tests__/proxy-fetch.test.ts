/**
 * @jest-environment jsdom
 *
 * callEpProxy soft vs hard failure:
 * - omit fallback → throw (mutations)
 * - pass fallback (including null / []) → return fallback (reads)
 *
 * Empty successful JSON bodies (e.g. `null` or `[]` as the response body)
 * are returned as parsed JSON on 2xx; no current mutation caller treats a
 * successful empty body as failure at the proxy layer.
 */

const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { callEpProxy, epProxyErrorCode } = require("../proxy-fetch");

beforeEach(() => {
  mockFetch.mockReset();
  delete (window as any).__epProxyOrigin;
});

describe("callEpProxy", () => {
  it("returns parsed JSON on a successful response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cart-1" }),
    });

    await expect(callEpProxy("getCart", {})).resolves.toEqual({ id: "cart-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/ep/proxy/getCart",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });

  it("throws on network failure when fallback is omitted", async () => {
    mockFetch.mockRejectedValue(new Error("Failed to fetch"));

    await expect(callEpProxy("addCartItem", { productId: "p1" })).rejects.toThrow(
      "Failed to fetch"
    );
  });

  it("throws on non-2xx when fallback is omitted", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(callEpProxy("addCartItem", { productId: "p1" })).rejects.toThrow(
      /ep proxy addCartItem failed \(500\)/
    );
  });

  it("preserves the proxy/server error message on non-2xx", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "There is not enough stock to add" }),
    });

    await expect(callEpProxy("updateCartItem", { itemId: "i1" })).rejects.toThrow(
      "There is not enough stock to add"
    );
  });

  it("throws on invalid JSON when fallback is omitted", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Unexpected token");
      },
    });

    await expect(callEpProxy("addCartItem", { productId: "p1" })).rejects.toThrow(
      "Unexpected token"
    );
  });

  it("returns null when an explicit null fallback is passed", async () => {
    mockFetch.mockRejectedValue(new Error("Failed to fetch"));

    await expect(callEpProxy("getCart", {}, null)).resolves.toBeNull();
  });

  it("returns [] when an explicit empty-array fallback is passed", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: "unavailable" }),
    });

    await expect(callEpProxy("getProductList", {}, [])).resolves.toEqual([]);
  });

  it("returns a successful empty JSON array body without treating it as failure", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    await expect(callEpProxy("getProductList", {}, [])).resolves.toEqual([]);
  });
});

describe("callEpProxy error codes", () => {
  it("attaches the code and correlationId from the error body", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        error: "dispatch_failed",
        code: "insufficient_stock",
        correlationId: "abc-123",
      }),
    });

    const err = await callEpProxy("updateCartItem", { itemId: "i1" }).catch(
      (e: unknown) => e
    );

    expect(epProxyErrorCode(err)).toBe("insufficient_stock");
    expect((err as { correlationId?: string }).correlationId).toBe("abc-123");
  });

  it("exposes the code even when production withholds the message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        error: "dispatch_failed",
        code: "insufficient_stock",
        correlationId: "abc-123",
      }),
    });

    const err = await callEpProxy("updateCartItem", { itemId: "i1" }).catch(
      (e: unknown) => e
    );

    expect((err as Error).message).toBe("dispatch_failed");
    expect(epProxyErrorCode(err)).toBe("insufficient_stock");
  });

  it("surfaces no_session as a code on a 401 mutation rejection", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "no_session", code: "no_session" }),
    });

    const err = await callEpProxy("addCartItem", { productId: "p1" }).catch(
      (e: unknown) => e
    );

    expect(epProxyErrorCode(err)).toBe("no_session");
  });

  it("returns undefined for errors that carry no code", async () => {
    mockFetch.mockRejectedValue(new Error("Failed to fetch"));

    const err = await callEpProxy("addCartItem", { productId: "p1" }).catch(
      (e: unknown) => e
    );

    expect(epProxyErrorCode(err)).toBeUndefined();
    expect(epProxyErrorCode(new Error("plain"))).toBeUndefined();
    expect(epProxyErrorCode(undefined)).toBeUndefined();
  });
});
