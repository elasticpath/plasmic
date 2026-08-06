/**
 * Next.js middleware helper for EP auth (PRD #273).
 *
 * Drops into a consumer's `middleware.ts`. On any request that lacks a
 * better-auth session cookie, the middleware synthetically POSTs to the
 * `/ep/anonymous` endpoint (via `epAuth.handler.handler` — the underlying
 * better-auth Request handler) and forwards the resulting Set-Cookie
 * headers on the outgoing response. RSC pages cannot write cookies in
 * Next 15, so middleware is the canonical place to bootstrap session.
 *
 * Consumer usage:
 *
 *   // app/middleware.ts
 *   import { epAuthMiddleware } from
 *     "@elasticpath/plasmic-ep-commerce-elastic-path/server";
 *   import { epAuth } from "@/lib/ep-auth";
 *
 *   export const middleware = epAuthMiddleware(epAuth);
 *
 *   export const config = {
 *     runtime: "nodejs",
 *     matcher: ["/((?!_next|api/ep|.*\\..*).*)"],
 *   };
 *
 * Returns `NextResponse.next()` (the request continues to the route
 * handler / page) with any bootstrap Set-Cookie headers attached. We use
 * NextResponse.next() — NOT a bare `new Response(...)` — because the
 * latter is treated by Next as a terminal response and the page never
 * runs.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasCookie, parseCookieHeader } from "../../utils/cookie-header";
import type { EpAuth } from "./create-ep-auth-better";

/**
 * @param epAuth The result of `createEpAuth({...})` from this package.
 *               Must have `.handler` exposed (the underlying better-auth
 *               instance). Standard since PRD #273.
 * @returns A middleware function suitable for Next.js's `middleware.ts`
 *          export.
 */
export function epAuthMiddleware(epAuth: EpAuth) {
  return async function middleware(
    request: NextRequest | Request
  ): Promise<NextResponse> {
    const url = new URL((request as Request).url);

    // Don't bootstrap on auth-handler routes — they ARE the bootstrap.
    if (url.pathname.startsWith("/api/ep")) {
      return NextResponse.next();
    }

    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookies = parseCookieHeader(cookieHeader);
    if (
      hasCookie(cookies, "better-auth.session_token") &&
      hasCookie(cookies, "better-auth.session_data")
    ) {
      // Already has a session — pass through unchanged.
      return NextResponse.next();
    }

    // Synthesize an internal POST to /ep/anonymous through better-auth's
    // own request handler. We use the handler's `handler(req: Request)
    // => Response` API so the same code path that powers
    // `/api/ep/ep/anonymous` runs here, with full setSessionCookie
    // semantics.
    const anonReq = new Request(`${url.origin}/api/ep/ep/anonymous`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the request's Origin (or fall back to the URL origin)
        // so better-auth's trustedOrigins check passes for this
        // synthetic internal call.
        Origin: request.headers.get("origin") ?? url.origin,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      body: "{}",
    });

    let anonRes: Response;
    try {
      anonRes = await epAuth.handler.handler(anonReq);
    } catch {
      // Auth handler unavailable (e.g. EP unreachable) — let the request
      // proceed without a session. Pages will fall back to MOCK / null
      // without crashing.
      return NextResponse.next();
    }

    if (!anonRes.ok) {
      return NextResponse.next();
    }

    // Continue the request with NextResponse.next(), then attach the
    // bootstrap Set-Cookie headers so they reach the browser alongside
    // the page response.
    const out = NextResponse.next();
    anonRes.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() === "set-cookie") {
        out.headers.append("Set-Cookie", value);
      }
    });
    return out;
  };
}
