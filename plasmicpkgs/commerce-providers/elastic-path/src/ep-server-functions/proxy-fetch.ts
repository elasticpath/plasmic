/**
 * Browser-side proxy fetch for the EP server functions. The registered `ep*`
 * functions run in the browser with no AsyncLocalStorage session, so they POST
 * to a route on the consumer app that reads the better-auth session cookie SSR
 * also reads, dispatches, and returns the JSON result.
 *
 * SSR never reaches this: `getCurrentEpSession()` is already populated, so the
 * function fetches EP directly.
 */
import { EP_AUTH_BASE_PATH } from "../ep-auth-base-path";
import { makeEpCallError, readEpCallError } from "./call-error";
import { callEpDesign } from "./design-fetch";
import { currentEpDesignRealm } from "./design-realm";

const PROXY_PATH = `${EP_AUTH_BASE_PATH}/proxy`;

export function shouldUseProxy(): boolean {
  return typeof window !== "undefined";
}

function resolveProxyUrl(fnName: string): string {
  return `${PROXY_PATH}/${fnName}`;
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
