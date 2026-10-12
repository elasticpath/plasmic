/**
 * Reads the page request a server render belongs to, through `next/headers`.
 */
import { buildEpCtx } from "../../ep-server-functions/build-ep-ctx";
import type { EpRequestBridge } from "../../ep-server-functions/request-bridge";
import { parseCookieHeader } from "../../utils/cookie-header";
import type { EpSession } from "./create-ep-auth-better";

let nextHeaders: Promise<typeof import("next/headers.js")> | undefined;

/**
 * The page request's headers object, which Next.js hands every render of one
 * request as the same object. Null outside a request scope: static
 * generation, or not Next.js.
 */
export async function readPageRequestScope(): Promise<Headers | null> {
  try {
    nextHeaders ??= import("next/headers.js");
    const { headers } = await nextHeaders;
    return (await headers()) as unknown as Headers;
  } catch {
    return null;
  }
}

export async function readPageRequestHeaders(): Promise<Record<
  string,
  string
> | null> {
  const scope = await readPageRequestScope();
  return scope ? Object.fromEntries(scope.entries()) : null;
}

/**
 * Shares one `getSession` result among the callers in one page request, such
 * as the page and the catalog-search server pass, so a request mints and
 * refreshes its session once. Outside a request scope every call reads anew.
 */
export function memoizePerPageRequest<
  Req extends {
    cookies: Record<string, string>;
    headers?: Record<string, string | string[] | undefined>;
  },
  Result
>(read: (req: Req) => Promise<Result>): (req: Req) => Promise<Result> {
  const byScope = new WeakMap<object, Map<string, Promise<Result>>>();
  return async (req) => {
    const scope = await readPageRequestScope();
    if (!scope) return read(req);
    let byRequest = byScope.get(scope);
    if (!byRequest) {
      byRequest = new Map();
      byScope.set(scope, byRequest);
    }
    const key = requestKey(req);
    let result = byRequest.get(key);
    if (!result) {
      result = read(req);
      byRequest.set(key, result);
      const entries = byRequest;
      result.catch(() => entries.delete(key));
    }
    return result;
  };
}

function requestKey(req: {
  cookies: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const sorted = (entries: Array<[string, unknown]>) =>
    entries
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([
    sorted(Object.entries(req.cookies)),
    sorted(
      Object.entries(req.headers ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ])
    ),
  ]);
}

const CSP_NONCE = /'nonce-([^']+)'/;

export function createEpRequestBridge(
  getSession: (req: { cookies: Record<string, string> }) => Promise<EpSession>
): EpRequestBridge {
  return {
    version: 1,
    async requestSession() {
      try {
        const headers = await readPageRequestHeaders();
        if (!headers) return null;
        const session = await getSession({
          cookies: parseCookieHeader(headers.cookie ?? ""),
        });
        return buildEpCtx(session);
      } catch {
        return null;
      }
    },
    async requestNonce() {
      const headers = await readPageRequestHeaders();
      if (!headers) return undefined;
      return (
        headers["x-nonce"] ||
        CSP_NONCE.exec(headers["content-security-policy"] ?? "")?.[1] ||
        undefined
      );
    },
  };
}
