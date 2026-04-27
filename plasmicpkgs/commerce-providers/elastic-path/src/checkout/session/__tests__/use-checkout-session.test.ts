/**
 * @jest-environment jsdom
 *
 * A-10.10: useCheckoutSession hook tests
 *
 * Covers: SWR fetch on mount, mutation helpers (createSession, updateSession,
 * calculateShipping, placeOrder, confirmPayment, reset), URL construction,
 * and error handling.
 *
 * We mock SWR and global.fetch to test the hook's API call patterns without
 * real network requests. The hook is tested via renderHook from
 * @testing-library/react.
 */

// Set up global.fetch as a jest mock before any test code runs
global.fetch = jest.fn();

// Mock SWR — we need to control what useSWR returns and capture the fetcher
let mockSWRData: any = undefined;
let mockSWRError: any = undefined;
const mockMutate = jest.fn().mockResolvedValue(undefined);

jest.mock("swr", () => ({
  __esModule: true,
  default: jest.fn((key: string, fetcher: any, _opts: any) => {
    // Store the fetcher so tests can invoke it if needed
    (jest.requireMock("swr") as any).__lastFetcher = fetcher;
    (jest.requireMock("swr") as any).__lastKey = key;
    return {
      data: mockSWRData,
      error: mockSWRError,
      mutate: mockMutate,
    };
  }),
}));

