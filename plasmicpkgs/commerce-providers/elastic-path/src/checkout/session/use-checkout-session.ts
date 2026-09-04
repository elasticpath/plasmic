/**
 * useCheckoutSession — SWR-cached hook for the checkout session model.
 *
 * Fetches the current session from GET {apiBaseUrl}/checkout/sessions/current
 * and provides mutation helpers that call the corresponding session endpoints
 * then refresh the SWR cache.
 */
import { useCallback } from "react";
import useSWR from "swr";
import type {
  ClientCheckoutSession,
  UpdateSessionRequest,
} from "./types";

interface SessionApiResponse {
  success: boolean;
  data?: { session: ClientCheckoutSession | null };
  error?: { message: string; code?: string };
  paymentError?: string;
}

async function sessionFetch<T = SessionApiResponse>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  // Don't throw on non-2xx — session handlers encode errors in the body.
  // Only throw on network-level failures (handled by SWR).
  return res.json() as Promise<T>;
}

export interface UseCheckoutSessionReturn {
  session: ClientCheckoutSession | null;
  isLoading: boolean;
  error: Error | null;
  /** Create a new session for the given cart. */
  createSession: (cartId?: string) => Promise<SessionApiResponse>;
  /** Merge partial updates into the session. */
  updateSession: (data: UpdateSessionRequest) => Promise<SessionApiResponse>;
  /** Fetch shipping rates for the session's shipping address. */
  calculateShipping: () => Promise<SessionApiResponse>;
  /** Initiate payment with the registered gateway. */
  placeOrder: (gatewayData: Record<string, unknown>) => Promise<SessionApiResponse>;
  /** Resume a Stripe PaymentIntent after 3DS (POST …/resume-payment). */
  resumePayment: (resumeData?: Record<string, unknown>) => Promise<SessionApiResponse>;
  /**
   * Unlink the cart PaymentIntent after a failed/cancelled Stripe 3DS
   * challenge (POST …/abandon-payment).
   */
  abandonPayment: () => Promise<SessionApiResponse>;
  /** Confirm a gateway action (e.g. Clover 3DS). */
  confirmPayment: (confirmData: Record<string, unknown>) => Promise<SessionApiResponse>;
  /** Clear the session cookie and reset local state. */
  reset: () => Promise<void>;
  /** Force revalidation of the SWR cache. */
  refresh: () => Promise<void>;
}

export function useCheckoutSession(
  apiBaseUrl: string = "/api"
): UseCheckoutSessionReturn {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const sessionUrl = `${baseUrl}/checkout/sessions/current`;

  const { data, error, mutate } = useSWR<SessionApiResponse>(
    sessionUrl,
    (url: string) => sessionFetch(url),
    { revalidateOnFocus: false }
  );

  const session = data?.success ? (data.data?.session ?? null) : null;

  const createSession = useCallback(
    async (cartId?: string): Promise<SessionApiResponse> => {
      // cartId is optional — when omitted, the server resolves it from the
      // better-auth session (cookie-based). Designers don't have to thread
      // cartId through Plasmic interactions.
      const body = cartId ? JSON.stringify({ cartId }) : "{}";
      const resp = await sessionFetch<SessionApiResponse>(
        `${baseUrl}/checkout/sessions`,
        {
          method: "POST",
          body,
        }
      );
      await mutate();
      return resp;
    },
    [baseUrl, mutate]
  );

  const updateSession = useCallback(
    async (updateData: UpdateSessionRequest): Promise<SessionApiResponse> => {
      const resp = await sessionFetch<SessionApiResponse>(sessionUrl, {
        method: "PATCH",
        body: JSON.stringify(updateData),
      });
      await mutate();
      return resp;
    },
    [sessionUrl, mutate]
  );

  const calculateShipping = useCallback(async (): Promise<SessionApiResponse> => {
    const resp = await sessionFetch<SessionApiResponse>(
      `${sessionUrl}/shipping`,
      { method: "POST" }
    );
    await mutate();
    return resp;
  }, [sessionUrl, mutate]);

  const placeOrder = useCallback(
    async (gatewayData: Record<string, unknown>): Promise<SessionApiResponse> => {
      const resp = await sessionFetch<SessionApiResponse>(
        `${sessionUrl}/pay`,
        {
          method: "POST",
          body: JSON.stringify(gatewayData),
        }
      );
      await mutate();
      return resp;
    },
    [sessionUrl, mutate]
  );

  const resumePayment = useCallback(
    async (
      resumeData: Record<string, unknown> = {}
    ): Promise<SessionApiResponse> => {
      const resp = await sessionFetch<SessionApiResponse>(
        `${sessionUrl}/resume-payment`,
        {
          method: "POST",
          body: JSON.stringify(resumeData),
        }
      );
      await mutate();
      return resp;
    },
    [sessionUrl, mutate]
  );

  const abandonPayment = useCallback(async (): Promise<SessionApiResponse> => {
    const resp = await sessionFetch<SessionApiResponse>(
      `${sessionUrl}/abandon-payment`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    await mutate();
    return resp;
  }, [sessionUrl, mutate]);

  const confirmPayment = useCallback(
    async (confirmData: Record<string, unknown>): Promise<SessionApiResponse> => {
      const resp = await sessionFetch<SessionApiResponse>(
        `${sessionUrl}/confirm`,
        {
          method: "POST",
          body: JSON.stringify(confirmData),
        }
      );
      await mutate();
      return resp;
    },
    [sessionUrl, mutate]
  );

  const reset = useCallback(async () => {
    // Clear the cache — the next fetch will return null since cookie is gone
    // Consumer can also call DELETE endpoint if one is added later
    await mutate({ success: true, data: { session: null } }, false);
  }, [mutate]);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    session,
    isLoading: !data && !error,
    error: error ?? null,
    createSession,
    updateSession,
    calculateShipping,
    placeOrder,
    resumePayment,
    abandonPayment,
    confirmPayment,
    reset,
    refresh,
  };
}
