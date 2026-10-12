/**
 * Reads the page request a server render belongs to, through `next/headers`.
 */
import { buildEpCtx } from "../../ep-server-functions/build-ep-ctx";
import type { EpRequestBridge } from "../../ep-server-functions/request-bridge";
import { parseCookieHeader } from "../../utils/cookie-header";
import type { EpSession } from "./create-ep-auth-better";

/** Null outside a request scope: static generation, or not Next.js. */
export async function readPageRequestHeaders(): Promise<Record<
  string,
  string
> | null> {
  try {
    const { headers } = await import("next/headers.js");
    return Object.fromEntries((await headers()).entries());
  } catch {
    return null;
  }
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
