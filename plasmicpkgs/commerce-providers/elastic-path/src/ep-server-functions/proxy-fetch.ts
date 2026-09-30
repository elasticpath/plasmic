/**
 * Browser-side proxy fetch for the EP server functions.
 *
 * Why this exists: in the browser the registered `ep*` server functions run
 * with no AsyncLocalStorage session, so to resolve real data we POST to a
 * route on the consumer app that:
 *   1. reads the better-auth session cookie that SSR also reads,
 *   2. dispatches to the matching `ep*` server function, and
 *   3. returns its JSON result.
 *
 * SSR (Node) NEVER hits this code path — `getCurrentEpSession()` is
 * already populated by `withEpSession`, so the function fetches EP
 * directly. The proxy is strictly a browser fallback, with zero
 * impact on the shopper-facing first render.
 *
 * Design time does not come through here. Both Studio realms — the canvas
 * artboard and the app-host document that resolves the data-query Configure
 * panel — are decided in `callEpProxy` before the request and served by the
 * session-free design route instead. That branch is a fork, never a retry: a
 * proxy failure must not fall through to a route that cannot see the shopper,
 * or a logged-in shopper with a just-expired envelope is silently served
 * unscoped prices.
 *
 * The URL is relative. Both design realms and the canvas are served by the
 * consumer's own document, so there is no cross-origin case to pin an origin
 * for.
 */
import { readEpErrorCode } from "../browser-call";
import { makeEpCallError, readEpCallError } from "./call-error";
import { callEpDesign } from "./design-fetch";
import { currentEpDesignRealm } from "./design-realm";

const PROXY_PATH = "/api/ep/proxy";

export function shouldUseProxy(): boolean {
  return typeof window !== "undefined";
}

function resolveProxyUrl(fnName: string): string {
  return `${PROXY_PATH}/${fnName}`;
}

/**
 * Reads the machine-readable `code` a thrown proxy error carries, or
 * `undefined` for errors from elsewhere. Branch on this rather than on message
 * text — the proxy route withholds `message` in production.
 */
export function epProxyErrorCode(err: unknown): string | undefined {
  return readEpErrorCode(err);
}

/**
 * Calls `<fnName>` via the consumer's EP proxy route with the supplied
 * args as the JSON body.
 *
 * Soft vs hard failure:
 * - When `fallback` is **passed** (including `null`), network / non-2xx /
 *   parse errors return that value — used by read paths (`getCart`,
 *   `getProduct`, …) that prefer empty UI over throwing.
 * - When `fallback` is **omitted**, failures throw so mutation callers
 *   (add to cart, place order, adjustments) surface the real error.
 */
export function callEpProxy<T>(
  fnName: string,
  args: Record<string, unknown>,
  fallback?: T
): Promise<T> {
  // Detect "fallback was passed" via `arguments` on a sync wrapper —
  // `arguments` is illegal inside async functions under our TS target.
  const softFail = arguments.length >= 3;
  // One fork, taken before the request. Design time never reaches the session
  // proxy and a proxy failure never reaches the design route.
  const realm = currentEpDesignRealm();
  if (realm) {
    return callEpDesign(fnName, args, fallback as T, realm);
  }
  return callEpProxyImpl(fnName, args, softFail, fallback as T);
}

async function callEpProxyImpl<T>(
  fnName: string,
  args: Record<string, unknown>,
  softFail: boolean,
  fallback: T
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
  } catch (err) {
    if (softFail) return fallback;
    throw err instanceof Error
      ? err
      : new Error(`ep proxy ${fnName}: network error`);
  }
  if (!res.ok) {
    if (softFail) return fallback;
    throw makeEpCallError(await readEpCallError(res, `ep proxy ${fnName}`));
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    if (softFail) return fallback;
    throw err instanceof Error
      ? err
      : new Error(`ep proxy ${fnName}: invalid JSON response`);
  }
}
