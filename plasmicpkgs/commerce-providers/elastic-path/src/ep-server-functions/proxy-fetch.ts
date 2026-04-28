/**
 * Browser-side proxy fetch for the EP server functions.
 *
 * Why this exists: in Studio canvas (and the data-query "Configure"
 * preview panel) the registered `ep*` functions run in a browser
 * context with no AsyncLocalStorage session and no reachable
 * EPCommerceProvider client (the picker preview runs in the Studio
 * main frame, separate from the canvas iframe). To still resolve real
 * data we POST to a route on the consumer app that:
 *   1. reads the better-auth session cookie that SSR also reads,
 *   2. dispatches to the matching `ep*` server function, and
 *   3. returns its JSON result.
 *
 * SSR (Node) NEVER hits this code path — `getCurrentEpSession()` is
 * already populated by `withEpSession`, so the function fetches EP
 * directly. The proxy is strictly a browser fallback, with zero
 * impact on the shopper-facing first render.
 *
 * Cross-origin note: when invoked from the canvas iframe (same origin
 * as the consumer app), the relative URL works without CORS. When
 * invoked from Studio's main frame at a different origin, set
 * `window.__epProxyOrigin = "http://localhost:3456"` (or equivalent)
 * before the call — the proxy route's CORS headers must allow that
 * origin and `credentials`.
 */

declare global {
  interface Window {
    /**
     * Optional absolute origin to fetch the EP proxy against. Used by
     * Studio data-query preview where Studio runs at a different
     * origin than the consumer Next app. Leave unset to use a relative
     * URL (same-origin canvas-iframe case).
     */
    __epProxyOrigin?: string;
  }
}

const PROXY_PATH = "/api/ep/proxy";

export function shouldUseProxy(): boolean {
  return typeof window !== "undefined";
}

function resolveProxyUrl(fnName: string): string {
  if (typeof window === "undefined") {
    return `${PROXY_PATH}/${fnName}`;
  }
  // 1. explicit pin (consumer can set if needed): `window.__epProxyOrigin`
  // 2. ELSE detect: when the page is hosted at the consumer's origin,
  //    `location.origin` already points at the right server. When the
  //    code is running inside Studio at a different origin (e.g.
  //    localhost:3003) and the consumer dev host is on another port
  //    (localhost:3456), the consumer must publish that origin via
  //    `window.__epProxyOrigin` (the `EPCommerceProvider` doesn't know
  //    it because its props don't include the dev host). Without a
  //    pin, the relative URL resolves against the current document
  //    origin which won't carry the consumer's session cookies.
  const origin = window.__epProxyOrigin;
  return origin
    ? `${origin.replace(/\/$/, "")}${PROXY_PATH}/${fnName}`
    : `${PROXY_PATH}/${fnName}`;
}

/**
 * Calls `<fnName>` via the consumer's EP proxy route with the supplied
 * args as the JSON body. Returns the parsed JSON on success, or
 * `fallback` on any failure (network error, non-2xx, parse error).
 */
export async function callEpProxy<T>(
  fnName: string,
  args: Record<string, unknown>,
  fallback?: T
): Promise<T> {
  const url = resolveProxyUrl(fnName);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch {
    return (fallback ?? null) as T;
  }
  if (!res.ok) {
    return (fallback ?? null) as T;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return (fallback ?? null) as T;
  }
}