import { renderHook, act } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useCheckoutSession } = require("../use-checkout-session") as {
  useCheckoutSession: typeof import("../use-checkout-session").useCheckoutSession;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const useSWR = require("swr").default as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    json: () => Promise.resolve(body),
    status,
    ok: status >= 200 && status < 300,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCheckoutSession", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSWRData = undefined;
    mockSWRError = undefined;
    (global.fetch as jest.Mock).mockReset();
  });

  describe("initialization", () => {
    it("calls useSWR with the correct session URL", () => {
      renderHook(() => useCheckoutSession("/api"));
      expect(useSWR).toHaveBeenCalledWith(
        "/api/checkout/sessions/current",
        expect.any(Function),
        expect.objectContaining({ revalidateOnFocus: false })
      );
    });

    it("strips trailing slashes from apiBaseUrl", () => {
      renderHook(() => useCheckoutSession("/api///"));
      expect(useSWR).toHaveBeenCalledWith(
        "/api/checkout/sessions/current",
        expect.any(Function),
        expect.any(Object)
      );
    });

    it("defaults apiBaseUrl to /api", () => {
      renderHook(() => useCheckoutSession());
      expect(useSWR).toHaveBeenCalledWith(
        "/api/checkout/sessions/current",
        expect.any(Function),
        expect.any(Object)
      );
    });
  });

  describe("return values — loading state", () => {
    it("returns isLoading: true when no data and no error", () => {
      mockSWRData = undefined;
      mockSWRError = undefined;
      const { result } = renderHook(() => useCheckoutSession("/api"));
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading: false when data is present", () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };
      const { result } = renderHook(() => useCheckoutSession("/api"));
      expect(result.current.isLoading).toBe(false);
    });

    it("returns isLoading: false when error is present", () => {
      mockSWRError = new Error("Network error");
      const { result } = renderHook(() => useCheckoutSession("/api"));
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("return values — session extraction", () => {
    it("returns session from successful response", () => {
      const mockSession = { id: "sess-1", status: "open" };
      mockSWRData = { success: true, data: { session: mockSession } };
      const { result } = renderHook(() => useCheckoutSession("/api"));
      expect(result.current.session).toEqual(mockSession);
    });

    it("returns null session when response success is false", () => {
      mockSWRData = { success: false, error: { message: "Oops" } };
      const { result } = renderHook(() => useCheckoutSession("/api"));
      expect(result.current.session).toBeNull();
    });

    it("returns null session when data.session is null", () => {
      mockSWRData = { success: true, data: { session: null } };
      const { result } = renderHook(() => useCheckoutSession("/api"));
      expect(result.current.session).toBeNull();
    });

    it("returns error from SWR when present", () => {
      const err = new Error("Fetch failed");
      mockSWRError = err;
      const { result } = renderHook(() => useCheckoutSession("/api"));
      expect(result.current.error).toBe(err);
    });

    it("returns null error when no SWR error", () => {
      mockSWRData = { success: true, data: { session: null } };
      const { result } = renderHook(() => useCheckoutSession("/api"));
      expect(result.current.error).toBeNull();
    });
  });

  describe("createSession", () => {
    it("calls POST /checkout/sessions with cartId", async () => {
      mockSWRData = { success: true, data: { session: null } };
      mockFetchResponse({ success: true, data: { session: { id: "new" } } });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.createSession("cart-abc");
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/checkout/sessions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ cartId: "cart-abc" }),
          credentials: "same-origin",
        })
      );
    });

    it("calls mutate after creating session", async () => {
      mockSWRData = { success: true, data: { session: null } };
      mockFetchResponse({ success: true, data: { session: { id: "new" } } });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.createSession("cart-abc");
      });

      expect(mockMutate).toHaveBeenCalled();
    });
  });

  describe("updateSession", () => {
    it("calls PATCH /checkout/sessions/current with update data", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };
      mockFetchResponse({ success: true, data: { session: { id: "s1" } } });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      const updateData = { customerInfo: { name: "Test", email: "t@e.com" } };
      await act(async () => {
        await result.current.updateSession(updateData as any);
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/checkout/sessions/current",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify(updateData),
        })
      );
    });

    it("calls mutate after updating session", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };
      mockFetchResponse({ success: true });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.updateSession({ selectedShippingRateId: "r1" } as any);
      });

      expect(mockMutate).toHaveBeenCalled();
    });
  });

  describe("calculateShipping", () => {
    it("calls POST /checkout/sessions/current/shipping", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };
      mockFetchResponse({ success: true, data: { session: { id: "s1" } } });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.calculateShipping();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/checkout/sessions/current/shipping",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("calls mutate after calculating shipping", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };
      mockFetchResponse({ success: true });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.calculateShipping();
      });

      expect(mockMutate).toHaveBeenCalled();
    });
  });

  describe("placeOrder", () => {
    it("calls POST /checkout/sessions/current/pay with gateway data", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };
      const gwData = { gateway: "stripe", token: "tok_123" };
      mockFetchResponse({ success: true });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.placeOrder(gwData);
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/checkout/sessions/current/pay",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(gwData),
        })
      );
    });

    it("calls mutate after placing order", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };
      mockFetchResponse({ success: true });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.placeOrder({ gateway: "clover" });
      });

      expect(mockMutate).toHaveBeenCalled();
    });
  });

  describe("confirmPayment", () => {
    it("calls POST /checkout/sessions/current/confirm with confirm data", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };
      const confirmData = { stage: "method", flowStatus: "Y" };
      mockFetchResponse({ success: true });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.confirmPayment(confirmData);
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/checkout/sessions/current/confirm",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(confirmData),
        })
      );
    });

    it("calls mutate after confirming payment", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };
      mockFetchResponse({ success: true });

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.confirmPayment({ paymentIntentId: "pi_123" });
      });

      expect(mockMutate).toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("calls mutate with null session data (optimistic clear)", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.reset();
      });

      expect(mockMutate).toHaveBeenCalledWith(
        { success: true, data: { session: null } },
        false
      );
    });

    it("does not call fetch (no network request)", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.reset();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("refresh", () => {
    it("calls mutate to revalidate SWR cache", async () => {
      mockSWRData = { success: true, data: { session: { id: "s1" } } };

      const { result } = renderHook(() => useCheckoutSession("/api"));
      await act(async () => {
        await result.current.refresh();
      });

      expect(mockMutate).toHaveBeenCalledWith();
    });
  });

  describe("SWR fetcher", () => {
    it("fetcher uses sessionFetch which calls global.fetch", async () => {
      mockSWRData = undefined;
      renderHook(() => useCheckoutSession("/api"));

      // Get the fetcher that was passed to useSWR
      const swr = require("swr") as any;
      const fetcher = swr.__lastFetcher;
      expect(fetcher).toBeDefined();

      mockFetchResponse({ success: true, data: { session: null } });
      const result = await fetcher("/api/checkout/sessions/current");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/checkout/sessions/current",
        expect.objectContaining({
          credentials: "same-origin",
        })
      );
      expect(result).toEqual({ success: true, data: { session: null } });
    });
  });
});
