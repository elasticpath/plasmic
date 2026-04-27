import { useCallback } from "react";
import { useShopperContext } from "./useShopperContext";

/**
 * Returns a fetch function that auto-attaches X-Shopper-Context header
 * when ShopperContext has overrides (Studio preview or checkout URL).
 *
 * Consumer's API routes parse this header via resolveCartId() to resolve identity.
 */
export function useShopperFetch() {
  const overrides = useShopperContext();

  return useCallback(
    async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      // Only send header when there ARE active overrides
      const active = Object.fromEntries(
        Object.entries(overrides).filter(([, v]) => v != null)
      );
      if (Object.keys(active).length > 0) {
        headers.set("X-Shopper-Context", JSON.stringify(active));
      }

      const res = await fetch(path, {
        ...init,
        headers,
        credentials: "same-origin",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }

      return res.json() as Promise<T>;
    },
    [overrides]
  );
}
